**Language:** English | [简体中文](README.zh-CN.md)

# Tabpus

**Keep tabs on your tabs.**

Tabpus is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

No server. No account. No external API calls. Just a Chrome extension.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/dengduck/tabpus
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

### Core
- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **100% local** your data never leaves your machine
- **Pure Chrome extension** no server, no Node.js, no npm, no setup beyond loading the extension

### Time & Stats
- **Session time tracking** shows how long you've spent on each domain in real time
- **Per-hostname timer badge** live-updates on each domain card as you browse
- **History stats** switch between Today / Week / Month / Year views to see where your time went
- **Privacy blocklist** exclude specific domains from all statistics
- **Productivity banner** shows a warm, encouraging summary at the top of Today and Week views
- **24-hour heatmap** visualizes your daily browsing intensity per domain (Today view)
- **Tab staleness tracking** badges domains that haven't been visited in 7+ days

### Focus & Privacy
- **Privacy mode (focus timer)** pauses all time tracking for a chosen duration (15min / 30min / 1h / 2h / 8h / until midnight) — perfect for handling sensitive tasks without leaving a trace
- **Simultaneous domain detection** warns you when too many domains are open at once, suggesting consolidation
- **Tab nap / dormancy** puts idle tabs to sleep using Chrome's native tab discard API to save memory; wake them with one click (💤 badge + dimmed card)

### Data & History
- **Bulk history export** download all your browsing stats as a JSON file for backup
- **History import** restore your stats when migrating or reinstalling the extension

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/dengduck/tabpus.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tabpus.

---

## How it works

```
You open a new tab
  -> Tabpus shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
  -> Switch to Week/Month/Year to review your browsing history
  -> Enable Privacy Mode when you need focus without tracking
  -> Put tabs to sleep to save memory, wake them with one click
  -> Export your history before reinstalling, import it after
```

Everything runs inside the Chrome extension. No external server, no API calls, no data sent anywhere. Saved tabs and browsing history are stored in `chrome.storage.local`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## Acknowledgments

Tabpus stands on the shoulders of two open-source projects:

**[Tab Out](https://github.com/zarazhangrui/tab-out)** by [Zara](https://x.com/zarazhangrui) — the original Chrome new-tab extension that inspired this project. Tabpus began as a fork of Tab Out: the core idea of replacing your new tab page with a domain-grouped tab dashboard, the swoosh + confetti close animation, and the "save for later" bookmark flow all trace back to Zara's design. Since then Tabpus has been **completely rewritten** (v2.0 — new modular architecture, zero shared code with v1), but the creative spark started there. Thank you, Zara, for open-sourcing it under the MIT license.

**[web-activity-time-tracker](https://github.com/brave-tools/web-activity-time-tracker)** — an excellent Chrome extension for web activity time tracking (Vue/TypeScript stack, completely different from our vanilla ES Modules). Studying its architecture gave us valuable design insights for the time-tracking layer we built from scratch in v2:

- Correct usage patterns for `chrome.idle` API with audible-media exceptions
- A minimal implementation path for per-domain time limits (via `chrome.tabs.update` to a local block page, zero extra permissions)
- Cross-referencing their architecture helped us lock in our **single time ledger model** (see `docs/DECISIONS-v2.md` D17)

We're grateful for both projects being open-source, which made this kind of cross-learning possible.

---

## License

MIT License. Originally created by [Zara](https://x.com/zarazhangrui) as [Tab Out](https://github.com/zarazhangrui/tab-out). Rewritten and extended by [dengduck](https://github.com/dengduck/tabpus) as **Tabpus**.
