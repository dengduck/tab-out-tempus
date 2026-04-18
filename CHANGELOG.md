# Changelog

All notable changes to **Tab Out** (our fork with custom features) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
