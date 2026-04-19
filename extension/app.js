/* ================================================================
   Tab Out Tempus — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

/* ================================================================
   📑 TABLE OF CONTENTS — Quick Navigation
   ================================================================

   §1  INTERNATIONALIZATION (i18n)              ~L113  — I18N object + translations
        · I18N.t(), I18N.toggle(), I18N.load/save

   §2  CHROME TABS — Direct API Access          ~L312
        · escapeHtml()                           L324
        · ─ Tab Timer State (timeLog model) ──   L332
        · ─ timeLog Query Helpers ────────────   L375
        · getSessionData(), getMonthKeys()
        · readTimeLogRange(), aggregateTimeLog()
        · getLocalTodayRange(), getTodayHistoricalTotal()
        · formatDuration()                       L509
        · refreshTimerDisplay()                  L539
        · fetchOpenTabs()                        L591
        · closeTabsByUrls(), closeTabsExact()    L622
        · focusTab(), closeDuplicateTabs()
        · closeTempusDupes()

   §3  SAVED FOR LATER — chrome.storage.local    ~L758
        · saveTabForLater()                      L785
        · getSavedTabs(), checkOffSavedTab(), dismissSavedTab()

   §4  UI HELPERS                                ~L844
        · playCloseSound()                       L855
        · shootConfetti()                        L904
        · animateCardOut(), showToast()          L995
        · openSettingsPanel()                    L1006
        · exportAllHistory()                     L1044
        · importHistory()                        L1083
        · closeSettingsPanel()
        · timeAgo(), getGreeting(), getDateDisplay()

   §5  DOMAIN & TITLE CLEANUP                   ~L1256
        · FRIENDLY_DOMAINS map
        · friendlyDomain(), stripTitleNoise(), cleanTitle(), smartTitle()

   §6  SVG ICONS                                ~L1434
   §7  IN-MEMORY STORE (domainGroups)           ~L1445
   §8  HELPER: getRealTabs() / filters          ~L1451
        · checkTempusDupes()                     L1480
        · checkDomainSprawl()                    L1512

   §9  HEATMAP & PRODUCTIVITY BANNER            ~L1559
        · renderHeatmap()                        L1559
        · renderProductivityBanner()             L1646
        · syncPrivateMode() + countdown          L1714

   §10 OVERFLOW CHIPS                           ~L1845
        · buildOverflowChips()                   L1849

   §11 DOMAIN CARD RENDERER                     ~L1883
        · renderDomainCard()                     L1894

   §12 SAVED FOR LATER — Render Column          ~L2044
        · renderDeferredColumn()                 L2055
        · renderDeferredItem(), renderArchiveItem()

   §13 MAIN DASHBOARD RENDERER                  ~L2151
        · renderStaticDashboard()                L2166 ← main entry
        · renderDashboard()

   §14 EVENT HANDLERS (delegation)              ~L2343
        · document click listener                 ← all button clicks
        · archive toggle, import input, search

   §15 HISTORY STATS — storage aggregation      ~L2891
        · getLocalDateRangeMs()                  L2901
        · getStatsData()                         L2934
        · clearDomainHistory()                   L2960
        · add/remove/getBlockedDomains()
        · renderStatsView()                      L3033

   §16 INITIALIZE                               ~L3102
        · currentView, hiddenDomains, blockedDomains state   L3105
        · startTimerInterval() / stopTimerInterval()         L3115
        · visibilitychange listener
        · language toggle button handler
        · updateLangFlag()                       L3175
        · updateUIText()                         L3186
        · Async IIFE for initial render (end of file)

   ================================================================
   🔍 Tip: Line numbers are approximate. After large edits, they drift.
   Search by function name (e.g., `function refreshTimerDisplay`) for
   exact location.
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   INTERNATIONALIZATION (i18n)
   ---------------------------------------------------------------- */

const I18N = {
  currentLang: 'en',

  translations: {
    en: {
      // Header
      'Time spent': 'Time spent',
      'Private': 'Private Mode',
      'Right now': 'Right now',
      'Open tabs': 'Open tabs',

      // View switcher
      'Today': 'Today',
      'This Week': 'This Week',
      'This Month': 'This Month',
      'This Year': 'This Year',

      // Domain card
      'tabs open': 'tabs open',
      'tab open': 'tab open',
      'duplicate': 'duplicate',
      'duplicates': 'duplicates',
      'Close all': 'Close all',
      'Close': 'Close',
      'Close duplicates': 'Close duplicates',
      'Save for later': 'Save for later',
      'Wake up': 'Wake up',
      'Hide': 'Hide',
      'Delete': 'Delete',
      'Block & Delete': 'Block & Delete',
      '休眠': 'Sleep',
      '唤醒': 'Wake',
      '已关闭': 'Closed',
      '个未读标签': 'stale tabs',
      '天未读': 'days stale',
      '个月未读': 'months stale',
      '清理': 'Clear',

      // Banners
      '域名分散提示': ' domains open — tabs spread across too many sites',
      '知道了': 'Got it',
      'Tab Out Tempus 重复提示': 'Tab Out Tempus tabs open',
      'Keep just this one?': 'Keep just this one?',
      'Close extras': 'Close extras',

      // Stats view
      'No data yet': 'No data yet',
      'Start browsing to see your stats here.': 'Start browsing to see your stats here.',
      'total': 'total',
      'domains': 'domains',
      'hours': 'hours',
      'minutes': 'minutes',
      '刚刚': 'Just now',

      // Settings / Privacy
      '设置': 'Settings',
      '导出历史记录': 'Export History',
      '导入历史记录': 'Import History',
      '隐私模式': 'Private Mode',
      '隐私模式说明': 'Pause tracking while private mode is active',
      '开启隐私模式': 'Enable private mode',
      '退出隐私模式': 'Exit private mode',
      '隐私模式开启，到午夜自动关闭': 'Private mode on until midnight',
      '隐私模式开启，暂停计时': 'Private mode on, tracking paused for',
      '隐私模式已关闭': 'Private mode off',
      '隐私模式已自动关闭': 'Private mode auto-closed',
      '后自动关闭': 'before auto-close',

      // Saved for later
      'Saved for later': 'Saved for later',
      'Nothing saved. Living in the moment.': 'Nothing saved. Living in the moment.',
      'Archive': 'Archive',

      // Misc
      'Homepages': 'Homepages',
      '个域名': 'domains',
      '个标签': 'tabs',
    },

    zh: {
      // Header
      'Time spent': '已工作',
      'Private': '打开隐私模式',
      'Right now': '当前',
      'Open tabs': '打开的标签页',

      // View switcher
      'Today': '今日',
      'This Week': '本周',
      'This Month': '本月',
      'This Year': '今年',

      // Domain card
      'tabs open': '个标签页打开',
      'tab open': '个标签页打开',
      'duplicate': '重复',
      'duplicates': '重复',
      'Close all': '关闭全部',
      'Close': '关闭',
      'Close duplicates': '关闭重复',
      'Save for later': '稍后阅读',
      'Wake up': '唤醒',
      'Hide': '隐藏',
      'Delete': '删除',
      'Block & Delete': '加入隐私名单并删除',
      'Sleep': '休眠',
      'Wake': '唤醒',
      'Closed': '已关闭',
      'stale tabs': '个未读标签',
      'days stale': '天未读',
      'months stale': '个月未读',
      'Clear': '清理',

      // Banners
      ' domains open — tabs spread across too many sites': ' 个域名同时打开，标签页过于分散',
      'Got it': '知道了',
      'Tab Out Tempus tabs open': 'Tab Out Tempus 标签页打开',
      'Keep just this one?': '只保留这个？',
      'Close extras': '关闭其他',

      // Stats view
      'No data yet': '暂无数据',
      'Start browsing to see your stats here.': '开始浏览后在这里查看统计。',
      'total': '总计时长',
      'domains': '个域名',
      'hours': '小时',
      'minutes': '分钟',
      'Just now': '刚刚',

      // Settings / Privacy
      'Settings': '设置',
      'Export History': '导出历史记录',
      'Import History': '导入历史记录',
      'Private Mode': '隐私模式',
      'Pause tracking while private mode is active': '开启隐私模式期间暂停计时',
      'Enable private mode': '开启隐私模式',
      'Exit private mode': '退出隐私模式',
      'Private mode on until midnight': '隐私模式开启，到午夜自动关闭',
      'Private mode on, tracking paused for': '隐私模式开启，暂停计时',
      'Private mode off': '隐私模式已关闭',
      'Private mode auto-closed': '隐私模式已自动关闭',
      'before auto-close': '后自动关闭',

      // Saved for later
      'Saved for later': '稍后阅读',
      'Nothing saved. Living in the moment.': '暂无保存的内容，活在当下。',
      'Archive': '归档',

      // Misc
      'Homepages': '首页',
      'domains': '个域名',
      'tabs': '个标签页',
    }
  },

  /**
   * Get translated string. Returns original if not found.
   * @param {string} key - English key (default language)
   * @returns {string}
   */
  t(key) {
    if (this.currentLang === 'zh' && this.translations.zh[key]) {
      return this.translations.zh[key];
    }
    return key;
  },

  /**
   * Toggle between 'en' and 'zh'
   */
  toggle() {
    this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
    this.save();
    return this.currentLang;
  },

  /**
   * Save current language to storage
   */
  save() {
    try {
      chrome.storage.local.set({ i18nLang: this.currentLang });
    } catch {}
  },

  /**
   * Load language from storage
   */
  async load() {
    try {
      const { i18nLang } = await chrome.storage.local.get('i18nLang');
      if (i18nLang === 'en' || i18nLang === 'zh') {
        this.currentLang = i18nLang;
      }
    } catch {}
  }
};


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

