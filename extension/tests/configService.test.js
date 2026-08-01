import { suite, test, assert } from './testUtil.js';
import { STORAGE_KEY } from '../shared/constants.js';
import * as configService from '../background/configService.js';

function makeStorage(initial = null) {
  let value = initial;
  let failWrites = false;
  const writes = [];
  return {
    storage: {
      async get(key) {
        assert.equal(key, STORAGE_KEY.CONFIG);
        return value;
      },
      async set(key, next) {
        assert.equal(key, STORAGE_KEY.CONFIG);
        if (failWrites) throw new Error('write failed');
        value = next;
        writes.push(next);
      },
    },
    writes,
    fail() { failWrites = true; },
    value() { return value; },
  };
}

function assertThrows(fn, message) {
  try {
    fn();
  } catch (_) {
    return;
  }
  throw new Error(message || 'expected function to throw');
}

suite('Config Service', () => {
  test('loads defaults and returns deep copies', async () => {
    const mock = makeStorage();
    const loaded = await configService.init({ storage: mock.storage });

    assert.equal(loaded.theme, 'system');
    assert.equal(loaded.historyRetentionDays, null);
    assert.deepEqual(loaded.focusAllowedHosts, []);
    assert.equal(loaded.groupMode, 'domain');
    assert.equal(loaded.categories.length, 6);
    assert.deepEqual(loaded.domainCategories, {});
    assert.deepEqual(loaded.domainBudgets, {});
    assert.deepEqual(loaded.customGroups, []);

    loaded.categories[0].name = 'Mutated';
    loaded.focusAllowedHosts.push('example.com');
    const reread = configService.getConfig();
    assert.equal(reread.categories[0].name, '工作');
    assert.deepEqual(reread.focusAllowedHosts, []);
  });

  test('persisted defaults round-trip with built-in categories intact', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });
    const persisted = await configService.updateTheme('dark');
    await configService.init({ storage: makeStorage(mock.value()).storage });
    const reloaded = configService.getConfig();
    assert.equal(reloaded.categories.length, 6);
    assert.deepEqual(reloaded.categories, persisted.categories);
  });

  test('merges legacy and missing fields with normalized defaults', async () => {
    const mock = makeStorage({
      theme: 'dark',
      focusAllowedHosts: [' Example.COM. ', 'example.com'],
      domainBudgets: { ' News.Example.COM. ': 45, 'bad/path': 10 },
    });

    const loaded = await configService.init(mock.storage);

    assert.equal(loaded.theme, 'dark');
    assert.equal(loaded.historyRetentionDays, null);
    assert.deepEqual(loaded.focusAllowedHosts, ['example.com']);
    assert.equal(loaded.groupMode, 'domain');
    assert.equal(loaded.categories.length, 6);
    assert.deepEqual(loaded.domainBudgets, { 'news.example.com': 45 });
    assert.deepEqual(loaded.customGroups, []);
  });

  test('rejects invalid values without writing', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });

    assertThrows(() => configService.updateTheme('blue'));
    assertThrows(() => configService.updateRetention(0));
    assertThrows(() => configService.updateFocusAllowedHosts(['https://example.com']));
    assertThrows(() => configService.upsertCategory({ id: 'Bad ID', name: 'Bad' }));
    assertThrows(() => configService.setDomainCategory('example.com', 'missing'));
    assertThrows(() => configService.setDomainBudget('example.com', 1.5));
    assertThrows(() => configService.upsertCustomGroup({ id: 'group', name: '', hosts: [] }));
    assert.equal(mock.writes.length, 0);
  });

  test('keeps memory unchanged when storage write fails', async () => {
    const mock = makeStorage({ theme: 'light' });
    await configService.init({ storage: mock.storage });
    mock.fail();

    let error = null;
    try {
      await configService.updateTheme('dark');
    } catch (caught) {
      error = caught;
    }

    assert.ok(error, 'write failure must reject');
    assert.equal(configService.getConfig().theme, 'light');
    assert.equal(mock.value().theme, 'light');
  });

  test('removing a category clears its domain mappings', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });
    await configService.setDomainCategory('work.example.com', 'work');
    await configService.setDomainCategory('learn.example.com', 'learning');

    const updated = await configService.removeCategory('work');

    assert.ok(!updated.categories.some(({ id }) => id === 'work'));
    assert.deepEqual(updated.domainCategories, { 'learn.example.com': 'learning' });
    assert.deepEqual(mock.value().domainCategories, { 'learn.example.com': 'learning' });
  });

  test('normalizes and deduplicates custom group hosts', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });

    const updated = await configService.upsertCustomGroup({
      id: 'Research',
      name: ' Research ',
      hosts: ['Docs.Example.com', 'docs.example.com.', 'papers.example.com'],
    });

    assert.deepEqual(updated.customGroups, [{
      id: 'research',
      name: 'Research',
      hosts: ['docs.example.com', 'papers.example.com'],
    }]);
  });

  test('focus exact host rules preserve www semantics', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });
    const updated = await configService.updateFocusAllowedHosts(['www.Example.com', '*.Docs.Example.com']);
    assert.deepEqual(updated.focusAllowedHosts, ['www.example.com', '*.docs.example.com']);
  });

  test('serializes concurrent config updates without losing fields', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });
    await Promise.all([
      configService.updateTheme('dark'),
      configService.updateGroupMode('category'),
      configService.updateRetention(90),
    ]);
    const updated = configService.getConfig();
    assert.equal(updated.theme, 'dark');
    assert.equal(updated.groupMode, 'category');
    assert.equal(updated.historyRetentionDays, 90);
  });

  test('normalizes category and budget updates and supports removal', async () => {
    const mock = makeStorage();
    await configService.init({ storage: mock.storage });
    await configService.upsertCategory({
      id: 'Health',
      name: ' Health ',
      color: '#abcdef',
      emoji: '*',
    });
    await configService.setDomainCategory('FIT.Example.com.', 'HEALTH');
    await configService.setDomainBudget('FIT.Example.com.', 30);

    let updated = configService.getConfig();
    assert.deepEqual(updated.domainCategories, { 'fit.example.com': 'health' });
    assert.deepEqual(updated.domainBudgets, { 'fit.example.com': 30 });
    assert.equal(updated.categories.at(-1).color, '#ABCDEF');

    await configService.setDomainCategory('fit.example.com', null);
    updated = await configService.setDomainBudget('fit.example.com', null);
    assert.deepEqual(updated.domainCategories, {});
    assert.deepEqual(updated.domainBudgets, {});
  });
});
