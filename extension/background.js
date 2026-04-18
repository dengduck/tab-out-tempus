/**
 * background.js — Service Worker for Tab Tracking + Badge Updates
 *
 * Two responsibilities:
 * 1. Track tab active time (tab switching timer)
 * 2. Keep toolbar badge showing open tab count
 *
 * Timer logic:
 * - On tab activation: record hostname + activation timestamp
 * - On tab switch: add elapsed time to the previous tab's total
 * - On tab close: add remaining time to history before removal
 * - Persist to chrome.storage.local every 5 seconds (to survive SW restarts)
 */

// ─── Session Timer State (in-memory) ─────────────────────────────────────────

/** @type {Map<number, {hostname: string, title: string, activatedAt: number, totalTime: number}>} */
const tabSessions = new Map();

/** ID of the currently active tab */
let currentActiveTabId = null;

/** Timestamp when the current session started */
let currentSessionStart = null;

/** Private / Focus mode — end timestamp (ms), or null when inactive */
let privateModeEndTime = null;

/** Tracks the last time (ms) each hostname was focused (tab switch away) */
const hostnameLastFocus = new Map();

/** Set of tab IDs currently in the discarded/dormant state */
const dormantTabIds = new Set();

// ─── Tab Activation Tracking ──────────────────────────────────────────────────

/**
 * Record the hostname + title for a tab.
 * Skips recording if privacy mode is active and tab is new (not previously tracked).
 */
async function recordTab(tabId, tab) {
  let hostname = '';
  let title = '';
  try {
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('about:')) {
      hostname = new URL(tab.url).hostname.replace(/^www\./, '');
      title = tab.title || hostname;
    }
  } catch {}

  if (!hostname) {
    hostname = '__internal__';
    title = tab.title || 'Internal Page';
  }

  // Check if privacy mode is active
  const isPrivateMode = privateModeEndTime !== null && privateModeEndTime > Date.now();

  // Preserve existing totalTime if tab was already tracked
  const existing = tabSessions.get(tabId);
  const wasTrackedBefore = !!existing;

  // If privacy mode is active and this is a NEW tab (not previously tracked),
  // skip recording it entirely — it won't appear in the Today list
  if (isPrivateMode && !wasTrackedBefore) {
    return;
  }

  tabSessions.set(tabId, {
    hostname,
    title,
    activatedAt: Date.now(),
    totalTime: existing ? existing.totalTime : 0,
    // Clear pausedDuringPrivate when tracking normally (privacy mode ended)
    pausedDuringPrivate: false,
  });
}

/**
 * Called when user switches to a different tab.
 * Finalizes the time for the previous active tab.
 */
async function finalizePreviousTab() {
  if (currentActiveTabId === null || currentSessionStart === null) return;

  // Skip tracking when private mode is active
  if (privateModeEndTime !== null && privateModeEndTime > Date.now()) return;

  const session = tabSessions.get(currentActiveTabId);
  if (!session) return;

  const elapsed = Date.now() - currentSessionStart;
  session.totalTime += elapsed;

  // Skip writing for blocked domains
  const { blockedDomains = [] } = await chrome.storage.local.get('blockedDomains');
  if (blockedDomains.includes(session.hostname)) return;

  // Update daily history (hostname-level aggregation)
  const today = new Date().toISOString().split('T')[0];
  const key = `dailyHistory.${today}.${session.hostname}`;
  const stored = await chrome.storage.local.get(key);
  const current = stored[key] || 0;
  await chrome.storage.local.set({ [key]: current + elapsed });

  // Update hourly heatmap data
  const hour = new Date().getHours();
  const hKey = `hourlyData.${session.hostname}`;
  const hStored = await chrome.storage.local.get(hKey);
  const hData = hStored[hKey] || {};
  if (!hData[today]) hData[today] = new Array(24).fill(0);
  hData[today][hour] = (hData[today][hour] || 0) + elapsed;
  // Only keep last 30 days of hourly data to avoid unbounded growth
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  for (const d of Object.keys(hData)) {
    if (d < cutoffStr) delete hData[d];
  }
  await chrome.storage.local.set({ [hKey]: hData });

  // Record last focus time for this hostname (used for staleness detection)
  hostnameLastFocus.set(session.hostname, Date.now());

  currentSessionStart = null;
}

