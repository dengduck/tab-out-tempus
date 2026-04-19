/**
 * ui/views/homepagesGroup.js
 * ---------------------------
 * Homepages 特殊分组：Gmail / X / YouTube 等的首页 tab 集中到一张卡里。
 * 触发条件见 ui/utils/domain.js isHomepage()。
 *
 * 里程碑：M2。
 */

import { h } from '../utils/dom.js';
import { create as createChip } from '../components/tabChip.js';

/**
 * @param {Array} homepages  来自 groupByDomain().homepages
 * @returns {HTMLElement|null}  无 homepage 时返回 null
 */
export function render(homepages) {
  if (!homepages || homepages.length === 0) return null;

  const chipsWrap = h('div', { class: 'domainCard__chips' });
  for (const t of homepages) chipsWrap.appendChild(createChip(t));

  const head = h('header', { class: 'domainCard__head' }, [
    h('span', { class: 'domainCard__icon' }, ['🏠']),
    h('h3', { class: 'domainCard__title' }, [
      'Homepages',
      h('span', { class: 'domainCard__count' }, [` (${homepages.length})`]),
    ]),
    h('button', {
      class: 'domainCard__closeAll',
      'data-action': 'close-homepages',
    }, ['关闭全部首页']),
  ]);

  return h('article', {
    class: 'domainCard domainCard--homepages',
    'data-hostname': '__homepages',
  }, [head, chipsWrap]);
}
