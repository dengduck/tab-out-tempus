/**
 * background.js — Service Worker for Tab Tracking + Badge Updates
 *
 * v1.3.2 — Review fixes: alarms, storage.session, write queue, etc.
 * v1.3.3 — Per-tab time tracking (timeLog entries now carry tid; tabSessions has firstSeen).
 * v1.3.4 — Multi-window focus tracking (chrome.windows.onFocusChanged). Tracks the
 *          active tab of the currently focused window; pauses timing when user
 *          switches to a non-Chrome app (WINDOW_ID_NONE).
 * v1.3.5 — Monotonic per-tab cumulativeMs. Each tab carries a cumulative active-ms
 *          counter that is += on every finalize/remove. Storage-session persists
 *          {firstSeen, cumulativeMs} so SW wake restores the counter. timeLog is
 *          still written for history views, but the per-tab lifetime display
 *          NO LONGER reads/aggregates timeLog. This eliminates the "time goes
 *          backwards" class of bugs entirely — cumulativeMs is monotonic.
 *
 * Two responsibilities:
 * 1. Track tab active time (tab switching timer) using timeLog entries
 * 2. Keep toolbar badge showing open tab count
 *
 * Timer logic:
 * - On tab activation: record hostname + start timestamp (UTC ms)
 * - On tab switch: write a single timeLog entry {s, e, h, tid} for the previous tab
 * - On tab close: only write if it was the active tab (non-active already finalized)
 * - Persist active session every 30s via chrome.alarms (survives SW termination)
 *
 * Storage model:
 *   timeLog.YYYY-MM  →  Array<{s: number, e: number, h: string, tid?: number}>
 *   s = start (UTC ms), e = end (UTC ms), h = hostname, tid = tab.id (v1.3.3+)
 *   Sharded by UTC month for manageable chunk sizes.
 *
 * Per-tab tracking (v1.3.3):
 *   tabSessions entries carry firstSeen (UTC ms when tab was first tracked).
 *   firstSeen is persisted to chrome.storage.session so it survives SW kill.
 *   On browser restart (onStartup), firstSeen resets since tab.id values change.
 *
 * State persistence (Review fix #2):
 *   Critical in-memory state is mirrored to chrome.storage.session so it
 *   survives SW restarts without full re-initialization.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 📑 TABLE OF CONTENTS                                        │
 * ├─────────────────────────────────────────────────────────────┤
 * │ §1  Session Timer State (in-memory)          ~L62          │
 * │ §2  Blocked Domains Cache                    ~L94          │
 * │ §3  State Persistence Helpers                ~L108         │
 * │      · persistVolatileState()                 L114          │
 * │      · restoreVolatileState()                 L128          │
 * │      · rebuildTabSessions()                   L153          │
 * │ §4  timeLog Write Queue (race prevention)   ~L172          │
 * │      · appendTimeLog()                        L182          │
 * │ §5  Privacy Mode Helper                     ~L197          │
 * │ §6  Tab Activation Tracking                 ~L203          │
 * │      · recordTab()                            L209          │
 * │      · finalizePreviousTab()                  L243          │
 * │      · activateTab()                          L292          │
 * │ §7  Event Listeners (tabs.*)                ~L304          │
 * │      · onActivated, onCreated, onRemoved, onUpdated         │
 * │ §8  Session Persistence (chrome.alarms)     ~L377          │
 * │      · persistSessions()                      L383          │
 * │      · alarm listener + create                L405          │
 * │ §9  Startup/Install Handlers                ~L416          │
 * │      · onStartup, onInstalled                              │
 * │      · recoverActiveSession()                 L445          │
 * │ §10 Data Migration                          ~L474          │
 * │      · migrateToTimeLog()                     L480          │
 * │ §11 Badge Updater                           ~L516          │
 * │      · debouncedUpdateBadge()                 L521          │
 * │      · updateBadge()                          L526          │
 * │ §12 Message Handler                         ~L564          │
 * │      · GET_SESSION_DATA, SET/GET_PRIVATE_MODE               │
 * │      · GET_STALENESS, GET_HOURLY_DATA                       │
 * │      · DISCARD_TAB, GET_DORMANT_TABS                        │
 * └─────────────────────────────────────────────────────────────┘
 */

'use strict';

