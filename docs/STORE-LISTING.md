# Chrome Web Store Listing — Tabpus v2.0.0

> 填写 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) 时复制粘贴即可。

---

## Short Description (132 字符以内)

```
Keep tabs on your tabs. New tab page that groups tabs by domain, tracks browsing time, and lets you close them with swoosh + confetti.
```

## Detailed Description

```
Tabpus replaces your new tab page with a clean dashboard of everything you have open.

🗂️ TABS AT A GLANCE
• Tabs grouped by domain on a visual grid
• Homepages group (Gmail, X, YouTube, LinkedIn, GitHub) in one card
• Click any tab to jump to it — across windows
• Duplicate detection with one-click cleanup
• Localhost grouping shows port numbers

⏱️ TIME TRACKING
• Per-domain session time with live-updating badges
• History stats: Today / Week / Month / Year views
• 24-hour activity heatmap
• Single time ledger — no duplicate counting, no numbers jumping backward

🎯 FOCUS & PRIVACY
• Focus Timer: Pomodoro-style (5/15/25/45/60 min) with header countdown
• Private Mode: pause all tracking temporarily (15min to 8h)
• Blacklist: permanently exclude specific domains from stats
• Idle detection: configurable threshold (30s to 10min, or Off)
• Audible exemption: watching videos won't trigger false "idle" pauses

📌 SAVE FOR LATER
• Bookmark tabs to a sidebar checklist before closing
• Persisted across browser restarts

✨ CLOSE WITH STYLE
• Satisfying swoosh sound + confetti burst animation
• Pure Web Audio API — no audio files loaded

🔒 100% LOCAL & PRIVATE
• No server, no account, no external API calls
• All data stays in chrome.storage.local on your machine
• Zero dependencies, zero build tools
• Open source: https://github.com/dengduck/tabpus

⚙️ TECHNICAL
• Chrome Manifest V3, pure ES Modules
• Modular service worker architecture (10 independent modules)
• Survives SW restarts via chrome.alarms checkpoints
• No setInterval — all periodic tasks use chrome.alarms
```

---

## Category

**Productivity**

## Language

**English** (primary)

## Additional Fields

| Field | Value |
|-------|-------|
| Homepage URL | `https://github.com/dengduck/tabpus` |
| Support URL | `https://github.com/dengduck/tabpus/issues` |
| Privacy Policy | *(见下文建议)* |

---

## Privacy Policy 建议

Chrome Web Store 要求提供隐私政策 URL。由于 Tabpus 不收集任何数据，建议在 GitHub 仓库添加一个简单的 `PRIVACY.md`：

```markdown
# Privacy Policy — Tabpus

**Last updated: 2026-04-22**

Tabpus does not collect, transmit, or store any personal data on external servers.

All browsing data (tab groups, time tracking, saved tabs, settings) is stored
locally on your device using Chrome's `chrome.storage.local` API.

No analytics, no telemetry, no third-party services, no network requests.

Your data never leaves your machine.

## Permissions explained

| Permission | Why |
|-----------|-----|
| `tabs` | Read open tab URLs to group them by domain |
| `activeTab` | Detect which tab is currently focused for time tracking |
| `storage` | Save time logs, settings, and bookmarked tabs locally |
| `sessions` | Restore tab session data after browser restart |
| `alarms` | Schedule periodic time checkpoints and timer expiration |
| `idle` | Detect user inactivity to pause time tracking accurately |

## Contact

For questions, open an issue at https://github.com/dengduck/tabpus/issues
```

Privacy Policy URL 填写：`https://github.com/dengduck/tabpus/blob/rewrite-v2/PRIVACY.md`

---

## Screenshots 建议

Chrome Web Store 要求至少 1 张截图（1280×800 或 640×400）。建议准备：

1. **主界面** — 新标签页，展示 domain grid + 时间 badges
2. **History 视图** — 展示 Today/Week 时间统计 + heatmap
3. **Focus Timer** — 展示 header countdown widget
4. **Settings** — 展示 settings panel（idle 阈值、blacklist）
5. **关闭动画** — 展示 confetti + swoosh 效果（如果能截到的话）

截图可以用扩展加载后直接在 Chrome 中截（Cmd+Shift+4 或 Chrome DevTools 的 device toolbar 截图）。
