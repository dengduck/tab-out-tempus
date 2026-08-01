/**
 * Tab 网格协调器。首次 render 可全量绘制；tab 事件必须通过 applyChange 增量更新。
 * currentTabs 保存 DOM 的数据镜像；分组和重复检测拆到独立模块。
 */

import { h } from '../utils/dom.js';
import { getHostname, isHomepage, groupByDomain } from '../utils/domain.js';
import { normalizeUrl } from '../../shared/hostname.js';
import { create as createCard, updateTime as updateCardTime, updateBudget } from '../components/domainCard.js';
import { create as createChip, updateBadge as updateChipBadge, updateSaved } from '../components/tabChip.js';
import { render as renderHomepages } from './homepagesGroup.js';
import { resolveBudget, budgetStatus } from './groupingView.js';
import { appendDomainCard, renderDomainGroups, updateGroupingSection } from './tabsGridGrouping.js';
import { getDuplicateTabIds as findDuplicateTabIds, refreshDuplicates as refreshDupeDom } from './tabsGridDuplicates.js';

/** @type {HTMLElement|null} */
let rootEl = null;

/** @type {Map<number, any>} */
const currentTabs = new Map();
const savedUrls = new Set();
let currentConfig = { groupMode: 'domain' };

/**
 * 首次全量渲染。
 * @param {HTMLElement} root
 * @param {Array} tabs
 */
export function render(root, tabs, options = {}) {
  rootEl = root;
  currentConfig = options.config || currentConfig;
  savedUrls.clear();
  for (const entry of options.saved || []) {
    const normalized = normalizeUrl(entry.url);
    if (normalized) savedUrls.add(normalized);
  }
  currentTabs.clear();
  for (const t of tabs) if (typeof t.id === 'number') currentTabs.set(t.id, t);

  rootEl.innerHTML = '';
  const { homepages, groups } = groupByDomain(tabs);

  const homepagesCard = renderHomepages(homepages);
  if (homepagesCard) rootEl.appendChild(homepagesCard);

  renderDomainGroups(rootEl, groups, currentConfig);

  if (groups.length === 0 && homepages.length === 0) {
    rootEl.appendChild(h('p', { class: 'tabsGrid__empty' }, [
      '暂无可分组的标签页。（chrome:// 和扩展页不显示）',
    ]));
  }

  refreshDuplicates();
  refreshSavedStates();
}

function groupingSignature(config) {
  return JSON.stringify({
    groupMode: config?.groupMode || 'domain',
    categories: config?.categories || [],
    domainCategories: config?.domainCategories || {},
    customGroups: config?.customGroups || [],
  });
}

export function setConfig(config) {
  const previousSignature = groupingSignature(currentConfig);
  currentConfig = config || { groupMode: 'domain' };
  if (rootEl && groupingSignature(currentConfig) !== previousSignature) {
    const saved = Array.from(savedUrls, (url) => ({ url }));
    render(rootEl, Array.from(currentTabs.values()), { config: currentConfig, saved });
  }
}

export function setSavedEntries(entries = []) {
  savedUrls.clear();
  for (const entry of entries) {
    const normalized = normalizeUrl(entry.url);
    if (normalized) savedUrls.add(normalized);
  }
  refreshSavedStates();
}

export function setUrlSaved(url, isSaved) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  if (isSaved) savedUrls.add(normalized);
  else savedUrls.delete(normalized);
  refreshSavedStates();
}

function refreshSavedStates() {
  if (!rootEl) return;
  for (const [id, tab] of currentTabs) {
    const chip = rootEl.querySelector(`.tabChip[data-tab-id="${id}"]`);
    updateSaved(chip, savedUrls.has(normalizeUrl(tab.url)));
  }
}

/**
 * 增量应用一条 BCAST_TAB_CHANGE。
 * @param {'added'|'removed'|'updated'|'moved'} action
 * @param {any} tabInfo
 */
export function applyChange(action, tabInfo) {
  if (!rootEl || !tabInfo || typeof tabInfo.id !== 'number') return;

  if (action === 'added') {
    currentTabs.set(tabInfo.id, tabInfo);
    insertChipForTab(tabInfo);
    refreshDuplicates();
    refreshSavedStates();
    return;
  }

  if (action === 'removed') {
    removeChipForTab(tabInfo.id);
    currentTabs.delete(tabInfo.id);
    refreshDuplicates();
    return;
  }

  if (action === 'updated') {
    const prev = currentTabs.get(tabInfo.id);
    currentTabs.set(tabInfo.id, tabInfo);
    const prevBucket = prev ? bucketKeyFor(prev) : null;
    const nextBucket = bucketKeyFor(tabInfo);
    if (prev && prevBucket !== nextBucket) {
      // 从一个分组挪到另一个
      removeChipForTab(tabInfo.id);
      insertChipForTab(tabInfo);
    } else {
      // 就地更新
      updateChipInPlace(tabInfo);
    }
    refreshDuplicates();
    return;
  }

  if (action === 'moved') {
    currentTabs.set(tabInfo.id, tabInfo);
    const chip = rootEl.querySelector(`.tabChip[data-tab-id="${tabInfo.id}"]`);
    if (chip) chip.querySelector('.tabChip__title')?.setAttribute('data-window-id', String(tabInfo.windowId));
  }
}