// ─── Session Timer State (in-memory, restored from storage.session on wake) ──

/**
 * Tab session registry. Tracks hostname, title, and lifecycle timestamps for each open tab.
 * Rebuilt from chrome.tabs.query() on SW restart.
 *
 * firstSeen = UTC ms when Tempus first started tracking this tab.
 *   - Fresh tab → set to Date.now() on creation
 *   - SW wake (browser NOT restarted) → restored from storage.session.__tabFirstSeen
 *   - Browser restart (onStartup) → reset, since tab.id values change on restart
 *
 * cumulativeMs = v1.3.5 monotonic counter of active-foreground ms for this tab.
 *   - Incremented ONLY on finalizePreviousTab / onRemoved (never decreases).
 *   - Persisted to storage.session every 30s (alarm) + on tab close.
 *   - SW kill loses at most 30s of "pending slice"; never goes backwards.
 * @type {Map<number, {hostname: string, title: string, activatedAt: number, firstSeen: number, cumulativeMs: number}>}
 */
const tabSessions = new Map();

/** ID of the currently active tab (in the currently focused Chrome window). */
let currentActiveTabId = null;

/** UTC timestamp (ms) when the current active session started. null = no active session. */
let currentSessionStart = null;

/** ID of the currently focused Chrome window. null = Chrome is not focused (user
 *  switched to another app) or we haven't queried yet. Updated by
 *  chrome.windows.onFocusChanged (v1.3.4). */
let focusedWindowId = null;

/** Private / Focus mode — end timestamp (ms), or null when inactive.
 *  Persisted to storage.session so it survives SW restarts (Review fix #2). */
let privateModeEndTime = null;

/** Tracks the last time (ms) each hostname was focused (tab switch away).
 *  Persisted to storage.session for staleness badges (Review fix #2). */
const hostnameLastFocus = new Map();

/** Set of tab IDs currently in the discarded/dormant state */
const dormantTabIds = new Set();

/** Cached blocked domains list — updated via storage.onChanged (Review fix #8) */
let cachedBlockedDomains = [];

/** Guard against concurrent recoverActiveSession calls (Review fix #7) */
let recoveringSession = false;

// ─── Blocked Domains Cache (Review fix #8) ────────────────────────────────────

// Load on startup
chrome.storage.local.get('blockedDomains', (r) => {
  cachedBlockedDomains = r.blockedDomains || [];
});

// Keep in sync
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.blockedDomains) {
    cachedBlockedDomains = changes.blockedDomains.newValue || [];
  }
});

// ─── State Persistence Helpers (Review fix #2) ───────────────────────────────

/**
 * Save privateModeEndTime, hostnameLastFocus, and per-tab {firstSeen, cumulativeMs}
 * to storage.session. Called whenever these values change.
 *
 * v1.3.5: __tabFirstSeen now stores {firstSeen, cumulativeMs} per tab instead of
 * a bare timestamp. Backward-compat: restoreVolatileState handles the old shape too.
 */
async function persistVolatileState() {
  try {
    const tabState = {};
    tabSessions.forEach((s, id) => {
      if (s.firstSeen) {
        tabState[id] = {
          firstSeen: s.firstSeen,
          cumulativeMs: s.cumulativeMs || 0,
        };
      }
    });
    await chrome.storage.session.set({
      __privateModeEndTime: privateModeEndTime,
      __hostnameLastFocus: Object.fromEntries(hostnameLastFocus),
      __tabFirstSeen: tabState,
    });
  } catch {
    // storage.session may not be available in very old Chrome versions
  }
}

/**
 * Restore volatile state from storage.session on SW wake.
 * Note: storage.session is cleared on browser restart, so __tabFirstSeen will
 * only contain data when SW was killed but browser is still running.
 *
 * v1.3.5 accepts two shapes for __tabFirstSeen:
 *   - Legacy (v1.3.3/1.3.4): { [tabId]: <firstSeen ms> }
 *   - Current (v1.3.5+):      { [tabId]: { firstSeen, cumulativeMs } }
 */