/**
 * Escape HTML special characters to prevent XSS when injecting into innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// ─── Tab Timer State (v1.3.1 — timeLog model) ─────────────────────────────────
/** Active session info from background.js */
let activeRunningMs = 0;
let activeHostname = null;
let activeTabId = null;
/** Basic tab info (hostname/title) for all tracked tabs */
let tabInfoMap = {};

/** Private mode state — set after syncing with background.js */
let privateModeActive = false;
let privateModeEndTime = null;
let privateModeInterval = null;

/** Cached today's total from timeLog (ms) — refreshed periodically */
let todayTimeLogTotalMs = 0;
let todayTimeLogByHostname = {};  // hostname → ms
let todayTimeLogByTid = {};        // tabId → ms (v1.3.3, for per-tab badges)
let lastTimeLogCacheTime = 0;
const TIMELOG_CACHE_INTERVAL_MS = 10000; // refresh every 10s

// v1.3.5: Per-tab lifetime display now reads cumulativeMs directly from
// GET_SESSION_DATA. No more timeLog-aggregation cache — cumulativeMs is
// monotonic and the SW hands us the latest value on every tick.

/** Timer refresh interval ID (for visibility control) */
let timerIntervalId = null;

/**
 * Query background.js for current active session data.
 * Returns only the active tab's running time (no totalTime accumulation).
 */
async function getSessionData() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA' });
    activeRunningMs = response?.activeRunningMs || 0;
    activeHostname = response?.activeHostname || null;
    activeTabId = response?.activeTabId || null;
    tabInfoMap = response?.tabInfo || {};
    return response || {};
  } catch {
    activeRunningMs = 0;
    activeHostname = null;
    activeTabId = null;
    tabInfoMap = {};
    return {};
  }
}

// ─── timeLog Query Helpers ────────────────────────────────────────────────────

/**
 * Get the UTC month keys ("YYYY-MM") that a time range spans.
 * @param {number} startMs - UTC timestamp (ms)
 * @param {number} endMs - UTC timestamp (ms)
 * @returns {string[]}
 */
function getMonthKeys(startMs, endMs) {
  const startMonth = new Date(startMs).toISOString().slice(0, 7);
  const endMonth = new Date(endMs).toISOString().slice(0, 7);
  if (startMonth === endMonth) return [startMonth];

  // Generate all months between start and end
  const months = [];
  const d = new Date(startMs);
  d.setUTCDate(1);
  while (d.getTime() <= endMs) {
    months.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Read timeLog entries from storage for a given UTC time range.
 * Returns all entries that overlap with [rangeStartMs, rangeEndMs).
 * @param {number} rangeStartMs
 * @param {number} rangeEndMs
 * @returns {Promise<Array<{s: number, e: number, h: string}>>}
 */
async function readTimeLogRange(rangeStartMs, rangeEndMs) {
  const monthKeys = getMonthKeys(rangeStartMs, rangeEndMs);
  const storageKeys = monthKeys.map(m => `timeLog.${m}`);

  const items = await new Promise(resolve => {
    chrome.storage.local.get(storageKeys, resolve);
  });

  const result = [];
  for (const sKey of storageKeys) {
    const logs = items[sKey] || [];
    for (const entry of logs) {
      // Check if this entry overlaps with the range
      if (entry.e > rangeStartMs && entry.s < rangeEndMs) {
        result.push(entry);
      }
    }
  }
  return result;
}

/**
 * Calculate total ms per hostname from timeLog entries within a time range.
 * Uses interval intersection for precise clipping at range boundaries.
 *
 * v1.3.3: Also returns byTid (per-tab breakdown) for entries that carry `tid`.
 * Legacy entries without tid contribute to byHostname only (not byTid).
 *
 * @param {number} rangeStartMs
 * @param {number} rangeEndMs
 * @param {string[]} [blockedOverride] - Optional pre-loaded blocked list to avoid re-reading storage
 * @returns {Promise<{total: number, byHostname: Object.<string, number>, byTid: Object.<string, number>}>}
 */
async function aggregateTimeLog(rangeStartMs, rangeEndMs, blockedOverride) {
  const entries = await readTimeLogRange(rangeStartMs, rangeEndMs);

  // Use provided blocked list or load from storage
  const blocked = blockedOverride
    ?? (await chrome.storage.local.get('blockedDomains')).blockedDomains
    ?? [];

  let total = 0;
  const byHostname = {};
  const byTid = {};

  for (const entry of entries) {
    if (entry.h === '__internal__') continue;
    if (blocked.includes(entry.h)) continue;

    // Interval intersection: clip to range
    const overlapStart = Math.max(entry.s, rangeStartMs);
    const overlapEnd = Math.min(entry.e, rangeEndMs);
    if (overlapStart >= overlapEnd) continue;

    const ms = overlapEnd - overlapStart;
    total += ms;
    byHostname[entry.h] = (byHostname[entry.h] || 0) + ms;
    if (entry.tid != null) {
      byTid[entry.tid] = (byTid[entry.tid] || 0) + ms;
    }
  }

  return { total, byHostname, byTid };
}

/**
 * Get LOCAL "today" boundaries as UTC timestamps.
 * @returns {{ dayStartMs: number, dayEndMs: number }}
 */
function getLocalTodayRange() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    dayStartMs: dayStart.getTime(),
    dayEndMs: dayStart.getTime() + 86400000,
  };
}

/**
 * v1.3.5: aggregateOpenTabsLifetime() was removed. Per-tab lifetime is now a
 * monotonic counter maintained by background.js (cumulativeMs), not derived
 * from timeLog. This eliminates the "time goes backwards" class of bugs.
 *
 * Legacy note: earlier versions read [earliestFirstSeen, now] from timeLog and
 * dispatched entries by tid. That approach broke whenever the SW was killed
 * mid-slice and woke without recovering — leading to visible rollbacks.
 */

/**
 * Get today's total browsing time from timeLog.
 * Uses a cache to avoid reading storage every refresh cycle.
 * @returns {Promise<number>} Total milliseconds for local today
 */
async function getTodayHistoricalTotal() {
  const now = Date.now();
  if (now - lastTimeLogCacheTime < TIMELOG_CACHE_INTERVAL_MS) {
    return todayTimeLogTotalMs;
  }

  try {
    const { dayStartMs, dayEndMs } = getLocalTodayRange();
    const { total, byHostname } = await aggregateTimeLog(dayStartMs, dayEndMs);
    todayTimeLogTotalMs = total;
    todayTimeLogByHostname = byHostname;
    lastTimeLogCacheTime = now;
  } catch {
    // Keep using cached value on error
  }

  return todayTimeLogTotalMs;
}

/**
 * Format milliseconds into a human-readable duration string.
 *
 * v1.3.5: Minimum display unit is now 1 minute for non-active contexts
 * (domain cards + tab chips), to avoid the "death second" illusion where a
 * paused counter shows e.g. "3s" forever. For callers that want seconds
 * (header total-time with active slice), pass allowSeconds=true.
 *
 * Modes:
 *   - < 1 min + allowSeconds: "45秒" / "45s"
 *   - < 1 min otherwise:      "<1分钟" / "<1m"
 *   - < 1 hour:               "45分钟"
 *   - ≥ 1 hour:               "1.5小时"
 *   - ≥ 1 day:                "1天3小时"
 *
 * @param {number} ms - Duration in milliseconds
 * @param {{allowSeconds?: boolean}} [opts]
 * @returns {string}
 */
