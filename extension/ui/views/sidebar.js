/** Save for Later sidebar with local search and sorting. */

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';

let rootEl = null;
let listEl = null;
let savedEntries = [];
let searchQuery = '';
let sortMode = 'newest';
let onRemovedCallback = null;

/** @type {Map<string, HTMLElement>} */
const entryEls = new Map();

function resolveRenderArgs(savedList, options) {
  const entries = Array.isArray(savedList) ? savedList : [];
  const config = Array.isArray(savedList) ? options : savedList;
  const onRemoved = typeof config === 'function' ? config : config?.onRemoved;
  return {
    entries,
    onRemoved: typeof onRemoved === 'function' ? onRemoved : null,
  };
}

/** Initialize the sidebar. Alias of render for callers that prefer lifecycle naming. */
export function init(el, savedList = [], options = {}) {
  return render(el, savedList, options);
}

/** Render the complete sidebar. options may be an onRemoved callback or config object. */
export function render(el, savedList = [], options = {}) {
  rootEl = el;
  if (!rootEl) return;

  const resolved = resolveRenderArgs(savedList, options);
  savedEntries = resolved.entries.map((entry) => ({ ...entry }));
  onRemovedCallback = resolved.onRemoved;
  searchQuery = '';
  sortMode = 'newest';
  entryEls.clear();

  rootEl.textContent = '';
  rootEl.classList.add('sidebar--active');

  const header = h('div', { class: 'sidebar__header' }, [
    h('h3', { class: 'sidebar__title' }, ['🔖 稍后查看']),
    h('span', { class: 'sidebar__count' }, [String(savedEntries.length)]),
  ]);
  rootEl.appendChild(header);
  rootEl.appendChild(createControls());

  listEl = h('div', { class: 'sidebar__list' });
  rootEl.appendChild(listEl);
  renderEntryList();
}

/** Add or replace an entry and preserve the active search/sort controls. */
export function add(entry) {
  if (!rootEl || !entry?.id) return;
  savedEntries = [
    { ...entry },
    ...savedEntries.filter((saved) => saved.id !== entry.id),
  ];
  updateCount();
  renderEntryList();
}

/** Remove an entry from the in-memory view. */
export function remove(entryId) {
  const next = savedEntries.filter((entry) => entry.id !== entryId);
  if (next.length === savedEntries.length) return false;
  savedEntries = next;
  updateCount();
  renderEntryList();
  return true;
}

function createControls() {
  const search = h('input', {
    class: 'sidebar__search',
    type: 'search',
    placeholder: '搜索标题或网址',
    'aria-label': '搜索稍后查看',
  });
  search.value = searchQuery;
  search.addEventListener('input', () => {
    searchQuery = String(search.value || '').trim().toLocaleLowerCase();
    renderEntryList();
  });

  const sort = h('select', {
    class: 'sidebar__sort',
    'aria-label': '排序稍后查看',
  }, [
    h('option', { value: 'newest' }, ['最新保存']),
    h('option', { value: 'oldest' }, ['最早保存']),
    h('option', { value: 'title' }, ['按标题']),
  ]);
  sort.value = sortMode;
  sort.addEventListener('change', () => {
    sortMode = ['newest', 'oldest', 'title'].includes(sort.value) ? sort.value : 'newest';
    renderEntryList();
  });

  return h('div', { class: 'sidebar__controls' }, [search, sort]);
}

function visibleEntries() {
  const filtered = searchQuery
    ? savedEntries.filter((entry) => {
      const title = String(entry.title || '').toLocaleLowerCase();
      const url = String(entry.url || '').toLocaleLowerCase();
      return title.includes(searchQuery) || url.includes(searchQuery);
    })
    : savedEntries.slice();

  return filtered.sort((a, b) => {
    if (sortMode === 'oldest') {
      return Number(a.savedAt || 0) - Number(b.savedAt || 0);
    }
    if (sortMode === 'title') {
      const aTitle = String(a.title || a.url || '');
      const bTitle = String(b.title || b.url || '');
      return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
    }
    return Number(b.savedAt || 0) - Number(a.savedAt || 0);
  });
}

function renderEntryList() {
  if (!listEl) return;
  listEl.textContent = '';
  entryEls.clear();

  const visible = visibleEntries();
  for (const entry of visible) {
    listEl.appendChild(createEntryEl(entry));
  }

  if (visible.length === 0) {
    const message = savedEntries.length === 0 ? '还没有保存的标签' : '没有匹配的标签';
    listEl.appendChild(h('p', { class: 'sidebar__empty' }, [message]));
  }
}

function createEntryEl(entry) {
  const favicon = entry.favIconUrl
    ? h('img', {
      class: 'sidebar__favicon',
      src: entry.favIconUrl,
      alt: '',
      onerror: (event) => { event.target.style.display = 'none'; },
    })
    : h('span', { class: 'sidebar__favicon sidebar__favicon--placeholder' }, ['🔖']);

  const title = h('a', {
    class: 'sidebar__entryTitle',
    href: entry.url,
    title: entry.url,
  }, [entry.title || entry.url || '(untitled)']);

  title.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await chrome.tabs.create({ url: entry.url, active: false });
    } catch (error) {
      console.error('[tempus] sidebar open failed', error);
    }
  });

  const removeBtn = h('button', {
    class: 'sidebar__entryRemove',
    title: '删除',
    'aria-label': '删除',
  }, ['×']);

  removeBtn.addEventListener('click', async () => {
    try {
      await messaging.removeSaved(entry.id);
      remove(entry.id);
    } catch (error) {
      console.error('[tempus] sidebar remove failed', error);
      return;
    }

    if (onRemovedCallback) {
      try {
        await onRemovedCallback(entry.id);
      } catch (error) {
        console.error('[tempus] sidebar onRemoved failed', error);
      }
    }
  });

  const time = new Date(entry.savedAt);
  const timeStr = `${time.getMonth() + 1}/${time.getDate()} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const item = h('div', { class: 'sidebar__entry', 'data-entry-id': entry.id }, [
    favicon,
    h('div', { class: 'sidebar__entryBody' }, [
      title,
      h('span', { class: 'sidebar__entryTime' }, [timeStr]),
    ]),
    removeBtn,
  ]);

  entryEls.set(entry.id, item);
  return item;
}

function updateCount() {
  if (!rootEl) return;
  const countEl = rootEl.querySelector('.sidebar__count');
  if (countEl) countEl.textContent = String(savedEntries.length);
}
