/**
 * ui/components/tabChip.js
 * -------------------------
 * 单个 tab chip（favicon + 标题 + 关闭按钮 + 时长 badge 占位）。
 *
 * 结构：
 *   <div class="tabChip" data-tab-id="123">
 *     <img class="tabChip__favicon" />
 *     <a class="tabChip__title" href="#">Title</a>
 *     <span class="tabChip__badge" hidden></span>
 *     <button class="tabChip__close" data-action="close-tab">×</button>
 *   </div>
 *
 * 交互：
 *   - 点标题 → chrome.tabs.update({active:true}) + chrome.windows.update({focused:true})
 *   - 点 × → REQ_CLOSE_TAB（由 tabsGrid 委托处理）
 *
 * 里程碑：M2（基础） + M5（badge）。
 */

import { h } from '../utils/dom.js';
import { formatDurationCompact } from '../utils/formatDuration.js';
import { FAVICON_FALLBACK } from '../../shared/constants.js';

/**
 * @param {{id:number,url:string,title:string,favIconUrl?:string,windowId:number}} tabInfo
 * @returns {HTMLElement}
 */
export function create(tabInfo, options = {}) {
  const favicon = h('img', {
    class: 'tabChip__favicon',
    src: tabInfo.favIconUrl || FAVICON_FALLBACK,
    alt: '',
    onerror: (e) => { e.target.src = FAVICON_FALLBACK; },
  });

  const title = h('a', {
    class: 'tabChip__title',
    href: tabInfo.url,
    title: tabInfo.title || tabInfo.url,
    'data-action': 'activate-tab',
    'data-tab-id': String(tabInfo.id),
    'data-window-id': String(tabInfo.windowId),
    // 阻止真跳转，交给 tabsGrid 统一处理
    onclick: (e) => { e.preventDefault(); },
  }, [tabInfo.title || tabInfo.url || '(untitled)']);

  const badge = h('span', { class: 'tabChip__badge', hidden: '' });

  const dupeBadge = h('span', { class: 'tabChip__dupe', hidden: '' });

  const saveBtn = h('button', {
    class: `tabChip__save${options.isSaved ? ' is-saved' : ''}`,
    'data-action': 'save-for-later',
    'data-tab-id': String(tabInfo.id),
    'aria-label': options.isSaved ? '已加入稍后查看' : '稍后查看',
    'aria-pressed': String(!!options.isSaved),
    title: options.isSaved ? '已加入稍后查看' : '稍后查看',
    disabled: options.isSaved ? '' : null,
  }, ['🔖']);

  const closeBtn = h('button', {
    class: 'tabChip__close',
    'data-action': 'close-tab',
    'data-tab-id': String(tabInfo.id),
    'aria-label': '关闭',
    title: '关闭',
  }, ['×']);

  const chip = h('div', {
    class: 'tabChip',
    'data-tab-id': String(tabInfo.id),
  }, [favicon, title, badge, dupeBadge, saveBtn, closeBtn]);

  return chip;
}

/**
 * 更新 tab 时长 badge。
 *   - ms < 60000（不足 1 分钟）→ 隐藏 badge（避免秒跳）
 *   - isActive=true → 加 is-active 类（橙色 + 加粗）
 * @param {HTMLElement} el tabChip 根元素
 * @param {number} ms tab 累计毫秒（cumulative + 若是当前活跃 tab 再加 running）
 * @param {boolean} [isActive=false]
 */
export function updateBadge(el, ms, isActive = false) {
  if (!el) return;
  const badge = el.querySelector('.tabChip__badge');
  if (!badge) return;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 60000) {
    if (!badge.hidden) badge.hidden = true;
    return;
  }
  const text = formatDurationCompact(ms);
  if (badge.hidden) badge.hidden = false;
  if (badge.textContent !== text) badge.textContent = text;
  badge.classList.toggle('is-active', !!isActive);
}

/**
 * 更新 tab 重复 badge。
 *   - dupeCount <= 1 → 隐藏 badge
 *   - dupeCount >= 2 → 显示 "(2x)" / "(3x)" 等
 * @param {HTMLElement} el tabChip 根元素
 * @param {number} dupeCount 该 URL 在全局出现次数（含自身）
 */
export function updateSaved(el, isSaved) {
  if (!el) return;
  const button = el.querySelector('.tabChip__save');
  if (!button) return;
  button.classList.toggle('is-saved', !!isSaved);
  button.disabled = !!isSaved;
  button.setAttribute('aria-pressed', String(!!isSaved));
  button.setAttribute('aria-label', isSaved ? '已加入稍后查看' : '稍后查看');
  button.title = isSaved ? '已加入稍后查看' : '稍后查看';
}

export function updateDupeBadge(el, dupeCount) {
  if (!el) return;
  const badge = el.querySelector('.tabChip__dupe');
  if (!badge) return;
  if (typeof dupeCount !== 'number' || dupeCount < 2) {
    if (!badge.hidden) badge.hidden = true;
    return;
  }
  const text = `(${dupeCount}x)`;
  if (badge.hidden) badge.hidden = false;
  if (badge.textContent !== text) badge.textContent = text;
}
