/**
 * background/privateMode.js
 * --------------------------
 * 隐私计时窗口：用户启动后指定分钟数内暂停计时（不写入 timeLog）。
 *
 * 接口：
 *   start(durationMin)      → pause('private-mode'), 注册到期 alarm
 *   stop()                  → resume('private-mode'), 清 storage
 *   getStatus()             → {active, endTime, remainingMs} | null
 *   init()                  → SW 启动时恢复（若未过期续注册 alarm）
 *
 * 存储：chrome.storage.local['privateMode'] = {endTime: number} | null
 *
 * 里程碑：M8（Focus Timer + 黑名单 + Private Mode 同批）。
 * 参考：docs/v1-feature-reference/private-mode.md
 */

export function init() { /* stub, M8 */ }
export async function start(_durationMin) { /* stub */ }
export async function stop() { /* stub */ }
export async function getStatus() { return null; }