/**
 * Activate a tab — stop tracking the previous one and start tracking this one.
 */
async function activateTab(tabId) {
  await finalizePreviousTab();

  currentActiveTabId = tabId;
  currentSessionStart = Date.now();

  try {
    const tab = await chrome.tabs.get(tabId);
    await recordTab(tabId, tab);
  } catch {}
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

// Tab becomes active
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await activateTab(tabId);
  updateBadge();
});

// Tab created — start tracking immediately if it's the active tab
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tab.id) {
      await activateTab(tab.id);
    }
  } catch {}
  updateBadge();
});

// Tab removed — finalize its time and remove from tracking
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = tabSessions.get(tabId);
  if (session) {
    // If the closed tab is the ACTIVE tab, finalize its running time first
    const isActiveTab = (currentActiveTabId === tabId);
    let totalForTab = session.totalTime;
    if (isActiveTab && currentSessionStart !== null) {
      totalForTab += Date.now() - currentSessionStart;
    }
    // Note: if the closed tab is NOT the active tab, session.totalTime is
    // already finalized by finalizePreviousTab() when user switched away,
    // so we just use it as-is.

    // Skip writing for blocked domains
    const { blockedDomains = [] } = await chrome.storage.local.get('blockedDomains');
    if (!blockedDomains.includes(session.hostname) && totalForTab > 0) {
      const today = new Date().toISOString().split('T')[0];
      const key = `dailyHistory.${today}.${session.hostname}`;
      const stored = await chrome.storage.local.get(key);
      await chrome.storage.local.set({ [key]: (stored[key] || 0) + totalForTab });
      hostnameLastFocus.set(session.hostname, Date.now());
    }
  }
  tabSessions.delete(tabId);
  dormantTabIds.delete(tabId);
  if (currentActiveTabId === tabId) {
    currentActiveTabId = null;
    currentSessionStart = null;
  }
  updateBadge();
});

// Tab discard state changes (dormant/wake transitions)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === currentActiveTabId && changeInfo.title) {
    const session = tabSessions.get(tabId);
    if (session) session.title = changeInfo.title;
  }
  // Track discarded state
  if ('discarded' in changeInfo) {
    if (changeInfo.discarded) {
      dormantTabIds.add(tabId);
    } else {
      dormantTabIds.delete(tabId);
    }
  }
  updateBadge();
});

// ─── Persist session data periodically ───────────────────────────────────────

// Save current tab sessions to storage so we can restore after SW restart
async function persistSessions() {
  if (currentActiveTabId === null || currentSessionStart === null) return;

  const session = tabSessions.get(currentActiveTabId);
  if (!session) return;

  // Finalize time for current tab before saving
  const currentElapsed = Date.now() - currentSessionStart;
  const totalForCurrent = session.totalTime + currentElapsed;

  const sessionData = {};
  tabSessions.forEach((s, id) => {
    sessionData[`tab_${id}`] = {
      hostname: s.hostname,
      title: s.title,
      totalTime: id === currentActiveTabId ? totalForCurrent : s.totalTime,
    };
  });

  await chrome.storage.local.set({ sessionData });
}

// Persist every 30 seconds
setInterval(persistSessions, 30000);

// Also persist when tab is deactivated (onActivated already calls finalizePreviousTab)
chrome.tabs.onActivated.addListener(async () => {
  await persistSessions();
});

// ─── Restore sessions on startup ─────────────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  // Clear stale data and start fresh
  currentActiveTabId = null;
  currentSessionStart = null;
  tabSessions.clear();
  updateBadge();
});

