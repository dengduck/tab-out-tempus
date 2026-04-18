# Changelog

All notable changes to **Tab Out Tempus** (our fork with custom features) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
