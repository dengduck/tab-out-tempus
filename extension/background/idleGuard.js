/**
 * background/idleGuard.js
 * ------------------------
 * chrome.idle 键鼠空闲守护。60s 无键鼠输入 → timeTracker.pause('idle')。
 *
 * 策略：
 *   - chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SEC)
 *   - onStateChanged: 'idle'/'locked' → pause；'active' → resume
 *
 * 里程碑：M4（和 TimeTracker 同批，是其 pause source 之一）。
 */

export function init() { /* stub, M4 */ }
export function isIdle() { return false; }
