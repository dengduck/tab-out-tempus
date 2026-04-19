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

function faviconFallback() {
  return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}
