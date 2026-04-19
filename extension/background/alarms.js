/**
 * background/alarms.js
 * ---------------------
 * chrome.alarms 统一管理。
 *
 * 用途：
 *   - 30s 周期 tick → timeTracker.tick()（刷 snapshot、finalize 老 slice）
 *   - Private Mode 到期一次性 alarm
 *   - Focus Timer 到期一次性 alarm
 *
 * 铁律：永远不用 setInterval，SW 休眠会停。
 *
 * 里程碑：M4。
 */

export function init() { /* stub, M4 */ }
