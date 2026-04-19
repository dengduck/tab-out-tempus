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

/**
 * @param {{id:number,url:string,title:string,favIconUrl?:string,windowId:number}} tabInfo
 * @returns {HTMLElement}
 */
export function create(tabInfo) {
  const favicon = h('img', {
    class: 'tabChip__favicon',
    src: tabInfo.favIconUrl || defaultFaviconFor(tabInfo.url),
    alt: '',
    onerror: (e) => { e.target.src = defaultFaviconFor(tabInfo.url); },
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
  }, [favicon, title, badge, closeBtn]);

  return chip;
}

/** M5 填：更新 tab 时长 badge */
export function updateBadge(el, ms) {
  if (!el) return;
  const badge = el.querySelector('.tabChip__badge');
  if (!badge) return;
  if (typeof ms !== 'number' || ms < 1000) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = `${Math.floor(ms / 60000)}m`;
}

function defaultFaviconFor(url) {
  // Chrome extension 页面可用的 fallback：占位 1x1 透明 gif 的 data URI
  // 之后 M5 可替换为 chrome.runtime.getURL('icons/icon16.png') 或 favicon API
  return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}