function formatDuration(ms, opts) {
  if (ms < 0) ms = 0;
  const isZh = I18N.currentLang === 'zh';
  const allowSeconds = !!(opts && opts.allowSeconds);
  const seconds = Math.floor(ms / 1000);

  if (allowSeconds) {
    if (seconds < 5) return isZh ? '刚刚' : 'Just now';
    if (seconds < 60) return isZh ? `${seconds}秒` : `${seconds}s`;
  } else {
    // v1.3.5: minute is the minimum unit for non-active displays
    if (seconds < 60) return isZh ? '<1分钟' : '<1m';
  }

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return isZh ? `${minutes}分钟` : `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = hours.toFixed(1).replace(/\.0$/, '');
    return isZh ? h + '小时' : h + 'h';
  }
  const days = Math.floor(hours / 24);
  const remainingHours = Math.floor(hours % 24);
  if (remainingHours === 0) {
    return isZh ? `${days}天` : `${days}d`;
  }
  return isZh ? `${days}天${remainingHours}小时` : `${days}d ${remainingHours}h`;
}

/**
 * Refresh the timer display — called every 5s via setInterval (with visibility control).
 * Updates header total time and all visible domain card times + per-tab badges.
 *
 * v1.3.5 time models:
 *   - Header "今日工作"       = historicalMs (from timeLog, dayStart → now)
 *                              + activeRunningMs (current unfinalised slice)
 *   - Per-tab chip badge      = tabInfo[id].cumulativeMs  (monotonic, from SW)
 *                              + activeRunningMs if this is the active tab
 *   - Domain card time        = Σ(chip times) across open tabs in that domain
 *
 * cumulativeMs comes directly from background.js and is monotonic — it never
 * decreases. Time tracking for non-active tabs jumps when the user switches
 * away from them (that's when the slice is finalised), which is the correct
 * user-visible model: "how much of the tab's active foreground time".
 */
async function refreshTimerDisplay() {
  await getSessionData();

  // ── HEADER: today total (unchanged) ──
  const historicalMs = await getTodayHistoricalTotal();

  // activeMs: the current active tab's unfinalised running time, clipped to today
  let activeMsToday = 0;
  if (activeRunningMs > 0 && activeHostname && activeHostname !== '__internal__') {
    const { dayStartMs, dayEndMs } = getLocalTodayRange();
    const now = Date.now();
    const runStart = now - activeRunningMs;
    const overlapStart = Math.max(runStart, dayStartMs);
    const overlapEnd = Math.min(now, dayEndMs);
    if (overlapStart < overlapEnd) {
      activeMsToday = overlapEnd - overlapStart;
    }
  }

  const totalMs = historicalMs + activeMsToday;
  const totalEl = document.getElementById('totalWorkTime');
  if (totalEl) {
    totalEl.textContent = formatDuration(totalMs);
  }

  // ── DOMAIN CARDS + TAB CHIPS: direct read from cumulativeMs ──
  // No more aggregation over timeLog — the SW already accumulated this.
  const cardTimes = {};  // hostname → ms
  const tabTimes = {};   // tabId → ms

  for (const tidStr in tabInfoMap) {
    const info = tabInfoMap[tidStr];
    if (!info || !info.hostname || info.hostname === '__internal__') continue;
    let ms = info.cumulativeMs || 0;
    // Merge the unfinalised slice into the active tab
    if (activeTabId != null && String(activeTabId) === tidStr && activeRunningMs > 0) {
      ms += activeRunningMs;
    }
    tabTimes[tidStr] = ms;
    cardTimes[info.hostname] = (cardTimes[info.hostname] || 0) + ms;
  }

  // Update domain cards
  for (const hostname in cardTimes) {
    const timeMs = cardTimes[hostname];
    // Review fix #13: escape hostname to avoid breaking CSS selector
    const card = document.querySelector(`.mission-card[data-hostname="${CSS.escape(hostname)}"]`);
    if (card) {
      const timeEl = card.querySelector('.group-time-badge');
      if (timeEl) {
        timeEl.textContent = formatDuration(timeMs);
      }
    }
  }

  // Update per-tab chip badges
  for (const tidStr in tabTimes) {
    const ms = tabTimes[tidStr];
    const chip = document.querySelector(`.page-chip[data-tab-id="${tidStr}"]`);
    if (chip) {
      const badge = chip.querySelector('.chip-time-badge');
      if (badge) {
        badge.textContent = formatDuration(ms);
        badge.classList.toggle('chip-time-zero', ms < 60000);
      }
    }
  }
}

// v1.3.5: refreshLifetimeCache() was removed — lifetime now comes from
// cumulativeMs in GET_SESSION_DATA, which is always fresh (<5s old).

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out Tempus's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      discarded: t.discarded || false,
      // Flag Tab Out Tempus's own pages so we can detect duplicate new tabs
      isTempus: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTempusDupes()
 *
 * Closes all duplicate Tab Out Tempus new-tab pages except the current one.
 */
async function closeTempusDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tempusTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tempusTabs.length <= 1) return;

  // Keep the active Tab Out Tempus tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tempusTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tempusTabs.find(t => t.active) ||
    tempusTabs[0];
  const toClose = tempusTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), duration);
}

/**
 * openSettingsPanel()
 * Opens the settings modal and renders the blocked domains list.
 */
async function openSettingsPanel() {
  const overlay = document.getElementById('settingsOverlay');
  const list = document.getElementById('blockedList');
  const empty = document.getElementById('blockedEmpty');
  if (!overlay) return;

  overlay.style.display = 'flex';

  // Render blocked domains
  const blocked = await getBlockedDomains();
  if (blocked.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    list.innerHTML = blocked.map(hostname => {
      const safe = escapeHtml(hostname);
      return `
      <div class="blocked-item">
        <div class="blocked-info">
          <span class="blocked-name">${escapeHtml(friendlyDomain(hostname))}</span>
          <span class="blocked-hostname">${safe}</span>
        </div>
        <button class="blocked-remove-btn" data-action="remove-blocked" data-hostname="${safe}" title="移出隐私名单，恢复统计">
          移除
        </button>
      </div>`;
    }).join('');
  }
}

/* ─── History Export / Import ─────────────────────────────────────────────── */

/**
 * exportAllHistory()
 * Exports timeLog + legacy dailyHistory + blockedDomains as a JSON file.
 * v1.3.1: primary data is timeLog; dailyHistory included for backward compat.
 */
async function exportAllHistory() {
  const allItems = await new Promise(resolve => {
    chrome.storage.local.get(null, resolve);
  });

  const exportData = { __format: 'tempus-v1.3.1' };
  let entryCount = 0;

  for (const [key, val] of Object.entries(allItems)) {
    if (key.startsWith('timeLog.') || key.startsWith('dailyHistory.') || key.startsWith('hourlyData.') || key === 'blockedDomains') {
      exportData[key] = val;
      entryCount++;
    }
  }

  if (entryCount === 0) {
    showToast(I18N.currentLang === 'zh' ? '没有可导出的历史记录' : 'No history to export');
    return;
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // Use LOCAL date for the filename (display purpose)
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `tempus-history-${localDate}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(I18N.currentLang === 'zh' ? `已导出 ${entryCount} 条历史记录` : `Exported ${entryCount} history entries`);
}

/**
 * importHistory(file)
 * Parses a JSON file and writes its data back to chrome.storage.local.
 * v1.3.1: Supports both timeLog (new) and dailyHistory (legacy) formats.
 * Legacy dailyHistory entries are auto-converted to timeLog during migration.
 */
