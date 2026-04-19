# Changelog

All notable changes to **Tab Out Tempus** (our fork with custom features) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.3.5] — 2026-04-19

### Fixed — Time goes backwards, time freezes, dead-second chips (critical regression from 1.3.3)

Three user-visible bugs that all trace back to the same architectural mistake in 1.3.3:

1. **Non-active tab time stops advancing** — You look at X for 5 minutes, return to Tempus, X's chip shows "8m" and just sits there. The last 5 minutes never appear.
2. **Time goes backwards** — A chip shows "8m", you click into the tab and back, it drops to "1m", then "59s". Cumulative counters should never decrease. Ever.
3. **Dead seconds** — Chips showing `s` units (e.g. "3s") looked frozen because the update cadence was 10s but the displayed unit was 1s. Users saw "3s" for 10 seconds at a time.

### Root cause

1.3.3 defined per-tab lifetime as **"sum of `timeLog` entries tagged with this `tid`, intersected with `[firstSeen, now]`, plus the current active slice"**. Mathematically correct but operationally fragile on MV3 service workers:

- Frontend cached this aggregation on a 10s throttle (hence bug #1: a finalised slice could miss the current refresh window entirely).
- SW could be killed mid-session. On wake, if `__activeSession` (a 30s alarm snapshot) was stale or missing, the "pending slice" for the tab was silently lost — but `firstSeen` was preserved. The aggregation then read `timeLog` and came up short of the previous tick's displayed value (hence bug #2: visible rollback).
- The fallback "show seconds for 5-59s" in `formatDuration` made dead-second chips inevitable whenever a tab sat non-active for under a minute (hence bug #3).

### Fix — Monotonic `cumulativeMs` per tab (architectural)

Per-tab lifetime is no longer derived from `timeLog`. Each tab now carries a `cumulativeMs` counter maintained by `background.js`:

- **Increment** — `finalizePreviousTab()` and `onRemoved` `+=` the finalised slice into `session.cumulativeMs`. Never subtracts.
- **Persist** — `persistVolatileState()` writes `{firstSeen, cumulativeMs}` to `chrome.storage.session` (every 30s via alarm + on tab-close + on SW state changes).
- **Restore** — `restoreVolatileState()` + `rebuildTabSessions()` read the saved shape on SW wake. Legacy shape (bare firstSeen ms from 1.3.3/1.3.4) is accepted — cumulativeMs just restarts from 0 in that case.
- **Expose** — `GET_SESSION_DATA.tabInfo[id]` now includes `cumulativeMs`. Frontend reads it directly on every 5s tick.

The frontend's `aggregateOpenTabsLifetime()` + `refreshLifetimeCache()` pair is removed entirely (~80 lines). `refreshTimerDisplay()` now reads `tabInfoMap[id].cumulativeMs` and adds `activeRunningMs` only for the currently active tab.

### Behavioral guarantees

- **Cumulative counters never decrease.** `cumulativeMs` is strictly monotonic. SW death can cause at most ~30 seconds of under-counting (the window between alarm ticks), never a rollback.
- **Non-active tab updates are <5s fresh.** Every tick (5s) the frontend sees the SW's latest `cumulativeMs`, which was updated the instant the user switched away.
- **`timeLog` is still written** — for the history views (Today/Week/Month/Year). The per-tab live display just no longer depends on it.

### Changed — Chip time unit: minute minimum

- `formatDuration(ms)` default path: minimum display unit is **1 minute**. Tabs with <60s accumulation now show `<1m` / `<1分钟` instead of `3s`, `12s`, etc. This matches the actual update cadence (non-active tabs only jump when the user switches away from them) and eliminates the "dead second" illusion.
- `formatDuration(ms, {allowSeconds: true})` opt-in seconds mode retained for any future caller that needs it. No current callsite uses it.

### Files touched
- `extension/background.js` — +40 / −20 lines
- `extension/app.js` — +45 / −115 lines  (net −70)
- `extension/manifest.json` — version bump

---

## [1.3.4] — 2026-04-19

### Fixed — Multi-Window Focus Tracking

Before this release the timer assumed a single-window world: it listened only to `chrome.tabs.onActivated`, which fires only when the active tab changes *within* a window. As a result, two bugs surfaced:

1. **Focus leak across windows** — Clicking from Chrome window A into window B did not fire `onActivated`, so the timer kept accruing time against A's active tab while the user was actually reading in B.
2. **Out-of-Chrome leak** — Alt-tabbing to a non-Chrome application (Slack, VS Code, browser closed behind another app) never paused the timer. The extension's purpose is to measure time spent *inside* Chrome, so this was clearly wrong.

### Added
- **`chrome.windows.onFocusChanged` listener** — The single source of truth for "which tab is currently being watched". Switches the timer target to the active tab of the newly-focused window, or pauses entirely when `windowId === WINDOW_ID_NONE` (user left Chrome).
- **`focusedWindowId` state variable** — In-memory record of the currently focused Chrome window, consulted by `onActivated` / `onCreated` before they touch the timer.
- **`initFocusedWindow()` bootstrap** — Runs on every SW startup path (`onStartup`, `onInstalled`, and top-level SW init for event-driven wakes). Uses `chrome.windows.getLastFocused()` to discover the current focus state; if Chrome isn't focused, leaves the timer paused.

### Changed
- **`onActivated`** — Now compares the event's `windowId` against `focusedWindowId`. Background-window tab switches update metadata (hostname, title, firstSeen) but don't hijack the timer.
- **`onCreated`** — Switched from ambiguous `currentWindow: true` (not well-defined in SW context) to `lastFocusedWindow: true`, and gates timer takeover on `tab.windowId === focusedWindowId`.
- **Semantics** — The timer now represents **time spent actively using Chrome**, not "time Chrome was open". Matches the product mission.

### Technical
- All three startup hooks (`onStartup`, `onInstalled`, top-level SW init) call `initFocusedWindow()` in addition to the existing restore path, so event-driven SW wakes (where neither `onStartup` nor `onInstalled` fires) still get a correct `focusedWindowId`.
- On SW cold start with Chrome focused, `initFocusedWindow()` also seeds `currentActiveTabId` / `currentSessionStart` from the focused window's active tab, eliminating a small gap where SW was alive but no timer was running.
- No new permissions required (`windows.onFocusChanged` is available on the existing `tabs` permission set).

---

## [1.3.3] — 2026-04-19

### Changed — Per-Tab Time Tracking

Fundamental redesign of open-tab timing: each tab now tracks its own cumulative usage time from the moment it was opened. The old "today total" bucket-by-domain model made it impossible to see cross-day tab lifetime — a tab left open for 3 days would only show today's usage. Now each tab accumulates across every day it stays open.

**Two coexisting time models:**
- **Header "今日工作" / "Today's work"** — still shows today's cross-domain total (dayStart → now). Unchanged.
- **Domain card time** — now shows the **sum of all open tabs' lifetime accumulation** in that domain (not "today's domain time"). A tab opened yesterday and still running today contributes its full running total.
- **Per-tab chip time badge (NEW)** — each individual tab chip now shows its own cumulative time (e.g. `45m`, `2.5h`, `3d1h`), formatted in a small grey badge next to the title.

**Tab identity model:**
- `timeLog` entries now carry `tid` (tab.id) in addition to `{s, e, h}`. Legacy entries without `tid` still contribute to domain-level totals but can't be attributed to a specific tab.
- `tabSessions` records `firstSeen` (UTC ms) — when Tempus first started tracking that tab.
- `firstSeen` is persisted to `chrome.storage.session` (via `__tabFirstSeen`), so SW restarts preserve tab identity. Browser restarts (`onStartup`) reset it since Chrome assigns new `tab.id` values on restart — this matches the expected semantics of "this tab has been open since I started the browser".

### Added
- `aggregateOpenTabsLifetime()` — new aggregation helper that reads `timeLog` once and dispatches entries to per-tab buckets based on each tab's `firstSeen` boundary.
- `.chip-time-badge` CSS — small tabular-numeric badge showing cumulative time per tab.

### Technical
- `GET_SESSION_DATA` response now includes `tabInfo[id].firstSeen`.
- `onRemoved` re-persists `__tabFirstSeen` to keep it clean when tabs close.
- Lifetime cache refreshes every 10s (same cadence as today-total cache); manually invalidated after `fetchOpenTabs()` so newly-opened tabs get their badge populated on next refresh.

---

## [1.3.2] — 2026-04-19

### Fixed — Code Review Issues (MV3 Compliance + Robustness)

#### 🔴 Critical (MV3 lifecycle)
- **#1 `setInterval` → `chrome.alarms`** — Session persistence timer now uses `chrome.alarms` (`tempus-persist-session`, 30s interval) instead of `setInterval`, which is cancelled when the Service Worker terminates. Added `"alarms"` permission to manifest.
- **#2 Volatile state persistence** — `privateModeEndTime` and `hostnameLastFocus` are now mirrored to `chrome.storage.session` so they survive SW restarts. `tabSessions` is rebuilt from `chrome.tabs.query()` on SW wake.
- **#3 Write queue for `appendTimeLog`** — Serialized via a `Promise` chain to eliminate read-modify-write race conditions when concurrent events try to write simultaneously.

#### 🟡 Should-fix
- **#4 Removed unused `"sessions"` permission** — Replaced with `"alarms"` which is actually needed. Leaner permission footprint.
- **#5 `onRemoved` private mode check** — Closing the active tab during private mode no longer writes a timeLog entry. Previously only `finalizePreviousTab` checked privacy mode; now `onRemoved` does too.
- **#6 Message handler fallthrough** — `onMessage` listener now returns `false` for unrecognized message types instead of `true`, preventing Chrome from holding the response channel open indefinitely.
- **#7 `recoverActiveSession` re-entrance guard** — Added a `recoveringSession` flag to prevent double-writes when `onStartup` and `onInstalled` fire simultaneously.
- **#8 `blockedDomains` cache** — Loaded once on startup, kept in sync via `chrome.storage.onChanged`. Eliminates async storage reads on every tab switch.
- **#9 `config.local.js` 404 fix** — Created an empty placeholder file with usage documentation so the `<script>` tag in index.html doesn't produce a console error.
- **#10 Settings panel i18n** — All Settings panel text ("设置", "隐私名单", "历史记录迁移", etc.) now updates dynamically when language is toggled.

### Changed
- **Badge updates debounced** — `updateBadge()` calls are debounced (200ms) to avoid excessive `chrome.tabs.query` calls during rapid tab events.
- **`onUpdated` only triggers badge on discard state changes** — Previously called `updateBadge()` on every title/URL change; now only on `discarded` status transitions.

### Polished (Nice-to-have fixes)
- **#11** `formatDuration()` now shows seconds (e.g., `45秒` / `45s`) for 5-59s instead of "0分钟" / "0m".
- **#12** Productivity banner messages have proper English versions (no more Chinese text leaking into English mode).
- **#13** CSS selectors using hostname now escape via `CSS.escape()` to prevent selector breakage from exotic hostnames.
- **#15** Importing timeLog JSON now deduplicates based on `s+e+h` — repeated imports won't double data. Toast message shows dedup count.

### Security
- **#17-19** Tightened HTML escaping across `renderDomainCard` and `buildOverflowChips`: all `data-hostname` attributes now use `escapeHtml()`, and tab titles are fully escaped (previously only quotes were replaced, leaving `<>` unescaped — a latent XSS vector if a malicious site crafted a title).
- **#20** Simplified alarm creation: `chrome.alarms.create()` is itself idempotent, so the async `get()` + conditional `create()` pattern was replaced with a direct call.

### Added
- `docs/REVIEW_ISSUES.md` — Tracks all 20 issues from the comprehensive code review (16 original + 4 discovered during centralized re-audit) with fix status.
- `extension/config.local.js` — Empty placeholder for user-specific config (gitignored).

---

## [1.3.1] — 2026-04-19

### Fixed — Timer System Redesign
- **Critical: Double-counting bug** — `onRemoved` was writing `totalForTab` (which included already-finalized time from `finalizePreviousTab()`), causing daily totals to inflate 2-3x. Now only the active tab writes on close; non-active tabs are already finalized.
- **Critical: `refreshTimerDisplay()` double-counting** — Header "Time Spent" added `sessionMs` (containing already-persisted `totalTime`) on top of `historicalMs`, counting the same time twice. Now uses `activeRunningMs` (unfinalised only) + `timeLog` aggregate.
- **UTC/local time mismatch** — `dailyHistory` keys used UTC dates but `hourlyData` used local hours, causing data to land in the wrong day/hour for non-UTC timezones. All storage is now UTC timestamps; all display uses local timezone conversion.
- **"Today" definition used UTC** — `getTodayHistoricalTotal()` filtered by UTC date string, misattributing UTC-0:00–08:00 data for UTC+8 users. Now uses local midnight-to-midnight as UTC timestamp range with interval intersection.

### Changed — New Storage Model
- **`timeLog` replaces `dailyHistory` + `hourlyData`** — Each browsing session is stored as `{s, e, h}` (start/end UTC timestamps + hostname) in monthly shards (`timeLog.YYYY-MM`). This is lossless and supports any timezone or date range aggregation.
- **Interval intersection algorithm** — All time calculations (today total, week/month/year stats, heatmap) use `Math.max(entry.s, rangeStart)` / `Math.min(entry.e, rangeEnd)` for millisecond-precise clipping at boundaries.
- **Automatic migration** — On first load after update, all `dailyHistory.*` entries are converted to approximate `timeLog` entries (noon UTC ± duration). Old keys are preserved for rollback safety.
- **Timer refresh 1s → 5s** — Reduces CPU/storage overhead by 80%.
- **Visibility control** — Timer interval pauses when the new-tab page is hidden; resumes immediately with a fresh read when it becomes visible again.
- **Session persistence simplified** — Only the active tab's `sessionStart` timestamp is saved (every 30s). On SW restart, the gap is recovered up to the last save point.
- **Export format** — Now includes `timeLog.*` shards alongside legacy `dailyHistory.*` for backward compatibility. Import merges `timeLog` entries into existing shards.

### Technical
- New storage format: `timeLog.YYYY-MM` → `Array<{s: number, e: number, h: string}>`
- `background.js` no longer maintains `totalTime` per session — eliminates the root cause of double-counting.
- `GET_SESSION_DATA` returns `{activeRunningMs, activeHostname, activeTabId, tabInfo}` instead of full `tabSessions` with `totalTime`.
- `GET_HOURLY_DATA` now accepts `{localDayStartMs, localDayEndMs}` and computes from `timeLog` instead of reading old `hourlyData.*` keys.
- New `app.js` helpers: `getMonthKeys()`, `readTimeLogRange()`, `aggregateTimeLog()`, `getLocalTodayRange()`, `getLocalDateRangeMs()`.

### Code Quality (follow-up cleanup)
- **Heatmap cross-hour precision** — Entries spanning multiple hours (e.g., 1:30–3:15) now split time across each hour bucket instead of dumping everything into the start hour.
- **Dead code removed** — `onRemoved` had a redundant `currentActiveTabId === tabId` check after it was already nulled.
- **Merged duplicate `onActivated` listeners** — Tab activation, badge update, and session persistence now handled in a single listener.
- **`aggregateTimeLog` optimization** — Accepts optional `blockedOverride` parameter to avoid re-reading `blockedDomains` from storage when the caller already has it.
- **Heatmap legend i18n** — "少/多" labels now properly switch to "Less/More" in English mode.
- **Stale comment fix** — Updated comment in `renderStaticDashboard` from "every second" to "every 5s".

---

## [1.3.0] — 2026-04-19

### Changed
- **Project rename: Tab Out → Tab Out Tempus** — Full rebrand across all files:
  - Extension name in `manifest.json` (name + default_title)
  - HTML `<title>` and footer attribution in `index.html`
  - All user-visible text (banners, toasts, i18n strings) in `app.js`
  - All JS variable/function names (`isTabOut` → `isTempus`, `tabOutTabs` → `tempusTabs`, `closeTabOutDupes` → `closeTempusDupes`, `checkTabOutDupes` → `checkTempusDupes`, etc.)
  - All HTML element IDs (`tabOutDupeBanner` → `tempusDupeBanner`, etc.)
  - Console log prefix `[tab-out]` → `[tempus]`
  - Export filename `tabout-history-*.json` → `tempus-history-*.json`
  - All documentation (README, AGENTS, CHANGELOG, docs/)
- Version bumped to 1.3.0.

### Fixed
- **Footer attribution** — Added `& dengduck` credit with GitHub link alongside Zara's attribution.
- **Privacy mode i18n** — Fixed select options (`15 minutes`, `1 hour`, etc.), button labels, tooltips, and toasts all hard-coded in Chinese. Now fully i18n-aware, matching the active language (EN/ZH). Affected: `formatMinutes()`, `updatePrivateModeTooltip()`, and 3 toggle toast messages.
- **Header layout** — Language toggle and Settings button now share the same row (new `.header-actions` flex container), instead of stacking vertically.

### Removed
- Leftover `[DEBUG renderHeatmap]` console log.

---

## [1.2.0] — 2026-04-19

### Fixed
- **Heatmap overlay bug** — Switching to Week/Month/Year views now correctly hides the heatmap; switching back restores it. Language toggle also properly resets heatmap visibility per view.

### Added
- **docs/** — Project knowledge base for AI collaborators: PROJECT.md, ARCHITECTURE.md, DEBUGGING.md, DEV_GUIDE.md.
- **README.md bilingual header** — Added Chinese introduction at the top.
- **Fork attribution** — README and AGENTS.md now reference the extended fork by [dengduck](https://github.com/dengduck/tab-out).

### Changed
- AGENTS.md updated to point to `https://github.com/dengduck/tab-out` instead of upstream.

---

## [1.1.0] — 2026-04-18

### Added
- **History Stats Views** — Switch between Today / Week / Month / Year to see aggregated time spent per domain. Data is read from `dailyHistory.*` keys already being written by `background.js`.
- **View Switcher** — Four-button pill selector in the header for quick navigation between live (Today) and historical views.
- **Per-domain time badges** — Domain cards now show cumulative session time with a `group-time-badge` element that refreshes every second.

### Changed
- `background.js` continues to write `dailyHistory.YYYY-MM-DD.hostname` entries as before — no changes needed there.
- `app.js` `refreshTimerDisplay()` now correctly iterates the `tabSessionData` object with `Object.values()`.

### Technical
- Storage key format: `dailyHistory.{date}.{hostname}` (milliseconds, accumulated per day per domain).
- Stats aggregation: reads all `chrome.storage.local` keys matching `dailyHistory.{date}.*`, filters by date range, sums by hostname.

---

## [1.0.0] — 2026-04-04 (upstream base)

> Upstream release — see [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out)

- Initial release with domain grouping, homepage cards, swoosh + confetti, duplicate detection, save-for-later, localhost port labels.
