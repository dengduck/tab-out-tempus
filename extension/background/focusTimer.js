/**
 * background/focusTimer.js
 * -------------------------
 * 番茄钟。strict=true 模式下，期间对非白名单 hostname 自动 pause('blacklist')。
 *
 * 存储：chrome.storage.local['focusTimer'] = {startTime, durationMs, strict} | null
 *
 * 里程碑：M8。
 */

export function init() { /* stub, M8 */ }
export async function start(_durationMin, _opts = {}) { /* stub */ }
export async function stop() { /* stub */ }
export async function getStatus() { return null; }