async function importHistory(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      showToast(I18N.currentLang === 'zh' ? '导入失败：文件格式错误' : 'Import failed: invalid file format');
      return;
    }

    const entries = Object.entries(data);
    if (entries.length === 0) {
      showToast(I18N.currentLang === 'zh' ? '导入文件为空' : 'Import file is empty');
      return;
    }

    // Validate: only allow known key patterns
    const allowedPrefixes = ['timeLog.', 'dailyHistory.', 'hourlyData.', 'blockedDomains'];
    const safeData = {};
    let skipped = 0;
    for (const [key, val] of entries) {
      if (key === '__format') continue; // skip metadata
      if (key === '__timeLogMigrated') continue; // skip migration flag
      if (allowedPrefixes.some(p => key === p || key.startsWith(p))) {
        // Type validation
        if (key.startsWith('timeLog.') && !Array.isArray(val)) { skipped++; continue; }
        if (key.startsWith('dailyHistory.') && typeof val !== 'number') { skipped++; continue; }
        if (key.startsWith('hourlyData.') && (typeof val !== 'object' || val === null)) { skipped++; continue; }
        safeData[key] = val;
      } else {
        skipped++;
      }
    }

    if (Object.keys(safeData).length === 0) {
      showToast(I18N.currentLang === 'zh' ? '导入失败：没有有效的历史记录数据' : 'Import failed: no valid history data');
      return;
    }

    // Merge timeLog entries (append to existing shards rather than overwrite)
    // Review fix #15: deduplicate based on s+e+h combination so repeated imports don't double data
    const timeLogKeys = Object.keys(safeData).filter(k => k.startsWith('timeLog.'));
    let dedupedCount = 0;
    if (timeLogKeys.length > 0) {
      const existingShards = await new Promise(resolve => {
        chrome.storage.local.get(timeLogKeys, resolve);
      });
      for (const key of timeLogKeys) {
        const existing = existingShards[key] || [];
        const incoming = safeData[key] || [];

        // Build a Set of existing entry keys for O(1) lookup
        const existingKeys = new Set(existing.map(e => `${e.s}|${e.e}|${e.h}`));
        const newEntries = [];
        for (const entry of incoming) {
          const k = `${entry.s}|${entry.e}|${entry.h}`;
          if (existingKeys.has(k)) {
            dedupedCount++;
          } else {
            existingKeys.add(k);
            newEntries.push(entry);
          }
        }
        safeData[key] = [...existing, ...newEntries];
      }
    }

    await chrome.storage.local.set(safeData);

    // Build toast message with skipped + deduped info
    const parts = [];
    const isZh = I18N.currentLang === 'zh';
    parts.push(isZh
      ? `已导入 ${Object.keys(safeData).length} 条记录`
      : `Imported ${Object.keys(safeData).length} entries`);
    if (skipped > 0) parts.push(isZh ? `跳过 ${skipped} 条无效数据` : `skipped ${skipped} invalid`);
    if (dedupedCount > 0) parts.push(isZh ? `去重 ${dedupedCount} 条` : `${dedupedCount} duplicates removed`);
    const msg = parts.join('，') + (isZh ? '，请刷新页面' : ', please refresh');
    showToast(msg);
  } catch (e) {
    showToast(I18N.currentLang === 'zh' ? '导入失败：文件格式错误' : 'Import failed: invalid file format');
  }
}

/**
 * closeSettingsPanel()
 * Closes the settings modal.
 */