async function restoreVolatileState() {
  try {
    const data = await chrome.storage.session.get([
      '__privateModeEndTime',
      '__hostnameLastFocus',
      '__tabFirstSeen',
    ]);
    if (data.__privateModeEndTime != null) {
      privateModeEndTime = data.__privateModeEndTime;
      // Auto-expire if past
      if (privateModeEndTime !== null && Date.now() > privateModeEndTime) {
        privateModeEndTime = null;
      }
    }
    if (data.__hostnameLastFocus) {
      for (const [k, v] of Object.entries(data.__hostnameLastFocus)) {
        hostnameLastFocus.set(k, v);
      }
    }
    // Stash tabFirstSeen for rebuildTabSessions() to consume
    if (data.__tabFirstSeen) {
      _pendingTabFirstSeen = data.__tabFirstSeen;
    }
  } catch {}
}

/** Temporary holder populated by restoreVolatileState() and consumed by rebuildTabSessions(). */
let _pendingTabFirstSeen = null;

/**
 * Rebuild tabSessions from chrome.tabs.query() on SW restart.
 * This restores hostname/title info for the GET_SESSION_DATA handler.
 * firstSeen / cumulativeMs are restored from _pendingTabFirstSeen if available
 * (SW restart within same browser session), otherwise initialized
 * (browser just started or fresh install — we have no prior record).
 *
 * v1.3.5: _pendingTabFirstSeen may carry legacy-shape (bare ms) or new-shape
 * ({firstSeen, cumulativeMs}) per tab.
 */
async function rebuildTabSessions() {
  try {
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    const savedMap = _pendingTabFirstSeen || {};
    for (const tab of tabs) {
      if (!tab.id) continue;
      let hostname = '__internal__';
      let title = tab.title || 'Internal Page';
      try {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('about:')) {
          hostname = new URL(tab.url).hostname.replace(/^www\./, '');
          title = tab.title || hostname;
        }
      } catch {}

      const saved = savedMap[tab.id];
      let firstSeen = now;
      let cumulativeMs = 0;
      if (typeof saved === 'number') {
        // Legacy shape — only firstSeen, cumulative starts from 0
        firstSeen = saved;
      } else if (saved && typeof saved === 'object') {
        firstSeen = saved.firstSeen || now;
        cumulativeMs = saved.cumulativeMs || 0;
      }

      tabSessions.set(tab.id, { hostname, title, activatedAt: 0, firstSeen, cumulativeMs });
      if (tab.discarded) dormantTabIds.add(tab.id);
    }
    _pendingTabFirstSeen = null;
    // Persist the (possibly freshly-initialized) state in new shape
    await persistVolatileState();
  } catch {}
}

// ─── timeLog Write Queue (Review fix #3) ─────────────────────────────────────

/** Serialized write queue to prevent read-modify-write race conditions. */
let writeQueue = Promise.resolve();

/**
 * Append a single time entry to the monthly timeLog shard.
 * Uses a write queue to serialize concurrent writes.
 * @param {{s: number, e: number, h: string, tid?: number}} entry
 *   tid = tab.id (v1.3.3+). Omitted for legacy/recovered entries without tab context.
 */
function appendTimeLog(entry) {
  if (!entry || entry.e - entry.s < 1000) return Promise.resolve();
  writeQueue = writeQueue.then(async () => {
    const monthKey = new Date(entry.s).toISOString().slice(0, 7); // "2026-04"
    const storageKey = `timeLog.${monthKey}`;
    const stored = await chrome.storage.local.get(storageKey);
    const logs = stored[storageKey] || [];
    logs.push(entry);
    await chrome.storage.local.set({ [storageKey]: logs });
  }).catch(err => {
    console.warn('[tempus] appendTimeLog failed:', err);
  });
  return writeQueue;
}

// ─── Privacy Mode Helper ─────────────────────────────────────────────────────

function isPrivateModeActive() {
  return privateModeEndTime !== null && privateModeEndTime > Date.now();
}

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

  const existing = tabSessions.get(tabId);
  const wasTrackedBefore = !!existing;

  // If privacy mode is active and this is a NEW tab, skip recording
  if (isPrivateModeActive() && !wasTrackedBefore) {
    return;
  }

  // Preserve firstSeen + cumulativeMs across recordTab calls (navigation within same tab).
  // Only initialize on the very first record.
  const firstSeen = existing?.firstSeen || Date.now();
  const cumulativeMs = existing?.cumulativeMs || 0;

  tabSessions.set(tabId, {
    hostname,
    title,
    activatedAt: Date.now(),
    firstSeen,
    cumulativeMs,
  });

  // Persist firstSeen map so it survives SW kill (not browser restart)
  if (!existing) {
    persistVolatileState();
  }
}

