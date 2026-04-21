# Changelog

All notable changes to **Tabpus** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [2.0.0] — 2026-04-22

Complete rewrite with modular ES Module architecture. Zero dependencies, zero build tools.
See `docs/REWRITE-PLAN-v2.md` and `docs/DECISIONS-v2.md` for details.

### Architecture (M0–M1)
- **Modular service worker**: 10 independent background modules (`tabRegistry`, `timeTracker`, `focusModel`, `idleGuard`, `privateMode`, `blacklist`, `focusTimer`, `store`, `timeLog`, `alarms`) orchestrated by `sw.js`.
- **Hybrid messaging protocol**: Request-style (`REQ_*`) for one-shot queries + broadcast-style (`BCAST_*`) for real-time state changes (`BCAST_TICK` 1 s, `BCAST_TAB_CHANGE`, `BCAST_STATE_CHANGE`).
- **Single time ledger** (D17): All time data lives in `timeLog` (append-only monthly slices). No redundant aggregation caches — queries are pure functions over the log.
- **pauseReasons Set model** (D9): Multiple pause sources (`window-blur`, `idle`, `private-mode`, `blacklist`, `no-active-tab`) stack independently.

### Added
- **Tab grouping dashboard** (M2): Domain-grouped tab grid with live incremental DOM diff — no full re-render on tab changes.
- **Close FX** (M3): Swoosh sound (Web Audio API, runtime-generated) + confetti burst (Canvas particles). Pure JS, no external assets.
- **Per-tab time tracking** (M4): Accurate per-tab lifetime powered by the single time ledger. Survives service worker restarts via `chrome.alarms` periodic checkpoints.
- **Time UI** (M5): Header shows today's total time. Tab chips display per-tab cumulative time with live-updating badges.
- **History stats** (M6): Today / Week / Month / Year views with per-domain time ranking, 24-hour activity heatmap, and time distribution charts.
- **Save for later** (M7): Bookmark individual tabs to a sidebar checklist before closing. Persisted in `chrome.storage.local`.
- **Focus Timer** (M8): Pomodoro-style focus timer with customizable duration (5/15/25/45/60 min). Header widget shows countdown with SVG icon.
- **Blacklist (Excluded Domains)** (M8): Permanent per-domain exclusion from time tracking. Managed via Settings panel.
- **Private Mode** (M8): Global temporary tracking pause with configurable duration. Auto-expires via `chrome.alarms`.
- **Duplicate tab detection** (M9): Amber "(2×)" badge on duplicate tabs. One-click "Close duplicates" per domain group.
- **Audible exemption** (M9, D17 Bug 2): Tabs playing audio are exempt from idle pause — watching videos no longer triggers false "away" detection.
- **Idle threshold settings** (M9, D20): User-configurable idle detection threshold: 30 s / 1 min / 3 min (default) / 5 min / 10 min / Off. Persisted across sessions.
- **Settings panel** (M9): Unified settings UI with sections for Private Mode, Focus Timer, Blacklist, and Idle threshold.
- **build.sh**: One-command packaging script — produces `extension.zip` ready for Chrome Web Store upload.

### Changed
- **Project rebrand: Tab Out Tempus → Tabpus** — New independent brand name across all files (manifest, HTML, README, docs, AGENTS).
- **GitHub repo renamed**: `dengduck/tab-out-tempus` → `dengduck/tabpus`.
- **Default branch**: `rewrite-v2` replaces `main` as default.
- **Manifest V3**: Full MV3 compliance with `service_worker` + ES module type.

### Fixed
- **reevaluateAudible race condition** (Round 2 P0-01): Added `stateOnEntry` guard so an `idle→active` transition during the async `isActiveTabAudible()` call no longer produces stale resume/pause operations.
- **Idle "Off" setting lost on SW restart** (Round 2 P0-02): `init()` now recognises `threshold === 0` and skips `queryState` / sets a 24 h detection interval as no-op.

### Security
- **No innerHTML with user data** — All DOM construction uses `createElement` + `textContent`.
- **Cross-review**: Two rounds of AI-assisted code review (Round 1: 30 findings / 10 fixed; Round 2: 7 findings / 3 fixed). All P0 bugs resolved.

### Technical
- **Zero dependencies**: No npm, no Node.js, no build tools. Pure HTML/CSS/JS ES Modules.
- **Minimal test framework**: Custom `testUtil.js` + `mockChrome.js` — runs in both browser and Node.js.
- **Module size limit**: Every file stays under ~400 lines.
- **`chrome.alarms` only**: No `setInterval` anywhere — all periodic tasks use Chrome's alarm API for MV3 suspend resilience.

### Acknowledgments
- Originally forked from [**Tab Out**](https://github.com/zarazhangrui/tab-out) by Zara — the core concept (domain-grouped new tab dashboard, swoosh + confetti close animation, save-for-later) originated there. Tabpus v2 is a complete rewrite with zero shared code.
- Design insights for the time-tracking layer (especially around `chrome.idle` usage, per-domain time limits, and the single time ledger architecture) were informed by [**web-activity-time-tracker**](https://github.com/brave-tools/web-activity-time-tracker). No code was copied — we reimplemented everything in vanilla ES Modules. See `docs/DECISIONS-v2.md` D23 for details.

---

## [1.3.0] — 2026-04-19

### Changed
- **Project rename: Tab Out → Tab Out Tempus** (later rebranded to Tabpus in v2.0) — Full rebrand across all files:
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