function closeSettingsPanel() {
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.style.display = 'none';
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (I18N.currentLang === 'zh') {
    if (hour < 6)  return '夜深了';
    if (hour < 12) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 17) return '下午好';
    return '晚上好';
  }
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  const locale = I18N.currentLang === 'zh' ? 'zh-CN' : 'en-US';
  return new Date().toLocaleDateString(locale, {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTempusDupes()
 *
 * Counts how many Tab Out Tempus pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTempusDupes() {
  const tempusTabs = openTabs.filter(t => t.isTempus);
  const banner  = document.getElementById('tempusDupeBanner');
  const countEl = document.getElementById('tempusDupeCount');
  const textEl = document.getElementById('tempusDupeText');
  const btnEl = document.getElementById('tempusDupeDismissBtn');
  if (!banner) return;

  if (tempusTabs.length > 1) {
    if (countEl) countEl.textContent = tempusTabs.length;
    // Update text based on current language
    if (textEl) {
      textEl.textContent = I18N.currentLang === 'zh'
        ? ' 个 Tab Out Tempus 标签页打开 — 只保留这个？'
        : ' Tab Out Tempus tabs open — keep just this one?';
    }
    if (btnEl) {
      btnEl.textContent = I18N.currentLang === 'zh' ? '关闭其他' : 'Close extras';
    }
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

/**
 * checkDomainSprawl()
 *
 * Checks how many distinct hostnames are currently open.
 * If more than DOMAIN_SPRAWL_THRESHOLD (default 8), shows a warning banner
 * suggesting the user consolidate their tabs.
 */
function checkDomainSprawl() {
  const SPRAWL_THRESHOLD = 8;
  const banner  = document.getElementById('domainSprawlBanner');
  const countEl = document.getElementById('domainSprawlCount');
  const textEl = document.getElementById('domainSprawlText');
  const btnEl = document.getElementById('domainSprawlDismissBtn');
  if (!banner) return;

  const domains = new Set();
  for (const tab of openTabs) {
    if (tab.isChromeInternal) continue;
    try {
      const hostname = new URL(tab.url).hostname.replace(/^www\./, '');
      if (hostname && hostname !== '__internal__') domains.add(hostname);
    } catch {}
  }

  if (domains.size > SPRAWL_THRESHOLD) {
    if (countEl) countEl.textContent = domains.size;
    // Update text based on current language
    if (textEl) {
      textEl.textContent = I18N.currentLang === 'zh'
        ? ' 个域名同时打开，标签页过于分散'
        : ' domains open — tabs spread across too many sites';
    }
    if (btnEl) {
      btnEl.textContent = I18N.currentLang === 'zh' ? '知道了' : 'Got it';
    }
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

/* ─── Private Mode (Privacy Timer) ─────────────────────────────────────────── */

/* ─── Tab Heatmap ───────────────────────────────────────────────────────────── */

/**
 * renderHeatmap()
 *
 * Renders a 24-hour heatmap below the productivity banner in Today view.
 * Shows browsing intensity per hour for the top domains.
 *
 * v1.3.1: Computes from timeLog using local day boundaries.
 * Each entry's overlap is clipped to the local day, then assigned to the local hour.
 */
async function renderHeatmap() {
  const containerId = 'heatmapContainer';
  let container = document.getElementById(containerId);
  if (!container) return;

  // Get local today boundaries
  const { dayStartMs, dayEndMs } = getLocalTodayRange();

  let hourlyData = {};
  try {
    // Ask background to compute hourly data from timeLog
    const resp = await chrome.runtime.sendMessage({
      type: 'GET_HOURLY_DATA',
      localDayStartMs: dayStartMs,
      localDayEndMs: dayEndMs,
    });
    hourlyData = (resp && resp.hourlyData) ? resp.hourlyData : {};
  } catch (e) {
    console.warn('[tempus] Failed to get hourly data:', e);
    container.innerHTML = '';
    return;
  }

  const hostnames = Object.keys(hourlyData).filter(k => k !== '__internal__');
  if (hostnames.length === 0) { container.innerHTML = ''; return; }

  hostnames.sort((a, b) => {
    const sumA = (hourlyData[a] || []).reduce((s, v) => s + v, 0);
    const sumB = (hourlyData[b] || []).reduce((s, v) => s + v, 0);
    return sumB - sumA;
  });
  
  // HARD CAP: ensure we never render more than 8 domains in the heatmap
  const topHosts = hostnames.slice(0, Math.min(8, hostnames.length));

  let maxVal = 0;
  for (const h of topHosts) {
    for (const v of (hourlyData[h] || [])) { if (v > maxVal) maxVal = v; }
  }

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const fmt = (ms) => {
    if (!ms) return '';
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`;
  };

  const hourLabels = `<div class="heatmap-label-corner"></div>` +
    HOURS.map(h => `<div class="heatmap-hour-label">${String(h).padStart(2, '0')}</div>`).join('');

  const rows = topHosts.map(hostname => {
    const data = hourlyData[hostname] || new Array(24).fill(0);
    const cells = HOURS.map(h => {
      const val = data[h] || 0;
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const alpha = intensity < 0.01 ? 0 : 0.1 + intensity * 0.7;
      const color = `rgba(90, 122, 98, ${alpha.toFixed(2)})`;
      return `<div class="heatmap-cell" style="background:${color}" title="${escapeHtml(hostname)} · ${String(h).padStart(2,'0')}:00 — ${fmt(val)}"></div>`;
    }).join('');
    return `<div class="heatmap-hostname" title="${escapeHtml(hostname)}">${escapeHtml(friendlyDomain(hostname))}</div>${cells}`;
  }).join('');

  container.innerHTML = `
    <div class="heatmap-title">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 4.5 16.5h15.75a2.25 2.25 0 0 1 2.25 2.25V3" /></svg>
      ${I18N.currentLang === 'zh' ? '今日热力图' : 'Today\'s Heatmap'}
    </div>
    <div class="heatmap-grid">
      <div class="heatmap-header">${hourLabels}</div>
      <div class="heatmap-body">${rows}</div>
    </div>
    <div class="heatmap-legend">
      <span style="color:var(--muted);font-size:10px;">${I18N.currentLang === 'zh' ? '少' : 'Less'}</span>
      <div class="heatmap-legend-bar"></div>
      <span style="color:var(--muted);font-size:10px;">${I18N.currentLang === 'zh' ? '多' : 'More'}</span>
    </div>
  `;
}

/* ─── Productivity Banner ─────────────────────────────────────────────────── */

/**
 * renderProductivityBanner(range)
 *
 * Shows a warm productivity summary banner at the top of the Today/Week views.
 * Generates encouraging messages based on browsing stats.
 */
async function renderProductivityBanner(range) {
  const banner = document.getElementById('productivityBanner');
  const msgEl  = document.getElementById('productivityMessage');
  const statsEl = document.getElementById('productivityStats');
  if (!banner || !msgEl || !statsEl) return;

  // Only show for today and week views
  if (range !== 'today' && range !== 'week') {
    banner.style.display = 'none';
    return;
  }

  const stats = await getStatsData(range);
  if (!stats || stats.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const totalMs = stats.reduce((s, e) => s + e.totalMs, 0);
  const totalHours = (totalMs / 3600000).toFixed(1);
  const topDomain = stats[0]?.friendlyName || stats[0]?.hostname || '';
  const topPct = totalMs > 0 ? Math.round((stats[0].totalMs / totalMs) * 100) : 0;

  // Generate a warm, varied message (Review fix #12: add English versions)
  const isZh = I18N.currentLang === 'zh';
  const messages = isZh ? {
    today: [
      `今天工作了 ${totalHours} 小时，继续保持 💪`,
      `${totalHours} 小时，专注的你很棒 🌟`,
      `今日专注 ${totalHours} 小时，${topDomain} 用了 ${topPct}% 的时间`,
    ],
    week: [
      `本周累计 ${totalHours} 小时，效率不错 📊`,
      `${totalHours} 小时的一周，${topDomain} 占 ${topPct}% 的时间`,
      `这周你工作了 ${totalHours} 小时，继续加油 💪`,
    ],
  } : {
    today: [
      `${totalHours}h of focused work today, keep it up 💪`,
      `${totalHours} hours in — great focus today 🌟`,
      `${totalHours}h today · ${topDomain} took ${topPct}% of it`,
    ],
    week: [
      `${totalHours}h this week — solid productivity 📊`,
      `A ${totalHours}-hour week · ${topDomain} at ${topPct}%`,
      `${totalHours} hours this week, keep going 💪`,
    ],
  };

  const pool = messages[range] || messages.today;
  const msg = pool[Math.floor(Math.random() * pool.length)];

  // Build stats line: top 3 domains
  const top3 = stats.slice(0, 3).map(s => {
    const pct = totalMs > 0 ? Math.round((s.totalMs / totalMs) * 100) : 0;
    return `${s.friendlyName || s.hostname} (${pct}%)`;
  }).join(' · ');

  msgEl.textContent = msg;
  statsEl.textContent = top3;

  banner.style.display = 'flex';
}

/**
 * Sync private mode state with the background service worker.
 * Updates button UI and starts/stops the countdown timer.
 */
async function syncPrivateMode() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PRIVATE_MODE' });
    privateModeEndTime = resp?.privateModeEndTime || null;
  } catch {
    privateModeEndTime = null;
  }

  privateModeActive = privateModeEndTime !== null && Date.now() < privateModeEndTime;

  const btn = document.getElementById('privateModeBtn');
  const label = document.getElementById('privateModeLabel');
  if (btn) btn.classList.toggle('active', privateModeActive);
  updatePrivateModeTooltip();
  if (label) {
    if (privateModeActive) {
      updatePrivateModeCountdown();
      startPrivateModeCountdown();
    } else {
      label.textContent = I18N.t('Private');
    }
  }
}

function startPrivateModeCountdown() {
  if (privateModeInterval) clearInterval(privateModeInterval);
  privateModeInterval = setInterval(updatePrivateModeCountdown, 1000);
}

function updatePrivateModeCountdown() {
  if (!privateModeActive || !privateModeEndTime) return;

  const remaining = privateModeEndTime - Date.now();
  if (remaining <= 0) {
    // Auto-disable: private mode expired
    if (privateModeInterval) clearInterval(privateModeInterval);
    privateModeActive = false;
    privateModeEndTime = null;
    const btn = document.getElementById('privateModeBtn');
    const label = document.getElementById('privateModeLabel');
    if (btn) {
      btn.classList.remove('active');
      btn.title = I18N.currentLang === 'zh' ? '开启隐私模式，暂停计时 1 小时' : 'Enable private mode, pause tracking for 1 hour';
    }
    if (label) label.textContent = I18N.t('Private');
    showToast(I18N.currentLang === 'zh' ? '隐私模式已自动关闭' : 'Private mode auto-disabled');
    return;
  }

  const totalSec = Math.ceil(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const label = document.getElementById('privateModeLabel');
  if (label) {
    label.textContent = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${m}:${String(s).padStart(2,'0')}`;
  }
}

/**
 * Format minutes to human-readable Chinese string.
 * @param {number|string} minutes
 * @returns {string}
 */
function formatMinutes(minutes) {
  const isZh = I18N.currentLang === 'zh';
  if (minutes === 'midnight') return isZh ? '到午夜' : 'until midnight';
  const m = parseInt(minutes, 10);
  if (m >= 60) {
    const h = m / 60;
    if (isZh) return h === 1 ? '1 小时' : `${h} 小时`;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return isZh ? `${m} 分钟` : `${m} minutes`;
}

/**
 * Update the privacy mode button tooltip based on current state and selected duration.
 */
function updatePrivateModeTooltip() {
  const btn = document.getElementById('privateModeBtn');
  const select = document.getElementById('privateModeSelect');
  if (!btn) return;

  if (privateModeActive) {
    btn.title = I18N.currentLang === 'zh' ? '退出隐私模式' : 'Exit private mode';
  } else {
    const minutes = select ? select.value : '60';
    const prefix = I18N.currentLang === 'zh' ? '开启隐私模式，暂停计时' : 'Enable private mode, pause for';
    btn.title = `${prefix} ${formatMinutes(minutes)}`;
  }
}

/**
 * Toggle private mode on/off.
 * Reads the selected duration from the dropdown before enabling.
 */
async function togglePrivateMode() {
  const select = document.getElementById('privateModeSelect');
  const minutes = select ? select.value : '60';

  const minutesVal = minutes === 'midnight' ? 'midnight' : parseInt(minutes, 10);

  if (!privateModeActive) {
    // Enabling — send duration to background
    await chrome.runtime.sendMessage({ type: 'SET_PRIVATE_MODE', minutes: minutesVal });
    // Immediately sync state to show countdown without page refresh
    await syncPrivateMode();
    showToast(minutesVal === 'midnight'
      ? (I18N.currentLang === 'zh' ? '隐私模式开启，到午夜自动关闭' : 'Private mode on until midnight')
      : (I18N.currentLang === 'zh' ? `隐私模式开启，暂停计时 ${formatMinutes(minutesVal)}` : `Private mode on, pausing for ${formatMinutes(minutesVal)}`));
  } else {
    // Disabling early
    await chrome.runtime.sendMessage({ type: 'SET_PRIVATE_MODE', minutes: null });
    if (privateModeInterval) clearInterval(privateModeInterval);
    privateModeActive = false;
    privateModeEndTime = null;
    const btn = document.getElementById('privateModeBtn');
    const label = document.getElementById('privateModeLabel');
    if (btn) {
      btn.classList.remove('active');
      btn.title = I18N.currentLang === 'zh' ? '开启隐私模式，暂停计时 1 小时' : 'Enable private mode, pause tracking for 1 hour';
    }
    if (label) label.textContent = I18N.t('Private');
    showToast(I18N.currentLang === 'zh' ? '隐私模式已关闭' : 'Private mode disabled');
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    // Use escapeHtml consistently to prevent XSS via exotic titles/URLs
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-id="${tab.id}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${escapeHtml(label)}</span>
      <span class="chip-time-badge chip-time-zero" title="${I18N.currentLang === 'zh' ? '此标签累计使用时长' : 'Cumulative time on this tab'}"></span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, hostnameStaleness)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 * hostnameStaleness = { hostname: lastFocusTimestamp }
 */
function renderDomainCard(group, hostnameStaleness = {}) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  // Time badge — shows cumulative time spent on this group
  const groupHostname = group.domain === '__landing-pages__' ? '' : group.domain;
  const timeBadge = groupHostname
    ? `<span class="group-time-badge" data-hostname="${escapeHtml(groupHostname)}">—</span>`
    : '';

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Staleness badge — show "N days stale" if hostname hasn't been focused in 7+ days
  let staleBadge = '';
  if (groupHostname && hostnameStaleness[groupHostname]) {
    const daysSince = Math.floor((Date.now() - hostnameStaleness[groupHostname]) / 86400000);
    if (daysSince >= 7) {
      const daysLabel = daysSince >= 30
        ? `${Math.floor(daysSince / 30)} ${I18N.t('months stale')}`
        : `${daysSince} ${I18N.t('days stale')}`;
      staleBadge = `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        🕐 ${daysLabel}
      </span>`;
    }
  }

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const isDormant = tab.discarded;
    const chipClass = (count > 1 ? ' chip-has-dupes' : '') + (isDormant ? ' chip-dormant' : '');
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    const zzzBadge = isDormant ? ' <span class="chip-dormant-badge">💤</span>' : '';
    const actions = isDormant
      ? `<button class="chip-action chip-dormant" data-action="wake-tab" data-tab-url="${safeUrl}" data-tab-id="${tab.id}" title="唤醒此标签">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
         </button>`
      : `<button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
         </button>
         <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
         </button>`;
    return `<div class="page-chip clickable${chipClass}" data-action="${isDormant ? 'wake-tab' : 'focus-tab'}" data-tab-url="${safeUrl}" data-tab-id="${tab.id}" title="${safeTitle}${isDormant ? ' (休眠)' : ''}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${escapeHtml(label)}</span>
      <span class="chip-time-badge chip-time-zero" title="${I18N.currentLang === 'zh' ? '此标签累计使用时长' : 'Cumulative time on this tab'}"></span>${dupeTag}${zzzBadge}
      <div class="chip-actions">${actions}</div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  // If this card is stale, add a "close stale" action
  const groupHostname2 = group.domain === '__landing-pages__' ? '' : group.domain;
  if (groupHostname2 && hostnameStaleness[groupHostname2]) {
    const daysSince = Math.floor((Date.now() - hostnameStaleness[groupHostname2]) / 86400000);
    if (daysSince >= 7) {
      const staleLabel = daysSince >= 30
        ? `${Math.floor(daysSince/30)} ${I18N.t('months stale')}`
        : `${daysSince} ${I18N.t('days stale')}`;
      actionsHtml += `
        <button class="action-btn" data-action="close-stale-domain" data-hostname="${escapeHtml(groupHostname2)}">
          ${I18N.t('Clear')} ${staleLabel}
        </button>`;
    }
  }

  // Add a "sleep" action button if domain has non-dormant tabs
  const nonDormantCount = (group.tabs || []).filter(t => !t.discarded).length;
  if (groupHostname2 && nonDormantCount > 0) {
    const sleepTitle = I18N.currentLang === 'zh' ? '休眠这些标签，节省内存' : 'Put these tabs to sleep to save memory';
    actionsHtml += `
      <button class="action-btn" data-action="sleep-domain" data-hostname="${escapeHtml(groupHostname2)}" title="${sleepTitle}">
        💤 ${I18N.t('Sleep')}
      </button>`;
  }

  const hasAmberBar = hasDupes || (groupHostname2 && hostnameStaleness[groupHostname2] && Math.floor((Date.now() - hostnameStaleness[groupHostname2]) / 86400000) >= 7);
  return `
    <div class="mission-card domain-card ${hasAmberBar ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}" data-hostname="${isLanding ? '' : escapeHtml(group.domain)}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
          ${staleBadge}
          ${timeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tempus] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${escapeHtml(item.id)}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${escapeHtml(item.id)}">
      <div class="deferred-info">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="deferred-title" title="${escapeHtml(item.title || '')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${escapeHtml(item.title || item.url)}
        </a>
        <div class="deferred-meta">
          <span>${escapeHtml(domain)}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${escapeHtml(item.id)}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="archive-item-title" title="${escapeHtml(item.title || '')}">
        ${escapeHtml(item.title || item.url)}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Footer version (v1.3.4+) ---
  // Pulled from manifest so we only bump the version in one place.
  const versionEl = document.getElementById('appVersion');
  if (versionEl && !versionEl.textContent) {
    try {
      const v = chrome.runtime.getManifest().version;
      if (v) versionEl.textContent = `v${v}`;
    } catch {}
  }

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Fetch staleness data from background (for tab age badges) ---
  let hostnameStaleness = {};
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STALENESS' });
    hostnameStaleness = (resp && resp.hostnameLastFocus) ? resp.hostnameLastFocus : {};
  } catch (e) {
    console.warn('[tempus] Failed to get staleness data:', e);
  }

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');


  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    if (openTabsSectionCount) {
      openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    }
    if (openTabsMissionsEl) {
      openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g, hostnameStaleness)).join('');
    }
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out Tempus tabs ---
  checkTempusDupes();

  // --- Check for domain sprawl (too many distinct domains) ---
  checkDomainSprawl();

  // --- Sync private mode state ---
  await syncPrivateMode();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // --- Initial timer refresh (then auto-refresh every 5s via visibility control) ---
  // v1.3.5: lifetime cache removed — refreshTimerDisplay reads cumulativeMs directly
  await refreshTimerDisplay();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // ---- View switcher ----
  const viewBtn = e.target.closest('.view-btn');
  if (viewBtn) {
    const view = viewBtn.dataset.view;
    if (!view) return;

    currentView = view;

    // Update active button
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    viewBtn.classList.add('active');

    if (view === 'today') {
      // Show heatmap when switching to Today view
      const heatmapContainer = document.getElementById('heatmapContainer');
      if (heatmapContainer) heatmapContainer.style.display = 'block';
      await renderStaticDashboard();
      await renderProductivityBanner('today');
      renderHeatmap(); // intentionally not awaited
    } else {
      // Hide heatmap during stats view (week/month/year), but keep openTabsSection visible
      const heatmapContainer = document.getElementById('heatmapContainer');
      if (heatmapContainer) heatmapContainer.style.display = 'none';
      const stats = await getStatsData(view);
      renderStatsView(stats, view);
      renderProductivityBanner(view); // intentionally not awaited — runs independently
    }
    return;
  }

  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate Tab Out Tempus tabs ----
  if (action === 'close-tempus-dupes') {
    await closeTempusDupes();
    playCloseSound();
    const banner = document.getElementById('tempusDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out Tempus tabs');
    return;
  }

  // ---- Dismiss domain sprawl warning banner ----
  if (action === 'dismiss-domain-sprawl') {
    const banner = document.getElementById('domainSprawlBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    return;
  }

  // ---- Toggle private / focus mode ----
  if (action === 'toggle-private-mode') {
    await togglePrivateMode();
    return;
  }

  // ---- Close all tabs for a stale hostname ----
  if (action === 'close-stale-domain') {
    const hostname = actionEl.dataset.hostname;
    if (!hostname) return;
    // Find all tabs for this hostname and close them
    const toClose = openTabs.filter(t => {
      try {
        const h = new URL(t.url).hostname.replace(/^www\./, '');
        return h === hostname;
      } catch { return false; }
    });
    const urls = toClose.map(t => t.url).filter(u => u && !u.startsWith('chrome'));
    await closeTabsByUrls(urls);
    playCloseSound();
    showToast(`已关闭 ${hostname} 的 ${urls.length} 个未读标签`);
    // Re-render
    if (currentView === 'today') {
      await renderStaticDashboard();
    }
    return;
  }

  // ---- Wake a dormant tab (clicking it restores it from sleep) ----
  if (action === 'wake-tab') {
    const tabId = parseInt(actionEl.dataset.tabId, 10);
    if (!tabId) return;
    try {
      // Clicking the tab in Chrome will wake it up automatically
      await chrome.tabs.update(tabId, { active: true });
    } catch {}
    return;
  }

  // ---- Put all tabs in a domain to sleep (discard) ----
  if (action === 'sleep-domain') {
    const hostname = actionEl.dataset.hostname;
    if (!hostname) return;
    const toSleep = openTabs.filter(t => {
      if (t.discarded) return false;
      try {
        const h = new URL(t.url).hostname.replace(/^www\./, '');
        return h === hostname;
      } catch { return false; }
    });
    for (const tab of toSleep) {
      try {
        await chrome.tabs.discard(tab.id);
      } catch {}
    }
    showToast(`${hostname} 的 ${toSleep.length} 个标签已进入休眠模式`);
    if (currentView === 'today') {
      await renderStaticDashboard();
    }
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tempus] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }

  // ---- Stats view: temporarily hide a domain from view ----
  if (action === 'hide-domain') {
    const hostname = actionEl.dataset.hostname;
    if (!hostname || hiddenDomains.includes(hostname)) return;
    hiddenDomains.push(hostname);

    // Remove the card with animation
    const card = actionEl.closest('.mission-card');
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => {
        card.remove();
        // If no more cards, show empty state
        const remaining = document.querySelectorAll('#openTabsMissions .mission-card').length;
        if (remaining === 0) {
          const container = document.getElementById('openTabsMissions');
          if (container) {
            container.innerHTML = `
              <div class="missions-empty-state">
                <div class="empty-checkmark">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <div class="empty-title">No history for this period</div>
                <div class="empty-subtitle">Start browsing to see your stats here.</div>
              </div>`;
          }
        }
      }, 300);
    }

    showToast('已暂时隐藏，重新打开浏览器后恢复');
    return;
  }

  // ---- Stats view: delete all history for a domain ----
  if (action === 'delete-domain-history') {
    const hostname = actionEl.dataset.hostname;
    if (!hostname) return;

    // Remove from hidden list if present
    hiddenDomains = hiddenDomains.filter(h => h !== hostname);

    await clearDomainHistory(hostname);

    const card = actionEl.closest('.mission-card');
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.remove(), 300);
    }

    showToast(`已删除 ${friendlyDomain(hostname)} 的历史记录`, 8000);
    return;
  }

  // ---- Stats view: delete history AND add to privacy blocklist ----
  if (action === 'block-domain') {
    const hostname = actionEl.dataset.hostname;
    if (!hostname) return;

    // Remove from hidden list if present
    hiddenDomains = hiddenDomains.filter(h => h !== hostname);

    await clearDomainHistory(hostname);
    await addToBlockedDomains(hostname);

    const card = actionEl.closest('.mission-card');
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.remove(), 300);
    }

    showToast(`已加入隐私名单，${friendlyDomain(hostname)} 以后不再统计`, 8000);
    return;
  }

  // ---- Open settings panel ----
  if (action === 'open-settings') {
    await openSettingsPanel();
    return;
  }

  // ---- Export all history ----
  if (action === 'export-history') {
    await exportAllHistory();
    return;
  }

  // ---- Import history (trigger hidden file input) ----
  if (action === 'import-history') {
    const input = document.getElementById('importHistoryInput');
    if (input) input.click();
    return;
  }

  // ---- Close settings panel ----
  if (action === 'close-settings') {
    closeSettingsPanel();
    return;
  }

  // ---- Remove a domain from the blocked list (from settings panel) ----
  if (action === 'remove-blocked') {
    const hostname = actionEl.dataset.hostname;
    if (!hostname) return;

    await removeFromBlockedDomains(hostname);

    // Animate the item out
    const item = actionEl.closest('.blocked-item');
    if (item) {
      item.style.transition = 'opacity 0.2s';
      item.style.opacity = '0';
      setTimeout(() => {
        item.remove();
        // Show empty state if no more items
        const remaining = document.querySelectorAll('#blockedList .blocked-item').length;
        const empty = document.getElementById('blockedEmpty');
        if (remaining === 0 && empty) empty.style.display = 'block';
      }, 200);
    }

    showToast(`已移出隐私名单，${friendlyDomain(hostname)} 恢复统计`);
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Import history file input listener ----
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'importHistoryInput') return;
  const file = e.target.files?.[0];
  if (!file) return;
  await importHistory(file);
  e.target.value = ''; // reset so same file can be imported again
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tempus] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   HISTORY STATS — chrome.storage.local aggregation
   ---------------------------------------------------------------- */