/**
 * Called when user switches to a different tab.
 * Finalizes the time for the previous active tab by writing a timeLog entry.
 */
async function finalizePreviousTab() {
  if (currentActiveTabId === null || currentSessionStart === null) return;

  // Skip tracking when private mode is active (Review fix #5 — same logic)
  if (isPrivateModeActive()) {
    currentSessionStart = null;
    return;
  }

  const session = tabSessions.get(currentActiveTabId);
  if (!session) {
    currentSessionStart = null;
    return;
  }

  const now = Date.now();

  // Skip writing for blocked domains (uses cache — Review fix #8)
  if (cachedBlockedDomains.includes(session.hostname)) {
    currentSessionStart = null;
    return;
  }

  // Skip internal pages
  if (session.hostname === '__internal__') {
    currentSessionStart = null;
    return;
  }

  // Write a single timeLog entry — the ONLY place we write for tab switches.
  // Also accumulate into this tab's cumulativeMs (v1.3.5 — monotonic counter).
  const elapsed = now - currentSessionStart;
  if (elapsed >= 1000) {
    await appendTimeLog({
      s: currentSessionStart,
      e: now,
      h: session.hostname,
      tid: currentActiveTabId,
    });
    session.cumulativeMs = (session.cumulativeMs || 0) + elapsed;
  }

  // Record last focus time for this hostname (used for staleness detection)
  hostnameLastFocus.set(session.hostname, now);

  // Critical: null out so we never double-write
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

// ─── Event Listeners (all top-level, synchronous registration) ────────────────

// Tab becomes active within its window — may or may not be the focused window.
// v1.3.4: Only switch the timer target when the activated tab belongs to the
// currently focused window. For non-focused windows, just record the tab so
// firstSeen / hostname / title stay up-to-date, but don't hijack the timer.
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    if (focusedWindowId !== null && windowId !== focusedWindowId) {
      // Background-window tab switch — just record metadata, don't touch the timer.
      try {
        const tab = await chrome.tabs.get(tabId);
        await recordTab(tabId, tab);
      } catch {}
      debouncedUpdateBadge();
      return;
    }

    await activateTab(tabId);
    debouncedUpdateBadge();
    await persistSessions();
  } catch {}
});

// Tab created — start tracking immediately if it's the active tab of the focused window.
// v1.3.4: Uses focusedWindowId (if known) or lastFocusedWindow as fallback.
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (focusedWindowId === null) {
      // SW just started; fallback to lastFocusedWindow
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && activeTab.id === tab.id) {
        await activateTab(tab.id);
      } else if (tab.id) {
        // Still record metadata for the new tab (firstSeen etc.)
        await recordTab(tab.id, tab);
      }
    } else if (tab.windowId === focusedWindowId && tab.active) {
      await activateTab(tab.id);
    } else if (tab.id) {
      await recordTab(tab.id, tab);
    }
  } catch {}
  debouncedUpdateBadge();
});

// Tab removed — only write timeLog if this was the ACTIVE tab
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = tabSessions.get(tabId);

  if (session && currentActiveTabId === tabId && currentSessionStart !== null) {
    // Review fix #5: Skip if private mode is active
    if (isPrivateModeActive()) {
      currentActiveTabId = null;
      currentSessionStart = null;
    } else {
      // This is the active tab being closed — write the final segment
      const now = Date.now();
      const elapsed = now - currentSessionStart;

      // Skip blocked/internal domains (uses cache — Review fix #8)
      if (!cachedBlockedDomains.includes(session.hostname) && session.hostname !== '__internal__' && elapsed >= 1000) {
        await appendTimeLog({
          s: currentSessionStart,
          e: now,
          h: session.hostname,
          tid: tabId,
        });
        hostnameLastFocus.set(session.hostname, now);
        // v1.3.5: accumulate (though the tab is about to be removed — not strictly
        // needed, but keeps the model consistent in case onRemoved fires twice).
        session.cumulativeMs = (session.cumulativeMs || 0) + elapsed;
      }

      currentActiveTabId = null;
      currentSessionStart = null;
    }
  }
  // Non-active tab closed → already finalized by finalizePreviousTab(), nothing to write.

  tabSessions.delete(tabId);
  dormantTabIds.delete(tabId);
  // Re-persist firstSeen map without the closed tab
  persistVolatileState();
  debouncedUpdateBadge();
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
    debouncedUpdateBadge();
  }
  // Note: don't call updateBadge on every title/url change — only on discard state change
});

