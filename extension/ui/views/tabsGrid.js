/**
 * ui/views/tabsGrid.js
 * ---------------------
 * 域名分组的 tab 网格（主视图）。
 *
 * 契约（ARCHITECTURE-v2 §8 / DECISIONS D11）：
 *   - render(tabs)                 首次全量渲染
 *   - applyChange(action, tabInfo) 增量 diff 更新（**禁止整页重绘**）
 *   - bindEvents(rootEl, handlers) 事件委托绑定（activate / close-tab / close-all）
 *
 * 里程碑：M2（render + 增量 + 委托事件）+ M5（chip badge）。
 *
 * 增量策略（M2 版，足够简单）：
 *   - added:   groupByDomain 重跑，找到对应 group；DOM 里有就 append chip；没有就 createCard 插入
 *   - removed: 找到 chip 移除；如果 group 空了就移除整张卡
 *   - updated: 若 hostname 变了 → 当作 remove+add；若只是 title/favicon 变 → 就地改那个 chip
 *   - moved:   只改 chip 的 data-window-id
 *
 * 为了实现简单，M2 保留一份 `currentTabs` 内存副本，作为增量时的 before-snapshot。
 */

import { h } from '../utils/dom.js';
import { getHostname, isHomepage, groupByDomain } from '../utils/domain.js';
import { normalizeUrl } from '../../shared/hostname.js';
import { create as createCard, updateTime as updateCardTime, updateDupeButton } from '../components/domainCard.js';
import { create as createChip, updateBadge as updateChipBadge, updateDupeBadge } from '../components/tabChip.js';
import { render as renderHomepages } from './homepagesGroup.js';

/** @type {HTMLElement|null} */
let rootEl = null;

/** @type {Map<number, any>} */
const currentTabs = new Map();

/**
 * 首次全量渲染。
 * @param {HTMLElement} root
 * @param {Array} tabs
 */
export function render(root, tabs) {
  rootEl = root;
  currentTabs.clear();
  for (const t of tabs) if (typeof t.id === 'number') currentTabs.set(t.id, t);

  rootEl.innerHTML = '';
  const { homepages, groups } = groupByDomain(tabs);

  const homepagesCard = renderHomepages(homepages);
  if (homepagesCard) rootEl.appendChild(homepagesCard);

  for (const g of groups) {
    rootEl.appendChild(createCard(g.hostname, g.tabs));
  }

  if (groups.length === 0 && homepages.length === 0) {
    rootEl.appendChild(h('p', { class: 'tabsGrid__empty' }, [
      '暂无可分组的标签页。（chrome:// 和扩展页不显示）',
    ]));
  }

  refreshDuplicates();
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
      if (remaining === 0) {
        card.remove();
        maybeShowEmptyState();
      } else {
        updateCardCount(card);
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
      rootEl.appendChild(card);
    }
    removeEmptyState();
    return;
  }

  // 已有 card → append chip + 更新 count
  const chipsWrap = card.querySelector('.domainCard__chips');
  chipsWrap?.appendChild(createChip(tabInfo));
  updateCardCount(card);
}

function removeChipForTab(tabId) {
  const chip = rootEl.querySelector(`.tabChip[data-tab-id="${tabId}"]`);
  if (!chip) return;
  const card = chip.closest('.domainCard');
  chip.remove();
  if (card) {
    const remaining = card.querySelectorAll('.tabChip').length;
    if (remaining === 0) {
      card.remove();
      maybeShowEmptyState();
    } else {
      updateCardCount(card);
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
  const { tabTimes = {}, activeTabId = null } = snapshot;

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
    const total = byHost.get(host) || 0;
    updateCardTime(card, total);
  });
}

/**
 * 获取指定域名下应被关闭的重复 tab ID 列表。
 * 同一归一化 URL 保留 firstSeen 最小（即 id 最小）的 tab，关闭其余。
 * @param {string} [hostname] 可选，不传则返回全局所有应关闭的重复 tabId
 * @returns {number[]}
 */
export function getDuplicateTabIds(hostname) {
  const urlMap = buildDupeMap();
  const toClose = [];
  for (const ids of urlMap.values()) {
    if (ids.length < 2) continue;
    // 过滤到指定域名（如果提供）
    if (hostname) {
      const tab0 = currentTabs.get(ids[0]);
      if (!tab0) continue;
      const host = isHomepage(tab0.url) ? '__homepages' : getHostname(tab0.url);
      if (host !== hostname) continue;
    }
    // 保留 id 最小的（通常是最早打开的），关闭其余
    const sorted = [...ids].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) toClose.push(sorted[i]);
  }
  return toClose;
}

// ========== 重复标签检测 ==========

/**
 * 构建 normalizedUrl → [tabId, ...] 映射。
 * @returns {Map<string, number[]>}
 */
function buildDupeMap() {
  const urlMap = new Map();
  for (const [id, info] of currentTabs) {
    const norm = normalizeUrl(info.url);
    if (!norm) continue;
    if (!urlMap.has(norm)) urlMap.set(norm, []);
    urlMap.get(norm).push(id);
  }
  return urlMap;
}

/**
 * 全量刷新所有 chip 的重复 badge + 所有 domainCard 的"关闭重复"按钮。
 * 每次 render / applyChange 后调用。
 */
function refreshDuplicates() {
  if (!rootEl) return;
  const urlMap = buildDupeMap();

  // 反转：tabId → dupeCount（该 URL 出现次数）
  const tabDupeCount = new Map();
  for (const ids of urlMap.values()) {
    for (const id of ids) tabDupeCount.set(id, ids.length);
  }

  // 1. 更新每个 chip 的重复 badge
  const chips = rootEl.querySelectorAll('.tabChip');
  chips.forEach((chip) => {
    const id = Number(chip.getAttribute('data-tab-id'));
    if (!Number.isFinite(id)) return;
    updateDupeBadge(chip, tabDupeCount.get(id) || 0);
  });

  // 2. 按域名统计应关闭的重复数，更新 domainCard 按钮
  const hostDupeClose = new Map();  // hostname → count of tabs to close
  for (const [norm, ids] of urlMap) {
    if (ids.length < 2) continue;
    const tab0 = currentTabs.get(ids[0]);
    if (!tab0) continue;
    const host = isHomepage(tab0.url) ? '__homepages' : getHostname(tab0.url);
    if (!host) continue;
    // 该 URL 组要关闭的 = ids.length - 1（保留一个）
    hostDupeClose.set(host, (hostDupeClose.get(host) || 0) + (ids.length - 1));
  }

  const cards = rootEl.querySelectorAll('.domainCard');
  cards.forEach((card) => {
    const host = card.getAttribute('data-hostname');
    if (!host) return;
    updateDupeButton(card, hostDupeClose.get(host) || 0);
  });
}

/** 给 main.js 查询当前所有 open tabId（用来批量请求 SW 的时间快照） */
export function getAllTabIds() {
  return Array.from(currentTabs.keys());
}
