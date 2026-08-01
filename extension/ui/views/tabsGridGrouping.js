import { h } from '../utils/dom.js';
import { create as createCard } from '../components/domainCard.js';
import { groupDomains, resolveGroupForHost } from './groupingView.js';

function attrEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function updateGroupingSection(section) {
  if (!section) return;
  const count = section.querySelectorAll('.tabChip').length;
  if (count === 0) {
    section.remove();
    return;
  }
  const label = section.querySelector('.groupingSection__count');
  if (label) label.textContent = `${count} 个标签`;
}

function createSection(group) {
  return h('section', {
    class: 'groupingSection',
    'data-group-key': `${group.type}:${group.id}`,
  }, [
    h('div', { class: 'groupingSection__header' }, [
      h('h2', { class: 'groupingSection__title' }, [group.name]),
      h('span', { class: 'groupingSection__count' }, ['']),
    ]),
    h('div', { class: 'groupingSection__body' }),
  ]);
}

export function appendDomainCard(root, card, hostname, config) {
  if (config?.groupMode === 'domain') {
    root.appendChild(card);
    return;
  }
  const group = resolveGroupForHost(hostname, config);
  const key = `${group.type}:${group.id}`;
  let section = root.querySelector(`.groupingSection[data-group-key="${attrEscape(key)}"]`);
  if (!section) {
    section = createSection(group);
    root.appendChild(section);
  }
  section.querySelector('.groupingSection__body')?.appendChild(card);
  updateGroupingSection(section);
}

export function renderDomainGroups(root, groups, config) {
  if (config?.groupMode === 'domain') {
    for (const group of groups) root.appendChild(createCard(group.hostname, group.tabs));
    return;
  }
  for (const bucket of groupDomains(groups, config)) {
    const section = createSection(bucket);
    const body = section.querySelector('.groupingSection__body');
    for (const domain of bucket.domains) body.appendChild(createCard(domain.hostname, domain.tabs));
    root.appendChild(section);
    updateGroupingSection(section);
  }
}