chrome.runtime.onInstalled.addListener(async () => {
  // On install, try to restore any saved sessions
  const { sessionData } = await chrome.storage.local.get('sessionData');
  if (sessionData) {
    // Restore session data (without active timing — will resume on next tab activation)
    for (const [key, val] of Object.entries(sessionData)) {
      const tabId = parseInt(key.replace('tab_', ''), 10);
      if (!isNaN(tabId)) {
        tabSessions.set(tabId, {
          hostname: val.hostname,
          title: val.title,
          activatedAt: Date.now(),
          totalTime: val.totalTime || 0,
        });
      }
    }
  }
  updateBadge();
});

// ─── Badge Updater (existing functionality) ───────────────────────────────────

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    let color;
    if (count <= 10) {
      color = '#3d7a4a';
    } else if (count <= 20) {
      color = '#b8892e';
    } else {
      color = '#b35a5a';
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Initial badge
updateBadge();

// ─── Message Handler (for app.js to query session data) ──────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SESSION_DATA') {
    // Return all tracked tab sessions
    const result = {};
    tabSessions.forEach((s, id) => {
      result[id] = { ...s };
    });

    // Add current active tab's running time
    if (currentActiveTabId !== null && currentSessionStart !== null) {
      const session = tabSessions.get(currentActiveTabId);
      if (session) {
        const runningTime = Date.now() - currentSessionStart;
        const existing = result[currentActiveTabId];
        if (existing) {
          existing.totalTime = (existing.totalTime || 0) + runningTime;
        }
      }
    }

    sendResponse({ tabSessions: result });
    return true;
  }

  // ── Private mode: enable with duration in minutes (or 'midnight') ──
  if (message.type === 'SET_PRIVATE_MODE') {
    const minutes = message.minutes;
    if (minutes === null) {
      // Disable private mode
      privateModeEndTime = null;
    } else if (minutes === 'midnight') {
      // Calculate ms until midnight
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      privateModeEndTime = midnight.getTime();
    } else {
      privateModeEndTime = Date.now() + minutes * 60 * 1000;
    }
    sendResponse({ privateModeEndTime });
    return true;
  }

  if (message.type === 'GET_PRIVATE_MODE') {
    // Auto-disable if expired
    if (privateModeEndTime !== null && Date.now() > privateModeEndTime) {
      privateModeEndTime = null;
    }
    sendResponse({ privateModeEndTime });
    return true;
  }

  // ── Get staleness data: last focus time per hostname ──
  if (message.type === 'GET_STALENESS') {
    sendResponse({ hostnameLastFocus: Object.fromEntries(hostnameLastFocus) });
    return true;
  }

  // ── Get hourly heatmap data for a specific date ──
  if (message.type === 'GET_HOURLY_DATA') {
    const targetDate = message.date || new Date().toISOString().split('T')[0];
    // Use Promise chain to handle async storage access
    chrome.storage.local.get(null, (items) => {
      const allKeys = Object.keys(items);
      const hKeys = allKeys.filter(k => k.startsWith('hourlyData.'));
      const result = {};
      for (const hKey of hKeys) {
        const hostname = hKey.replace('hourlyData.', '');
        const stored = items[hKey];
        if (stored && stored[targetDate]) {
          result[hostname] = stored[targetDate];
        }
      }
      sendResponse({ hourlyData: result, date: targetDate });
    });
    return true;
  }

  // ── Discard (sleep) a specific tab ──
  if (message.type === 'DISCARD_TAB') {
    const tabId = message.tabId;
    if (tabId != null) {
      chrome.tabs.discard(tabId).then(() => {
        dormantTabIds.add(tabId);
        sendResponse({});
      }).catch(() => {
        sendResponse({});
      });
    } else {
      sendResponse({});
    }
    return true;
  }

  // ── Get list of currently dormant tab IDs ──
  if (message.type === 'GET_DORMANT_TABS') {
    sendResponse({ dormantTabIds: Array.from(dormantTabIds) });
    return true;
  }

  return true;
});
