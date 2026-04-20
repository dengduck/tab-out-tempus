**Language:** English | [简体中文](README.zh-CN.md)

# Tab Out Tempus

**Keep tabs on your tabs.**

Tab Out Tempus is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

No server. No account. No external API calls. Just a Chrome extension.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/dengduck/tab-out-tempus
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
git clone https://github.com/dengduck/tab-out-tempus.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tab Out Tempus.

---

## How it works

```
You open a new tab
  -> Tab Out Tempus shows your open tabs grouped by domain
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

Special thanks to **[web-activity-time-tracker](https://github.com/brave-tools/web-activity-time-tracker)** — an excellent open-source Chrome extension for web activity time tracking. While Tab Out Tempus shares **no code** with it (different stacks: they use Vue/TypeScript, we use vanilla ES Modules), studying its architecture gave us valuable design insights:

- Correct usage patterns for `chrome.idle` API with audible-media exceptions
- A minimal implementation path for per-domain time limits (via `chrome.tabs.update` to a local block page, zero extra permissions)
- Inspired our differentiation direction — while they implement per-domain limits, we extend this to **category-based group budgets** (e.g. a unified daily budget for "entertainment" covering multiple sites)
- Cross-referencing their architecture helped us lock in our **single time ledger model** (see `docs/DECISIONS-v2.md` D17)

We're grateful for the project being open-source, which made this kind of cross-learning possible.

---

## License

MIT License. Built by [Zara](https://x.com/zarazhangrui). Extended fork by [dengduck](https://github.com/dengduck/tab-out-tempus) as **Tab Out Tempus**.
