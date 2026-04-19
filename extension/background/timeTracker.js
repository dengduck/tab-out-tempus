/**
 * background/timeTracker.js
 * --------------------------
 * ✨ v2 的时间追踪核心模块。唯一能修改 `tabCumulativeMs` 的地方。
 *
 * 接口契约（冻结于 M0，见 ARCHITECTURE-v2.md §3.1 / DECISIONS-v2.md D9）：
 *
 *   === 事件入口（由 sw.js 路由调用） ===
 *   onFocusWindow(windowId)
 *   onActivateTab(tabId, windowId)
 *   onRemoveTab(tabId)
 *   onUpdateUrl(tabId, oldUrl, newUrl)
 *
 *   === 暂停/恢复控制 ===
 *   pause(reason: PauseReason)
 *   resume(reason: PauseReason)
 *   isPausedBy(reason: PauseReason): boolean
 *   getPauseReasons(): Array<PauseReason>
 *
 *   === 纯读接口（给 UI 用） ===
 *   getTabCumulativeMs(tabId): number
 *   getActiveRunningMs(): number
 *   getTodayTotalMs(): number
 *   getHostnameTotalMsForOpenTabs(hostname): number
 *   getTrackingState(): TrackingState
 *
 *   === 周期性行为 ===
 *   tick()
 *   init()
 *
 * 铁律：
 *   - tabCumulativeMs 只允许 +=，禁止赋值、禁止减少
 *   - pauseReasons 非空时绝不开新 slice
 *   - 外部模块不准直接改内部 Map
 *
 * 实现里程碑：M4（核心难点，预计 2-3 晚）。
 */

/** @typedef {import('../shared/types.js').PauseReason} PauseReason */
/** @typedef {import('../shared/types.js').TrackingState} TrackingState */

// TODO(M4): 实现
export function init() { /* stub */ }
export function tick() { /* stub */ }

export function onFocusWindow(_windowId) { /* stub */ }
export function onActivateTab(_tabId, _windowId) { /* stub */ }
export function onRemoveTab(_tabId) { /* stub */ }
export function onUpdateUrl(_tabId, _oldUrl, _newUrl) { /* stub */ }

export function pause(_reason) { /* stub */ }
export function resume(_reason) { /* stub */ }
export function isPausedBy(_reason) { return false; }
export function getPauseReasons() { return []; }

export function getTabCumulativeMs(_tabId) { return 0; }
export function getActiveRunningMs() { return 0; }
export function getTodayTotalMs() { return 0; }
export function getHostnameTotalMsForOpenTabs(_hostname) { return 0; }
export function getTrackingState() {
  return { isActive: false, activeTabId: null, pauseReasons: [], sliceStart: null };
}