/**
 * 事件委托：activate-tab / close-tab / close-all / close-homepages / save-for-later / close-duplicates。
 * @param {HTMLElement} root
 * @param {{onActivate: fn, onCloseTab: fn, onCloseAll: fn, onCloseHomepages: fn, onSaveForLater?: fn, onCloseDuplicates?: fn}} handlers
 */
export function bindEvents(root, handlers) {
  root.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    e.preventDefault();
    e.stopPropagation();

    if (action === 'activate-tab') {
      const id = Number(target.getAttribute('data-tab-id'));
      const wid = Number(target.getAttribute('data-window-id'));
      handlers.onActivate?.(id, wid);
    } else if (action === 'close-tab') {
      const id = Number(target.getAttribute('data-tab-id'));
      handlers.onCloseTab?.(id);
    } else if (action === 'close-all') {
      const host = target.getAttribute('data-hostname');
      handlers.onCloseAll?.(host);
    } else if (action === 'close-homepages') {
      handlers.onCloseHomepages?.();
    } else if (action === 'save-for-later') {
      const id = Number(target.getAttribute('data-tab-id'));
      handlers.onSaveForLater?.(id);
    } else if (action === 'close-duplicates') {
      const host = target.getAttribute('data-hostname');
      handlers.onCloseDuplicates?.(host);
    }
  });
}

/** 供外层根据 hostname 查 tabId 列表 */
export function getTabIdsByHostname(hostname) {
  return Array.from(currentTabs.values())
    .filter((t) => !isHomepage(t.url) && getHostname(t.url) === hostname)
    .map((t) => t.id);
}

export function getHomepageTabIds() {
  return Array.from(currentTabs.values())
    .filter((t) => isHomepage(t.url))
    .map((t) => t.id);
}

/**
 * 本地视觉移除 chip：加 leaving class → 180ms 后从 DOM 抽走 + 清空卡。
 * 后端 BCAST_TAB_CHANGE 'removed' 回流时 chip 已不存在，`removeChipForTab`
 * 里的 `if (!chip) return` 兜底，不会冲突。
 * @param {number} tabId
 */
export function animateRemoveChip(tabId) {
  if (!rootEl) return;
  const chip = rootEl.querySelector(`.tabChip[data-tab-id="${tabId}"]`);
  if (!chip) return;
  chip.classList.add('tabChip--leaving');
  currentTabs.delete(tabId);
  refreshDuplicates();  // 立即刷新（视觉上 chip 正在淡出，但 badge 已更新）
  setTimeout(() => {
    const card = chip.closest('.domainCard');
    chip.remove();
    if (card) {
      const remaining = card.querySelectorAll('.tabChip').length;
      const section = card.closest('.groupingSection');
      if (remaining === 0) {
        card.remove();
        updateGroupingSection(section);
        maybeShowEmptyState();
      } else {
        updateCardCount(card);
        updateGroupingSection(section);
      }
    }
  }, 200);
}

/**
 * 查询 chip 在视口中的坐标（用于 confetti burst）。
 * @param {number} tabId
 * @returns {{x:number, y:number}|null}
 */
