import { suite, test, assert } from './testUtil.js';
import * as sidebar from '../ui/views/sidebar.js';

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  add(...names) {
    const set = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const name of names) set.add(name);
    this.owner.className = Array.from(set).join(' ');
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this._textContent = '';
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.classList = new FakeClassList(this);
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    child.parentNode = this;
    this.children.unshift(child);
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type) {
    const event = { target: this, preventDefault() {} };
    await Promise.all((this.listeners.get(type) || []).map((handler) => handler(event)));
  }

  async click() {
    await this.dispatch('click');
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const visit = (node) => {
      if (className && node.className.split(/\s+/).includes(className)) matches.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }
}

function installDom() {
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => {
      const node = new FakeElement('#text');
      node.textContent = text;
      return node;
    },
  };
}

function savedEntry(overrides = {}) {
  return {
    id: 'saved-1',
    url: 'https://example.com/article',
    title: 'Example article',
    favIconUrl: '',
    savedAt: new Date(2026, 0, 2, 3, 4).getTime(),
    ...overrides,
  };
}

function installChrome(removedIds = []) {
  const created = [];
  chrome.tabs = {
    create: async (options) => { created.push(options); },
  };
  chrome.runtime = {
    sendMessage: async (message) => {
      if (message.type === 'REQ_REMOVE_SAVED') removedIds.push(message.id);
      return { ok: true, data: { removed: message.id } };
    },
  };
  return created;
}

function visibleTitles(root) {
  return root.querySelectorAll('.sidebar__entryTitle').map((element) => element.textContent);
}

suite('Save for Later sidebar', () => {
  test('clicking title opens tab but keeps saved entry', async () => {
    installDom();
    const root = new FakeElement('aside');
    const removedIds = [];
    const created = installChrome(removedIds);

    sidebar.render(root, [savedEntry()]);
    await root.querySelector('.sidebar__entryTitle').click();

    assert.deepEqual(created, [{ url: 'https://example.com/article', active: false }]);
    assert.deepEqual(removedIds, [], 'opening must not remove saved entry');
    assert.equal(root.querySelectorAll('.sidebar__entry').length, 1, 'entry stays visible');
    assert.equal(root.querySelector('.sidebar__count').textContent, '1');
  });

  test('clicking remove deletes the item and calls optional callback', async () => {
    installDom();
    const root = new FakeElement('aside');
    const removedIds = [];
    const callbackIds = [];
    installChrome(removedIds);

    sidebar.init(root, [savedEntry()], {
      onRemoved: async (id) => { callbackIds.push(id); },
    });
    await root.querySelector('.sidebar__entryRemove').click();

    assert.deepEqual(removedIds, ['saved-1']);
    assert.deepEqual(callbackIds, ['saved-1']);
    assert.equal(root.querySelectorAll('.sidebar__entry').length, 0);
    assert.equal(root.querySelector('.sidebar__count').textContent, '0');
    assert.ok(root.querySelector('.sidebar__empty'), 'empty state shown after removal');
  });

  test('search matches title and URL case-insensitively', async () => {
    installDom();
    const root = new FakeElement('aside');
    installChrome();
    sidebar.render(root, [
      savedEntry({ id: 'alpha', title: 'Alpha Guide', url: 'https://example.com/a' }),
      savedEntry({ id: 'docs', title: 'Second item', url: 'https://docs.example.com/needle' }),
      savedEntry({ id: 'other', title: 'Other', url: 'https://other.example.com' }),
    ]);

    const search = root.querySelector('.sidebar__search');
    search.value = 'ALPHA';
    await search.dispatch('input');
    assert.deepEqual(visibleTitles(root), ['Alpha Guide']);

    search.value = 'docs.example.com';
    await search.dispatch('input');
    assert.deepEqual(visibleTitles(root), ['Second item']);

    search.value = 'missing';
    await search.dispatch('input');
    assert.deepEqual(visibleTitles(root), []);
    assert.equal(root.querySelector('.sidebar__empty').textContent, '没有匹配的标签');
  });

  test('sorts by newest, oldest, and title', async () => {
    installDom();
    const root = new FakeElement('aside');
    installChrome();
    sidebar.render(root, [
      savedEntry({ id: 'beta', title: 'Beta', savedAt: 30 }),
      savedEntry({ id: 'zulu', title: 'Zulu', savedAt: 10 }),
      savedEntry({ id: 'alpha', title: 'alpha', savedAt: 20 }),
    ]);

    assert.deepEqual(visibleTitles(root), ['Beta', 'alpha', 'Zulu']);

    const sort = root.querySelector('.sidebar__sort');
    sort.value = 'oldest';
    await sort.dispatch('change');
    assert.deepEqual(visibleTitles(root), ['Zulu', 'alpha', 'Beta']);

    sort.value = 'title';
    await sort.dispatch('change');
    assert.deepEqual(visibleTitles(root), ['alpha', 'Beta', 'Zulu']);
  });
});
