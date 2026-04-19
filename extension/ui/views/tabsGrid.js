/**
 * ui/views/tabsGrid.js
 * ---------------------
 * 域名分组的 tab 网格（主视图）。
 *
 * 接口（契约）：
 *   render(tabs)                   —— 首次渲染
 *   applyChange(action, tabInfo)   —— 增量 diff 更新（禁止整页重绘）
 *   updateActiveTabBadge(id, ms)   —— BCAST_TICK 带动 chip badge
 *
 * 里程碑：M2。
 */

export function render(_tabs) { /* stub, M2 */ }
export function applyChange(_action, _tabInfo) { /* stub */ }
export function updateActiveTabBadge(_tabId, _ms) { /* stub, M5 */ }
