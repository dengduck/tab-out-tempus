/**
 * ui/views/sidebar.js
 * --------------------
 * Save for Later 侧边栏。
 *
 * 功能：
 *   - 显示已保存的标签列表（标题 + URL + 保存时间）
 *   - 点击恢复（打开 URL + 从列表移除）
 *   - 点 × 删除
 *
 * 数据流：
 *   - 首帧：main.js 调 render(sidebarEl, savedList)
 *   - 新增保存：main.js 调 add(entry) 追加到 DOM
 *   - 删除：用户点 × → messaging.removeSaved → 移除 DOM
 *   - 恢复：用户点标题 → 新开 tab + messaging.removeSaved
 *
 * 里程碑：M7。
 */

import { h, $ } from '../utils/dom.js';
import * as messaging from '../messaging.js';

/** @type {HTMLElement|null} */
let rootEl = null;

/** @type {Map<string, HTMLElement>} */
const entryEls = new Map();

/**
 * 首次渲染。
 * @param {HTMLElement} el #sidebar
 * @param {Array} savedList [{id, url, title, favIconUrl, savedAt}]
 */
export function render(el, savedList = []) {
  rootEl = el;
  if (!rootEl) return;

  entryEls.clear();
  rootEl.textContent = '';  // 清掉 CSS ::before stub
  rootEl.classList.add('sidebar--active');

  const header = h('div', { class: 'sidebar__header' }, [
    h('h3', { class: 'sidebar__title' }, ['🔖 稍后查看']),
    h('span', { class: 'sidebar__count' }, [`${savedList.length}`]),
  ]);
  rootEl.appendChild(header);

  const list = h('div', { class: 'sidebar__list' });
  for (const entry of savedList) {
    const item = createEntryEl(entry);
    list.appendChild(item);
  }
  rootEl.appendChild(list);

  if (savedList.length === 0) {
    showEmpty();
  }
}

/**
 * 追加一条新保存的条目（实时更新）。
 */
export function add(entry) {
  if (!rootEl || !entry?.id) return;
  removeEmpty();

  const list = rootEl.querySelector('.sidebar__list');
  if (!list) return;

  const item = createEntryEl(entry);
  list.prepend(item);  // 新的在最上面
  updateCount();
}

/**
 * 从 DOM 移除一条条目（删除或恢复后调用）。
 */
export function remove(entryId) {
  const el = entryEls.get(entryId);
  if (el) {
    el.remove();
    entryEls.delete(entryId);
  }
  updateCount();
  if (entryEls.size === 0) showEmpty();
}

// ========== 内部 ==========

function createEntryEl(entry) {
  const favicon = entry.favIconUrl
    ? h('img', { class: 'sidebar__favicon', src: entry.favIconUrl, alt: '', onerror: (e) => { e.target.style.display = 'none'; } })
    : h('span', { class: 'sidebar__favicon sidebar__favicon--placeholder' }, ['🔖']);

  const title = h('a', {
    class: 'sidebar__entryTitle',
    href: entry.url,
    title: entry.url,
  }, [entry.title || entry.url || '(untitled)']);

  title.addEventListener('click', async (e) => {
    e.preventDefault();
    // 打开 URL 并从列表移除
    try {
      await chrome.tabs.create({ url: entry.url, active: false });
      await messaging.removeSaved(entry.id);
      remove(entry.id);
    } catch (err) {
      console.error('[tempus] sidebar restore failed', err);
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
    } catch (err) {
      console.error('[tempus] sidebar remove failed', err);
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
  if (countEl) countEl.textContent = String(entryEls.size);
}

function showEmpty() {
  if (!rootEl) return;
  const list = rootEl.querySelector('.sidebar__list');
  if (list && !list.querySelector('.sidebar__empty')) {
    list.appendChild(h('p', { class: 'sidebar__empty' }, ['还没有保存的标签']));
  }
}

function removeEmpty() {
  if (!rootEl) return;
  rootEl.querySelector('.sidebar__empty')?.remove();
}
