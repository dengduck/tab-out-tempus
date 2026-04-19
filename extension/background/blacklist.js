/**
 * background/blacklist.js
 * ------------------------
 * 域名黑名单：切到黑名单 hostname → timeTracker.pause('blacklist')。
 *
 * 存储：chrome.storage.local['blacklist'] = string[]  （hostname 列表）
 *
 * 里程碑：M8。
 */

export function init() { /* stub, M8 */ }
export async function getList() { return []; }
export async function add(_hostname) { /* stub */ }
export async function remove(_hostname) { /* stub */ }
export async function isBlocked(_hostname) { return false; }
