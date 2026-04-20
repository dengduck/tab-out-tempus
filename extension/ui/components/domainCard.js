/**
 * ui/components/domainCard.js
 * ----------------------------
 * 域名卡片：一个 hostname 下的所有 tab，作为一张卡展示。
 *
 * 结构：
 *   <article class="domainCard" data-hostname="example.com">
 *     <header class="domainCard__head">
 *       <img class="domainCard__favicon" />
 *       <h3 class="domainCard__title">example.com (3)</h3>
 *       <button data-action="close-all">关闭全部 3 个</button>
 *     </header>
 *     <div class="domainCard__chips"> ...tabChip[] ... </div>
 *   </article>
 *
 * 里程碑：M2。
 */

import { h } from '../utils/dom.js';
import { create as createChip } from './tabChip.js';
import { formatDurationCompact } from '../utils/formatDuration.js';

/**
 * @param {string} hostname
 * @param {Array} tabs
 * @returns {HTMLElement}
 */
export function create(hostname, tabs) {
  const chipsWrap = h('div', { class: 'domainCard__chips' });
  for (const t of tabs) chipsWrap.appendChild(createChip(t));

  const head = h('header', { class: 'domainCard__head' }, [
    h('img', {
      class: 'domainCard__favicon',
      src: tabs[0]?.favIconUrl || faviconFallback(),
      alt: '',
      onerror: (e) => { e.target.src = faviconFallback(); },
    }),
    h('h3', { class: 'domainCard__title' }, [
      hostname,
      h('span', { class: 'domainCard__count' }, [` (${tabs.length})`]),
    ]),
    h('span', { class: 'domainCard__time', hidden: '' }),
    h('button', {
      class: 'domainCard__closeDupes',
      'data-action': 'close-duplicates',
      'data-hostname': hostname,
      hidden: '',
    }, ['关闭重复']),
    h('button', {
      class: 'domainCard__closeAll',
      'data-action': 'close-all',
      'data-hostname': hostname,
    }, [`关闭全部 ${tabs.length} 个`]),
  ]);

  return h('article', {
    class: 'domainCard',
    'data-hostname': hostname,
  }, [head, chipsWrap]);
}

/**
 * 更新域名卡上的聚合时长。
 * @param {HTMLElement} cardEl .domainCard 根
 * @param {number} ms 该域名所有 open tab 的累计总毫秒
 */
export function updateTime(cardEl, ms) {
  if (!cardEl) return;
  const timeEl = cardEl.querySelector('.domainCard__time');
  if (!timeEl) return;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 60000) {
    if (!timeEl.hidden) timeEl.hidden = true;
    return;
  }
  const text = formatDurationCompact(ms);
  if (timeEl.hidden) timeEl.hidden = false;
  if (timeEl.textContent !== text) timeEl.textContent = text;
}

/**
 * 更新域名卡上"关闭重复"按钮的可见性和文案。
 * @param {HTMLElement} cardEl .domainCard 根
 * @param {number} dupeCount 该卡中重复的 tab 数（将被关闭的数量）
 */
export function updateDupeButton(cardEl, dupeCount) {
  if (!cardEl) return;
  const btn = cardEl.querySelector('.domainCard__closeDupes');
  if (!btn) return;
  if (typeof dupeCount !== 'number' || dupeCount < 1) {
    if (!btn.hidden) btn.hidden = true;
    return;
  }
  if (btn.hidden) btn.hidden = false;
  const text = `关闭 ${dupeCount} 个重复`;
  if (btn.textContent !== text) btn.textContent = text;
}

function faviconFallback() {
  return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}
