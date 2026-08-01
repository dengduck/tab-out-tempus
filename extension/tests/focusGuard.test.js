import { suite, test, assert } from './testUtil.js';
import {
  createFocusGuard, isHostAllowed, isInternalUrl, normalizeAllowedHosts,
} from '../background/focusGuard.js';

function makeStorage() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? { [key]: values.get(key) } : {}; },
    async set(object) { for (const [key, value] of Object.entries(object)) values.set(key, value); },
    async remove(key) { values.delete(key); },
  };
}

function makeEvent() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
  };
}

function makeHarness(initialTabs, clock = { now: 1_000 }) {
  const tabMap = new Map(initialTabs.map((tab) => [tab.id, { ...tab }]));
  const updates = [];
  const backs = [];
  let tokenNumber = 0;
  const tabs = {
    onActivated: makeEvent(),
    onUpdated: makeEvent(),
    onRemoved: makeEvent(),
    async query() { return [...tabMap.values()].filter((tab) => tab.active); },
    async get(tabId) { return tabMap.get(tabId); },
    async update(tabId, changes) {
      updates.push({ tabId, ...changes });
      Object.assign(tabMap.get(tabId), changes);
      return tabMap.get(tabId);
    },
    async goBack(tabId) { backs.push(tabId); },
  };
  const storage = makeStorage();
  const guard = createFocusGuard({
    tabs,
    runtime: { getURL: (path) => `chrome-extension://test-id/${path}` },
    storage,
    now: () => clock.now,
    createToken: () => `token-${++tokenNumber}`,
  });
  return { guard, tabs, storage, tabMap, updates, backs, clock };
}

function timer(overrides = {}) {
  return {
    active: true,
    strict: true,
    startTime: 1_000,
    endTime: 61_000,
    allowedHosts: [],
    ...overrides,
  };
}

suite('FocusGuard — host rules', () => {
  test('exact and wildcard rules have distinct matching semantics', () => {
    const rules = normalizeAllowedHosts([
      ' Example.COM. ', '*.Docs.Example.COM', 'example.com', '',
    ]);
    assert.deepEqual(rules, ['*.docs.example.com', 'example.com'], 'rules normalize');
    assert.equal(isHostAllowed('example.com', rules), true, 'exact host matches');
    assert.equal(isHostAllowed('www.example.com', rules), false, 'exact host excludes subdomains');
    assert.equal(isHostAllowed('a.docs.example.com', rules), true, 'wildcard matches subdomain');
    assert.equal(isHostAllowed('docs.example.com', rules), false, 'wildcard excludes apex');
  });

  test('browser and extension pages are always internal', () => {
    assert.equal(isInternalUrl('chrome://settings/'), true, 'chrome page allowed');
    assert.equal(isInternalUrl('chrome-extension://id/blocked.html'), true, 'extension page allowed');
    assert.equal(isInternalUrl('https://example.com'), false, 'web page is not internal');
  });
});

suite('FocusGuard — blocking lifecycle', () => {
  test('blocks a disallowed active tab without redirect loops', async () => {
    const { guard, tabMap, updates } = makeHarness([
      { id: 7, active: true, url: 'https://blocked.example/path' },
    ]);
    await guard.sync(timer());

    assert.equal(updates.length, 1, 'first enforcement redirects once');
    assert.ok(updates[0].url.includes('blocked.html?token=token-1'), 'redirect contains token');
    await guard.enforceTab(tabMap.get(7));
    assert.equal(updates.length, 1, 'blocked extension page is not redirected again');
    assert.equal(guard.getBlocked('token-1').url, 'https://blocked.example/path', 'original URL is saved');
  });

  test('does not block internal active tabs', async () => {
    const { guard, updates } = makeHarness([
      { id: 1, active: true, url: 'chrome://settings/' },
      { id: 2, active: true, url: 'chrome-extension://other-id/page.html' },
    ]);
    await guard.sync(timer());
    assert.equal(updates.length, 0, 'internal tabs stay untouched');
  });

  test('stop restores every blocked tab to its original URL', async () => {
    const { guard, updates } = makeHarness([
      { id: 1, active: true, url: 'https://one.example/a' },
      { id: 2, active: true, url: 'https://two.example/b' },
    ]);
    await guard.sync(timer());
    assert.equal(updates.length, 2, 'both active tabs blocked');

    const result = await guard.stop();
    assert.equal(result.restored, 2, 'both blocked tabs restored');
    assert.equal(updates.length, 4, 'restore issued two more updates');
    assert.equal(updates[2].url, 'https://one.example/a', 'first original restored');
    assert.equal(updates[3].url, 'https://two.example/b', 'second original restored');
  });

  test('lazy expiry restores blocked tabs', async () => {
    const clock = { now: 1_000 };
    const { guard, updates } = makeHarness([
      { id: 4, active: true, url: 'https://blocked.example/' },
    ], clock);
    await guard.sync(timer({ endTime: 2_000 }));
    clock.now = 2_001;

    assert.equal(await guard.checkExpiry(), true, 'expiry is detected');
    assert.equal(updates.at(-1).url, 'https://blocked.example/', 'expiry restores original URL');
  });

  test('failed allow/restore keeps recovery token for retry', async () => {
    const { guard, tabs } = makeHarness([
      { id: 12, active: true, url: 'https://retry.example/work' },
    ]);
    await guard.sync(timer());
    const originalUpdate = tabs.update;
    tabs.update = async () => { throw new Error('temporary tab failure'); };
    let rejected = false;
    try { await guard.allowTokenHost('token-1'); } catch (_) { rejected = true; }
    assert.ok(rejected, 'allow failure propagates');
    assert.ok(guard.getBlocked('token-1'), 'allow failure keeps recovery entry');
    try { await guard.stop(); } catch (_) { /* expected */ }
    assert.ok(guard.getBlocked('token-1'), 'stop failure keeps recovery entry');
    tabs.update = originalUpdate;
    assert.equal((await guard.stop()).restored, 1, 'later retry restores tab');
  });

  test('allowTokenHost permits that exact host for the current session', async () => {
    const { guard, tabMap, updates } = makeHarness([
      { id: 9, active: true, url: 'https://allowed-once.example/work' },
    ]);
    await guard.sync(timer());
    assert.equal(await guard.allowTokenHost('token-1'), true, 'token is accepted');
    assert.equal(updates.at(-1).url, 'https://allowed-once.example/work', 'original URL restored');

    const result = await guard.enforceTab(tabMap.get(9));
    assert.equal(result.action, 'allowed', 'host remains allowed in this focus session');
    assert.equal(updates.length, 2, 'no second block occurs');
  });
});
