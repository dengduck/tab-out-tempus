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

  async click() {
    const event = { preventDefault() {} };
    await Promise.all((this.listeners.get('click') || []).map((handler) => handler(event)));
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

function savedEntry() {
  return {
    id: 'saved-1',
    url: 'https://example.com/article',
    title: 'Example article',
    favIconUrl: '',
    savedAt: new Date(2026, 0, 2, 3, 4).getTime(),
  };
}

suite('Save for Later sidebar', () => {
  test('clicking title opens tab but keeps saved entry', async () => {
    installDom();
    const root = new FakeElement('aside');
    const created = [];
    let storageRemoveCount = 0;
    chrome.tabs = {
      create: async (options) => { created.push(options); },
    };
    chrome.runtime = {
      sendMessage: async (message) => {
        if (message.type === 'REQ_REMOVE_SAVED') storageRemoveCount++;
        return { ok: true, data: {} };
      },
    };

    sidebar.render(root, [savedEntry()]);
    await root.querySelector('.sidebar__entryTitle').click();

    assert.deepEqual(created, [{ url: 'https://example.com/article', active: false }]);
    assert.equal(storageRemoveCount, 0, 'opening must not remove saved entry');
    assert.equal(root.querySelectorAll('.sidebar__entry').length, 1, 'entry stays visible');
    assert.equal(root.querySelector('.sidebar__count').textContent, '1');
  });

  test('clicking remove button deletes storage entry and DOM item', async () => {
    installDom();
    const root = new FakeElement('aside');
    const removedIds = [];
    chrome.tabs = { create: async () => {} };
    chrome.runtime = {
      sendMessage: async (message) => {
        if (message.type === 'REQ_REMOVE_SAVED') removedIds.push(message.id);
        return { ok: true, data: { removed: message.id } };
      },
    };

    sidebar.render(root, [savedEntry()]);
    await root.querySelector('.sidebar__entryRemove').click();

    assert.deepEqual(removedIds, ['saved-1']);
    assert.equal(root.querySelectorAll('.sidebar__entry').length, 0);
    assert.equal(root.querySelector('.sidebar__count').textContent, '0');
    assert.ok(root.querySelector('.sidebar__empty'), 'empty state shown after removal');
  });
});
