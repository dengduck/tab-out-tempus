import { getHostname, isHomepage } from '../utils/domain.js';
import { normalizeUrl } from '../../shared/hostname.js';
import { updateDupeBadge } from '../components/tabChip.js';
import { updateDupeButton } from '../components/domainCard.js';

export function buildDupeMap(currentTabs) {
  const urlMap = new Map();
  for (const [id, info] of currentTabs) {
    const normalized = normalizeUrl(info.url);
    if (!normalized) continue;
    if (!urlMap.has(normalized)) urlMap.set(normalized, []);
    urlMap.get(normalized).push(id);
  }
  return urlMap;
}

export function getDuplicateTabIds(currentTabs, hostname) {
  const toClose = [];
  for (const ids of buildDupeMap(currentTabs).values()) {
    if (ids.length < 2) continue;
    if (hostname) {
      const tab = currentTabs.get(ids[0]);
      if (!tab) continue;
      const host = isHomepage(tab.url) ? '__homepages' : getHostname(tab.url);
      if (host !== hostname) continue;
    }
    const sorted = [...ids].sort((a, b) => a - b);
    toClose.push(...sorted.slice(1));
  }
  return toClose;
}

export function refreshDuplicates(root, currentTabs) {
  if (!root) return;
  const urlMap = buildDupeMap(currentTabs);
  const counts = new Map();
  for (const ids of urlMap.values()) {
    for (const id of ids) counts.set(id, ids.length);
  }
  root.querySelectorAll('.tabChip').forEach((chip) => {
    const id = Number(chip.getAttribute('data-tab-id'));
    if (Number.isFinite(id)) updateDupeBadge(chip, counts.get(id) || 0);
  });

  const closeCounts = new Map();
  for (const ids of urlMap.values()) {
    if (ids.length < 2) continue;
    const tab = currentTabs.get(ids[0]);
    if (!tab) continue;
    const host = isHomepage(tab.url) ? '__homepages' : getHostname(tab.url);
    if (host) closeCounts.set(host, (closeCounts.get(host) || 0) + ids.length - 1);
  }
  root.querySelectorAll('.domainCard').forEach((card) => {
    const host = card.getAttribute('data-hostname');
    if (host) updateDupeButton(card, closeCounts.get(host) || 0);
  });
}