export function getChipCenter(tabId) {
  if (!rootEl) return null;
  const chip = rootEl.querySelector(`.tabChip[data-tab-id="${tabId}"]`);
  if (!chip) return null;
  const r = chip.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ========== 内部 helper ==========

function bucketKeyFor(tabInfo) {
  if (isHomepage(tabInfo.url)) return '__homepages';
  return getHostname(tabInfo.url) || '__invalid';
}

function insertChipForTab(tabInfo) {
  const key = bucketKeyFor(tabInfo);
  if (key === '__invalid') return;  // chrome:// 等

  // 找到/创建对应的 card（属性选择器值用双引号，只需转义 " 和 \）
  let card = rootEl.querySelector(`.domainCard[data-hostname="${attrEscape(key)}"]`);
  if (!card) {
    // 新建一张 card。homepages 专用；其他走 domainCard
    if (key === '__homepages') {
      card = renderHomepages([tabInfo]);
      if (card) rootEl.insertBefore(card, rootEl.firstChild);  // homepages 始终置顶
    } else {
      card = createCard(key, [tabInfo]);
      appendDomainCard(rootEl, card, key, currentConfig);
    }
    removeEmptyState();
    return;
  }

  // 已有 card → append chip + 更新 count
  const chipsWrap = card.querySelector('.domainCard__chips');
  chipsWrap?.appendChild(createChip(tabInfo, { isSaved: savedUrls.has(normalizeUrl(tabInfo.url)) }));
  updateCardCount(card);
  updateGroupingSection(card.closest('.groupingSection'));
}

function removeChipForTab(tabId) {
  const chip = rootEl.querySelector(`.tabChip[data-tab-id="${tabId}"]`);
  if (!chip) return;
  const card = chip.closest('.domainCard');
  chip.remove();
  if (card) {
    const remaining = card.querySelectorAll('.tabChip').length;
    const section = card.closest('.groupingSection');
    if (remaining === 0) {
      card.remove();
      updateGroupingSection(section);
      maybeShowEmptyState();
    } else {
      updateCardCount(card);
      updateGroupingSection(section);
    }
  }
}

function updateChipInPlace(tabInfo) {
  const chip = rootEl.querySelector(`.tabChip[data-tab-id="${tabInfo.id}"]`);
  if (!chip) return;
  const titleEl = chip.querySelector('.tabChip__title');
  if (titleEl) {
    titleEl.textContent = tabInfo.title || tabInfo.url || '(untitled)';
    titleEl.setAttribute('title', tabInfo.title || tabInfo.url);
    titleEl.setAttribute('href', tabInfo.url);
  }
  const fav = chip.querySelector('.tabChip__favicon');
  if (fav && tabInfo.favIconUrl) fav.setAttribute('src', tabInfo.favIconUrl);
}

function updateCardCount(card) {
  const count = card.querySelectorAll('.tabChip').length;
  const countEl = card.querySelector('.domainCard__count');
  if (countEl) countEl.textContent = ` (${count})`;
  const closeBtn = card.querySelector('[data-action="close-all"], [data-action="close-homepages"]');
  if (closeBtn) {
    if (closeBtn.getAttribute('data-action') === 'close-all') {
      closeBtn.textContent = `关闭全部 ${count} 个`;
    } else {
      closeBtn.textContent = `关闭全部首页`;
    }
  }
}

function removeEmptyState() {
  rootEl.querySelector('.tabsGrid__empty')?.remove();
}

function maybeShowEmptyState() {
  if (!rootEl.querySelector('.domainCard')) {
    rootEl.appendChild(h('p', { class: 'tabsGrid__empty' }, [
      '暂无可分组的标签页。',
    ]));
  }
}

// 属性选择器双引号内只需转义反斜杠和双引号
function attrEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ========== M5：时间快照刷新 ==========

/**
 * 批量更新所有 chip badge + 域名卡聚合时长。
 * @param {{tabTimes: Record<number, number>, activeTabId: number|null}} snapshot
 *   tabTimes: {tabId: cumulativeMs(含 running)}
 *   activeTabId: 当前正在计时的 tab（用来给 chip 加 is-active 高亮）
 *
 * 为什么把"探 DOM"收在这里不让 main.js 做：
 *   main.js 应该只管 "数据流 + 事件"，tabsGrid 是"DOM 真相源"。这符合 M0
 *   的 D11（UI 层 DOM 查询不跨模块）。
 */
export function applyTimeSnapshot(snapshot) {
  if (!rootEl || !snapshot || typeof snapshot !== 'object') return;
  const { tabTimes = {}, domainTimes = {}, activeTabId = null } = snapshot;

  // 1. chip 级
  const chips = rootEl.querySelectorAll('.tabChip');
  chips.forEach((chip) => {
    const id = Number(chip.getAttribute('data-tab-id'));
    if (!Number.isFinite(id)) return;
    const ms = tabTimes[id] || 0;
    updateChipBadge(chip, ms, id === activeTabId);
  });

  // 2. 域名卡聚合：遍历 currentTabs 按 hostname 汇总
  const byHost = new Map();  // hostname -> sum
  for (const [id, info] of currentTabs) {
    if (isHomepage(info.url)) continue;  // homepages 卡不显示时长（M5 版）
    const host = getHostname(info.url);
    if (!host) continue;
    const ms = tabTimes[id] || 0;
    byHost.set(host, (byHost.get(host) || 0) + ms);
  }

  const cards = rootEl.querySelectorAll('.domainCard:not(.domainCard--homepages)');
  cards.forEach((card) => {
    const host = card.getAttribute('data-hostname');
    if (!host) return;
    const openTabTotal = byHost.get(host) || 0;
    updateCardTime(card, openTabTotal);
    const usedToday = domainTimes[host] ?? openTabTotal;
    const budget = resolveBudget(host, currentConfig);
    updateBudget(card, usedToday, budget, budgetStatus(usedToday, budget));
  });
}

/**
 * 获取指定域名下应被关闭的重复 tab ID 列表。
 * 同一归一化 URL 保留 firstSeen 最小（即 id 最小）的 tab，关闭其余。
 * @param {string} [hostname] 可选，不传则返回全局所有应关闭的重复 tabId
 * @returns {number[]}
 */
export function getDuplicateTabIds(hostname) {
  return findDuplicateTabIds(currentTabs, hostname);
}

function refreshDuplicates() {
  refreshDupeDom(rootEl, currentTabs);
}