// ─── Window Focus Tracking (v1.3.4) ───────────────────────────────────────────
//
// Chrome emits chrome.tabs.onActivated only when the active tab *within a window*
// changes. Switching between windows, or alt-tabbing out of Chrome entirely,
// does NOT fire onActivated. So without windows.onFocusChanged, the timer would:
//   • Keep accumulating time against the old window's active tab after the user
//     clicks into a different Chrome window.
//   • Keep accumulating time while the user is actually in a non-Chrome app.
//
// Our rule: only one tab is "the active tab" at any moment — the active tab of
// the currently focused Chrome window. Switching to a non-Chrome app pauses
// timing entirely (WINDOW_ID_NONE).

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  try {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // User switched away from Chrome (alt-tabbed to another app). Stop timing.
      await finalizePreviousTab();
      currentActiveTabId = null;
      focusedWindowId = null;
      await persistSessions();
      return;
    }

    focusedWindowId = windowId;

    // Find the active tab in the newly focused window.
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (!activeTab || activeTab.id == null) {
      // Shouldn't happen, but be defensive.
      await finalizePreviousTab();
      currentActiveTabId = null;
      return;
    }

    if (activeTab.id !== currentActiveTabId) {
      await activateTab(activeTab.id);
      debouncedUpdateBadge();
      await persistSessions();
    } else if (currentSessionStart === null) {
      // Same tab id, but no active session (we may have paused on WINDOW_ID_NONE
      // earlier). Restart timing.
      currentSessionStart = Date.now();
      await persistSessions();
    }
  } catch {}
});

// ─── Persist session data via chrome.alarms (Review fix #1) ──────────────────

/**
 * Save current active session to storage so we can restore after SW restart.
 * Only saves the active tab's start time — no more totalTime accumulation.
 */
async function persistSessions() {
  if (currentActiveTabId === null || currentSessionStart === null) return;

  const session = tabSessions.get(currentActiveTabId);
  if (!session) return;

  await chrome.storage.local.set({
    __activeSession: {
      tabId: currentActiveTabId,
      hostname: session.hostname,
      title: session.title,
      sessionStart: currentSessionStart,
      savedAt: Date.now(),
    }
  });

  // Also persist volatile state (privateModeEndTime, hostnameLastFocus)
  await persistVolatileState();
}

// Review fix #1: Use chrome.alarms instead of setInterval.
// chrome.alarms survives SW termination; setInterval does not.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tempus-persist-session') {
    await persistSessions();
  }
});

// Create the alarm. chrome.alarms.create() with the same name is idempotent
// (it replaces the existing alarm), so this is safe to call on every SW wake.
// 0.5 minutes = 30 seconds (minimum allowed in Chrome 120+)
chrome.alarms.create('tempus-persist-session', { periodInMinutes: 0.5 });

// ─── Restore sessions on startup ─────────────────────────────────────────────

/**
 * Initialize focusedWindowId and the current active tab on SW startup/wake.
 * Without this, onFocusChanged may not fire until the user clicks into a window,
 * so onActivated's "is this the focused window?" check would misbehave.
 *
 * If Chrome has no focused window (user is in another app), leaves
 * focusedWindowId = null and does NOT start a timer. (v1.3.4)
 */
async function initFocusedWindow() {
  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    if (!win || !win.focused) {
      // Chrome is not the focused app right now — don't start timing.
      focusedWindowId = null;
      return;
    }
    focusedWindowId = win.id;

    // Pick up the active tab of that window as the current tracking target,
    // unless we already have one (recoverActiveSession may have set it).
    if (currentActiveTabId === null) {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (activeTab && activeTab.id != null) {
        currentActiveTabId = activeTab.id;
        currentSessionStart = Date.now();
        try { await recordTab(activeTab.id, activeTab); } catch {}
      }
    }
  } catch {
    focusedWindowId = null;
  }
}