/**
 * getLocalDateRangeMs(range)
 * Returns LOCAL date range as UTC timestamps for aggregation.
 * @param {'day'|'week'|'month'|'year'} range
 * @returns {{ startMs: number, endMs: number }}
 */
function getLocalDateRangeMs(range) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let rangeStart;
  if (range === 'week') {
    rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 6); // last 7 days including today
  } else if (range === 'month') {
    rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 29); // last 30 days
  } else if (range === 'year') {
    rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 364); // last 365 days
  } else {
    // 'day' or 'today' — today only
    rangeStart = todayStart;
  }

  return {
    startMs: rangeStart.getTime(),
    endMs: todayStart.getTime() + 86400000, // end of local today
  };
}

/**
 * getStatsData(range)
 * Reads timeLog entries for the given range and aggregates by hostname.
 * Returns sorted array { hostname, totalMs, friendlyName }.
 * v1.3.1: Uses timeLog with interval intersection — timezone-correct.
 * @param {'today'|'week'|'month'|'year'} range
 * @returns {Promise<Array<{hostname: string, totalMs: number, friendlyName: string}>>}
 */
async function getStatsData(range) {
  const { startMs, endMs } = getLocalDateRangeMs(range === 'today' ? 'day' : range);

  // Load blocked domains from storage once, pass to aggregateTimeLog to avoid re-reading
  const { blockedDomains: storedBlocked = [] } = await chrome.storage.local.get('blockedDomains');
  blockedDomains = storedBlocked;

  const { byHostname } = await aggregateTimeLog(startMs, endMs, storedBlocked);

  const result = Object.entries(byHostname)
    .map(([hostname, totalMs]) => ({
      hostname,
      totalMs,
      friendlyName: friendlyDomain(hostname),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // Filter out temporarily hidden domains (session-only, not persisted)
  return result.filter(item => !hiddenDomains.includes(item.hostname));
}

/**
 * clearDomainHistory(hostname)
 * Removes all timeLog entries for the given hostname from all monthly shards.
 * Also cleans up legacy dailyHistory and hourlyData keys.
 */
async function clearDomainHistory(hostname) {
  const allItems = await new Promise(resolve => {
    chrome.storage.local.get(null, resolve);
  });

  const toWrite = {};
  const toDelete = [];

  for (const [key, val] of Object.entries(allItems)) {
    // Filter timeLog shards: remove entries matching hostname
    if (key.startsWith('timeLog.') && Array.isArray(val)) {
      const filtered = val.filter(entry => entry.h !== hostname);
      if (filtered.length !== val.length) {
        toWrite[key] = filtered;
      }
    }
    // Delete legacy dailyHistory keys for this hostname
    if (key.startsWith('dailyHistory.')) {
      const rest = key.slice('dailyHistory.'.length);
      const dot2 = rest.indexOf('.');
      if (dot2 !== -1 && rest.slice(dot2 + 1) === hostname) {
        toDelete.push(key);
      }
    }
  }

  // Delete legacy hourlyData for this hostname
  const hourlyKey = `hourlyData.${hostname}`;
  if (allItems[hourlyKey]) toDelete.push(hourlyKey);

  if (Object.keys(toWrite).length > 0) {
    await chrome.storage.local.set(toWrite);
  }
  if (toDelete.length > 0) {
    await chrome.storage.local.remove(toDelete);
  }
}

/**
 * addToBlockedDomains(hostname)
 * Adds hostname to the persisted blocked list.
 */
async function addToBlockedDomains(hostname) {
  const { blockedDomains: existing = [] } = await chrome.storage.local.get('blockedDomains');
  if (!existing.includes(hostname)) {
    await chrome.storage.local.set({ blockedDomains: [...existing, hostname] });
  }
}

/**
 * removeFromBlockedDomains(hostname)
 * Removes hostname from the persisted blocked list.
 */
async function removeFromBlockedDomains(hostname) {
  const { blockedDomains: existing = [] } = await chrome.storage.local.get('blockedDomains');
  await chrome.storage.local.set({ blockedDomains: existing.filter(h => h !== hostname) });
}

/**
 * getBlockedDomains()
 * Loads the blocked list from storage.
 */
async function getBlockedDomains() {
  const { blockedDomains: list = [] } = await chrome.storage.local.get('blockedDomains');
  return list;
}

/**
 * renderStatsView(stats)
 * Renders the history stats panel replacing the open-tabs grid.
 * @param {Array<{hostname: string, totalMs: number, friendlyName: string}>} stats
 * @param {'today'|'week'|'month'|'year'} range
 */
function renderStatsView(stats, range) {
  const container = document.getElementById('openTabsMissions');
  const titleEl = document.getElementById('openTabsSectionTitle');
  const countEl = document.getElementById('openTabsSectionCount');

  if (titleEl) {
    const labels = { today: 'Today', week: 'This Week', month: 'This Month', year: 'This Year' };
    titleEl.textContent = labels[range] || range;
  }

  if (!stats || stats.length === 0) {
    if (countEl) countEl.textContent = 'No data yet';
    if (container) {
      container.innerHTML = `
        <div class="missions-empty-state">
          <div class="empty-checkmark">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <div class="empty-title">No history for this period</div>
          <div class="empty-subtitle">Start browsing to see your stats here.</div>
        </div>
      `;
    }
    return;
  }

  const totalMs = stats.reduce((s, e) => s + e.totalMs, 0);

  if (countEl) {
    countEl.innerHTML = `<span class="stat-num" style="font-size:14px">${formatDuration(totalMs)}</span> total &nbsp;&middot;&nbsp; <span class="stat-num" style="font-size:14px">${stats.length}</span> domains`;
  }

  if (container) {
    container.innerHTML = stats.map(item => {
      const safeHostname = escapeHtml(item.hostname);
      return `
      <div class="mission-card domain-card has-neutral-bar" data-stats-hostname="${safeHostname}">
        <div class="status-bar"></div>
        <div class="mission-content">
          <div class="mission-top">
            <span class="mission-name">${escapeHtml(item.friendlyName)}</span>
            <span class="group-time-badge" style="font-size:11px;padding:3px 8px;">${formatDuration(item.totalMs)}</span>
          </div>
          <div class="mission-pages" style="padding:4px 0 8px;font-size:12px;color:var(--muted);">
            ${safeHostname}
          </div>
          <div class="stats-domain-actions">
            <button class="stats-action-btn" data-action="hide-domain" data-hostname="${safeHostname}" title="暂时从统计视图移除，不清空时长">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
              隐藏
            </button>
            <button class="stats-action-btn" data-action="delete-domain-history" data-hostname="${safeHostname}" title="从统计视图移除，清空累计时长，下次从零开始">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
              删除
            </button>
            <button class="stats-action-btn stats-action-block" data-action="block-domain" data-hostname="${safeHostname}" title="删除并加入隐私名单，以后不再统计">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" /></svg>
              隐私名单
            </button>
          </div>
        </div>
      </div>
    `;
    }).join('');
  }
}

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
let currentView = 'today'; // 'today' | 'week' | 'month' | 'year'

/** @type {string[]} Temporarily hidden domains for current session (not persisted) */
let hiddenDomains = [];

/** @type {string[]} Permanently blocked domains loaded from storage */
let blockedDomains = [];

// ─── Timer refresh with visibility control (v1.3.1) ──────────────────────────
// Refresh every 5s when visible; pause when tab is hidden.
function startTimerInterval() {
  if (timerIntervalId) return;
  refreshTimerDisplay(); // immediate refresh on start
  timerIntervalId = setInterval(refreshTimerDisplay, 5000);
}

function stopTimerInterval() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTimerInterval();
  } else {
    // Immediately refresh when becoming visible, then resume interval
    startTimerInterval();
  }
});

