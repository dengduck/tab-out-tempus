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

// ─── Tab Activation Tracking ──────────────────────────────────────────────────

/**
 * Record the hostname + title for a tab.
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

  // Preserve existing totalTime if tab was already tracked
  const existing = tabSessions.get(tabId);
  tabSessions.set(tabId, {
    hostname,
    title,
    activatedAt: Date.now(),
    totalTime: existing ? existing.totalTime : 0,
  });
}

/**
 * Called when user switches to a different tab.
 * Finalizes the time for the previous active tab.
 */
async function finalizePreviousTab() {
  if (currentActiveTabId === null || currentSessionStart === null) return;

  const session = tabSessions.get(currentActiveTabId);
  if (session) {
    const elapsed = Date.now() - currentSessionStart;
    session.totalTime += elapsed;

    // Update daily history (hostname-level aggregation)
    const today = new Date().toISOString().split('T')[0];
    const key = `dailyHistory.${today}.${session.hostname}`;
    const stored = await chrome.storage.local.get(key);
    const current = stored[key] || 0;
    await chrome.storage.local.set({ [key]: current + elapsed });
  }

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
  if (session && currentSessionStart !== null) {
    // Add any unrecorded time to history
    const elapsed = Date.now() - currentSessionStart;
    const today = new Date().toISOString().split('T')[0];
    const key = `dailyHistory.${today}.${session.hostname}`;
    const stored = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: (stored[key] || 0) + session.totalTime + elapsed });
  }
  tabSessions.delete(tabId);
  if (currentActiveTabId === tabId) {
    currentActiveTabId = null;
    currentSessionStart = null;
  }
  updateBadge();
});

// Tab updated (URL change etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === currentActiveTabId && changeInfo.title) {
    const session = tabSessions.get(tabId);
    if (session) session.title = changeInfo.title;
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

// Persist every 5 seconds
setInterval(persistSessions, 5000);

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

// Also update badge when extension starts
chrome.runtime.onInstalled.addListener(() => { updateBadge(); });

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
  }
  return true;
});
