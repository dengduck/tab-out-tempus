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