// Start timer if page is currently visible
if (!document.hidden) {
  startTimerInterval();
}

// Update privacy button tooltip when duration select changes
const privateModeSelect = document.getElementById('privateModeSelect');
if (privateModeSelect) {
  privateModeSelect.addEventListener('change', updatePrivateModeTooltip);
}

// Language toggle button handler
const langToggleBtn = document.getElementById('langToggleBtn');
if (langToggleBtn) {
  langToggleBtn.addEventListener('click', async () => {
    const newLang = I18N.toggle();
    updateLangFlag();
    updateUIText();
    // Re-render the current view to update all text
    if (currentView === 'today') {
      await renderStaticDashboard();
      await renderProductivityBanner('today');
      renderHeatmap();
    } else {
      // Hide heatmap during stats view
      const heatmapContainer = document.getElementById('heatmapContainer');
      if (heatmapContainer) heatmapContainer.style.display = 'none';
      const stats = await getStatsData(currentView);
      renderStatsView(stats, currentView);
      renderProductivityBanner(currentView);
    }
    updatePrivateModeTooltip();
  });
}

/**
 * Update the language flag icon based on current language
 */
function updateLangFlag() {
  const flagEl = document.getElementById('langFlag');
  if (flagEl) {
    flagEl.textContent = I18N.currentLang === 'en' ? '🇺🇸' : '🇨🇳';
  }
}

