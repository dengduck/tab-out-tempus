/**
 * background/tabRegistry.js
 * --------------------------
 * tabId ↔ {url, hostname, title, favIconUrl, windowId, firstSeen} 元数据维护。
 * 纯事实登记，不碰时间。
 *
 * 里程碑：M2（tab 分组需要这里的数据）。
 */

/** @typedef {import('../shared/types.js').TabInfo} TabInfo */

export function init() { /* stub, M2 */ }
export function record(_tabId, _info) { /* stub */ }
export function remove(_tabId) { /* stub */ }
export function get(_tabId) { return null; }
export function getAll() { return []; }
export function getByHostname(_hostname) { return []; }