chrome.runtime.onStartup.addListener(async () => {
  currentActiveTabId = null;
  currentSessionStart = null;
  focusedWindowId = null;
  tabSessions.clear();

  // Browser was restarted — tab.id values are all new, so firstSeen records are stale.
  // Clear storage.session so rebuildTabSessions() initializes firstSeen = Date.now()
  // for all current tabs. (storage.session should already be empty, but belt-and-suspenders.)
  try { await chrome.storage.session.remove('__tabFirstSeen'); } catch {}

  await restoreVolatileState();
  await rebuildTabSessions();
  await recoverActiveSession();
  await initFocusedWindow();
  updateBadge();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  // Run data migration on update or fresh install
  await migrateToTimeLog();

  await restoreVolatileState();
  await rebuildTabSessions();
  await recoverActiveSession();
  await initFocusedWindow();
  updateBadge();
});

/**
 * Recover the last active session saved by persistSessions().
 * Writes a timeLog entry for the gap between sessionStart and savedAt,
 * then clears the saved session.
 * Review fix #7: guarded against concurrent calls.
 */
async function recoverActiveSession() {
  if (recoveringSession) return;
  recoveringSession = true;
  try {
    const { __activeSession: saved } = await chrome.storage.local.get('__activeSession');
    if (!saved || !saved.sessionStart || !saved.hostname) {
      await chrome.storage.local.remove('__activeSession');
      return;
    }

    // Write the unfinished segment: from sessionStart to savedAt
    // (we use savedAt, not Date.now(), because the gap after savedAt is unknown — SW was dead)
    if (!cachedBlockedDomains.includes(saved.hostname) && saved.hostname !== '__internal__') {
      const elapsed = saved.savedAt - saved.sessionStart;
      if (elapsed >= 1000) {
        const entry = {
          s: saved.sessionStart,
          e: saved.savedAt,
          h: saved.hostname,
        };
        // Only attach tid if the tab is still alive AND appears to be the same tab
        // (firstSeen must predate sessionStart — otherwise it's a tab.id reuse after
        // browser restart, and we shouldn't attribute this time to the new tab).
        if (saved.tabId) {
          const sess = tabSessions.get(saved.tabId);
          if (sess && sess.firstSeen && sess.firstSeen <= saved.sessionStart) {
            entry.tid = saved.tabId;
          }
        }
        await appendTimeLog(entry);
      }
    }

    await chrome.storage.local.remove('__activeSession');
  } finally {
    recoveringSession = false;
  }
}

// ─── Data Migration: dailyHistory → timeLog ─────────────────────────────────

/**
 * One-time migration from old dailyHistory/hourlyData format to timeLog.
 * Runs on install/update. Idempotent (checks __timeLogMigrated flag).
 */
async function migrateToTimeLog() {
  const allItems = await chrome.storage.local.get(null);
  if (allItems['__timeLogMigrated']) return;

  const monthLogs = {};

  for (const [key, ms] of Object.entries(allItems)) {
    if (!key.startsWith('dailyHistory.')) continue;
    const rest = key.slice('dailyHistory.'.length);
    const dot = rest.indexOf('.');
    if (dot === -1) continue;
    const dateStr = rest.slice(0, dot);
    const hostname = rest.slice(dot + 1);
    if (hostname === '__internal__') continue;
    if (typeof ms !== 'number' || ms <= 0) continue;

    const approxStart = new Date(dateStr + 'T12:00:00Z').getTime();
    if (isNaN(approxStart)) continue;

    const entry = { s: approxStart, e: approxStart + ms, h: hostname };
    const monthKey = dateStr.slice(0, 7);
    if (!monthLogs[monthKey]) monthLogs[monthKey] = [];
    monthLogs[monthKey].push(entry);
  }

  const toWrite = { '__timeLogMigrated': true };
  for (const [month, logs] of Object.entries(monthLogs)) {
    const storageKey = `timeLog.${month}`;
    const existing = allItems[storageKey] || [];
    toWrite[storageKey] = [...existing, ...logs];
  }

  await chrome.storage.local.set(toWrite);
  console.log('[tempus] Migration to timeLog completed:', Object.keys(monthLogs).length, 'month shards');
}

// ─── Badge Updater ───────────────────────────────────────────────────────────

let badgeTimeout = null;