/**
 * Update all UI text elements based on current language
 * Called when language is toggled
 */
function updateUIText() {
  // Update "Time spent" header label
  const timeSpentLabel = document.getElementById('headerTimeSpentLabel');
  if (timeSpentLabel) {
    timeSpentLabel.textContent = I18N.t('Time spent');
  }

  // Update view switcher buttons
  const viewLabels = {
    today: I18N.t('Today'),
    week: I18N.t('This Week'),
    month: I18N.t('This Month'),
    year: I18N.t('This Year'),
  };
  document.querySelectorAll('.view-btn').forEach(btn => {
    const view = btn.dataset.view;
    if (view && viewLabels[view]) {
      btn.textContent = viewLabels[view];
    }
  });

  // Update section title
  const sectionTitle = document.getElementById('openTabsSectionTitle');
  if (sectionTitle) {
    sectionTitle.textContent = I18N.t('Open tabs');
  }

  // Update privacy mode elements
  const privateLabel = document.getElementById('privateModeLabel');
  if (privateLabel && !privateModeActive) {
    privateLabel.textContent = I18N.t('Private');
  }

  // Update private mode select options
  const privateSelect = document.getElementById('privateModeSelect');
  if (privateSelect) {
    const options = privateSelect.querySelectorAll('option');
    const labels = {
      '15': I18N.currentLang === 'zh' ? '15 分钟' : '15 minutes',
      '30': I18N.currentLang === 'zh' ? '30 分钟' : '30 minutes',
      '60': I18N.currentLang === 'zh' ? '1 小时' : '1 hour',
      '120': I18N.currentLang === 'zh' ? '2 小时' : '2 hours',
      '480': I18N.currentLang === 'zh' ? '8 小时' : '8 hours',
      'midnight': I18N.currentLang === 'zh' ? '到午夜' : 'Until midnight',
    };
    options.forEach(opt => {
      if (labels[opt.value]) {
        opt.textContent = labels[opt.value];
      }
    });
  }

  // Update private mode tooltip
  updatePrivateModeTooltip();

  // Update banners (they'll reset text when shown next time, but update current if visible)
  checkTempusDupes();
  checkDomainSprawl();

  // Update settings panel text (Review fix #10)
  const settingsTitle = document.getElementById('settingsTitle');
  if (settingsTitle) settingsTitle.textContent = I18N.currentLang === 'zh' ? '设置' : 'Settings';

  const settingsBlockedTitle = document.getElementById('settingsBlockedTitle');
  if (settingsBlockedTitle) settingsBlockedTitle.textContent = I18N.currentLang === 'zh' ? '隐私名单' : 'Privacy Blocklist';

  const settingsBlockedDesc = document.getElementById('settingsBlockedDesc');
  if (settingsBlockedDesc) settingsBlockedDesc.textContent = I18N.currentLang === 'zh'
    ? '以下域名已屏蔽，不会参与任何统计。移除后恢复统计。'
    : 'These domains are blocked from all tracking. Remove to resume tracking.';

  const blockedEmpty = document.getElementById('blockedEmpty');
  if (blockedEmpty) blockedEmpty.textContent = I18N.currentLang === 'zh' ? '隐私名单为空' : 'Blocklist is empty';

  const settingsMigrationTitle = document.getElementById('settingsMigrationTitle');
  if (settingsMigrationTitle) settingsMigrationTitle.textContent = I18N.currentLang === 'zh' ? '历史记录迁移' : 'History Migration';

  const settingsMigrationDesc = document.getElementById('settingsMigrationDesc');
  if (settingsMigrationDesc) settingsMigrationDesc.textContent = I18N.currentLang === 'zh'
    ? '导出所有浏览时长记录到文件，重装插件后可导入恢复。'
    : 'Export all browsing time data to a file. Import to restore after reinstalling.';

  const exportBtn = document.getElementById('exportHistoryBtn');
  if (exportBtn) exportBtn.innerHTML = exportBtn.innerHTML.replace(/导出历史记录|Export History/,
    I18N.currentLang === 'zh' ? '导出历史记录' : 'Export History');

  const importBtn = document.getElementById('importHistoryBtn');
  if (importBtn) importBtn.innerHTML = importBtn.innerHTML.replace(/导入历史记录|Import History/,
    I18N.currentLang === 'zh' ? '导入历史记录' : 'Import History');

  // Update deferred column
  const deferredTitle = document.querySelector('#deferredColumn .section-header h2');
  if (deferredTitle) {
    deferredTitle.textContent = I18N.t('Saved for later');
  }
  const deferredEmpty = document.getElementById('deferredEmpty');
  if (deferredEmpty) {
    deferredEmpty.textContent = I18N.t('Nothing saved. Living in the moment.');
  }
  const archiveToggle = document.getElementById('archiveToggle');
  if (archiveToggle) {
    archiveToggle.childNodes[2].textContent = I18N.t('Archive');
  }
}

// --- Initial render of dashboard content ---
// Use async IIFE to properly await without blocking script execution
(async () => {
  try {
    // Load language preference first
    await I18N.load();
    updateLangFlag();
    await renderDashboard();
    // Apply language-specific UI text after initial render
    updateUIText();
  } catch (err) {
    console.error('[tempus] Initial render failed:', err);
  }
})();