/** Debounced badge update — avoids excessive calls during rapid tab events */
function debouncedUpdateBadge() {
  if (badgeTimeout) clearTimeout(badgeTimeout);
  badgeTimeout = setTimeout(updateBadge, 200);
}

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

// Initialize focusedWindowId on every SW wake (including event-driven wakes
// where onStartup / onInstalled don't fire). Safe to run concurrently with
// onStartup / onInstalled handlers — the result is the same.
initFocusedWindow();

// ─── Message Handler (for app.js to query session data) ──────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── GET_SESSION_DATA: return only the active tab's running time ──
  if (message.type === 'GET_SESSION_DATA') {
    let activeRunningMs = 0;
    let activeHostname = null;
    let activeTabId = null;

    if (currentActiveTabId !== null && currentSessionStart !== null) {
      activeRunningMs = Date.now() - currentSessionStart;
      const session = tabSessions.get(currentActiveTabId);
      activeHostname = session ? session.hostname : null;
      activeTabId = currentActiveTabId;
    }

    const tabInfo = {};
    tabSessions.forEach((s, id) => {
      tabInfo[id] = {
        hostname: s.hostname,
        title: s.title,
        firstSeen: s.firstSeen || 0,
        cumulativeMs: s.cumulativeMs || 0,
      };
    });

    sendResponse({ activeRunningMs, activeHostname, activeTabId, tabInfo });
    return true;
  }

  // ── Private mode: enable with duration in minutes (or 'midnight') ──
  if (message.type === 'SET_PRIVATE_MODE') {
    const minutes = message.minutes;
    if (minutes === null) {
      privateModeEndTime = null;
    } else if (minutes === 'midnight') {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      privateModeEndTime = midnight.getTime();
    } else {
      privateModeEndTime = Date.now() + minutes * 60 * 1000;
    }
    // Persist immediately so it survives SW restart (Review fix #2)
    persistVolatileState();
    sendResponse({ privateModeEndTime });
    return true;
  }

  if (message.type === 'GET_PRIVATE_MODE') {
    if (privateModeEndTime !== null && Date.now() > privateModeEndTime) {
      privateModeEndTime = null;
      persistVolatileState();
    }
    sendResponse({ privateModeEndTime });
    return true;
  }

  // ── Get staleness data: last focus time per hostname ──
  if (message.type === 'GET_STALENESS') {
    sendResponse({ hostnameLastFocus: Object.fromEntries(hostnameLastFocus) });
    return true;
  }

  // ── GET_HOURLY_DATA: compute from timeLog for a local date ──
  if (message.type === 'GET_HOURLY_DATA') {
    const { localDayStartMs, localDayEndMs } = message;
    if (!localDayStartMs || !localDayEndMs) {
      sendResponse({ hourlyData: {} });
      return true;
    }

    const startMonth = new Date(localDayStartMs).toISOString().slice(0, 7);
    const endMonth = new Date(localDayEndMs).toISOString().slice(0, 7);
    const monthKeys = [startMonth];
    if (endMonth !== startMonth) monthKeys.push(endMonth);

    const keysToFetch = monthKeys.map(m => `timeLog.${m}`);
    chrome.storage.local.get(keysToFetch, (items) => {
      const hourlyData = {};

      for (const sKey of keysToFetch) {
        const logs = items[sKey] || [];
        for (const entry of logs) {
          const overlapStart = Math.max(entry.s, localDayStartMs);
          const overlapEnd = Math.min(entry.e, localDayEndMs);
          if (overlapStart >= overlapEnd) continue;

          if (!hourlyData[entry.h]) hourlyData[entry.h] = new Array(24).fill(0);

          // Split across local hour boundaries for precise heatmap
          let cursor = overlapStart;
          while (cursor < overlapEnd) {
            const cursorDate = new Date(cursor);
            const localHour = cursorDate.getHours();
            const nextHourStart = new Date(
              cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate(),
              localHour + 1, 0, 0, 0
            ).getTime();
            const sliceEnd = Math.min(nextHourStart, overlapEnd);
            hourlyData[entry.h][localHour] += (sliceEnd - cursor);
            cursor = sliceEnd;
          }
        }
      }

      sendResponse({ hourlyData });
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

  // Review fix #6: Don't hold channel open for unknown message types
  return false;
});
