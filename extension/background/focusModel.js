/**
 * background/focusModel.js
 * -------------------------
 * 封装 chrome.windows.onFocusChanged，作为"当前该给谁计时"的**单一真相源**。
 *
 * 职责：
 *   - 维护 focusedWindowId（内存）；WINDOW_ID_NONE → null（Chrome 失焦）
 *   - 状态变化时调 timeTracker.pause('window-blur') / resume('window-blur')
 *   - 启动时从 chrome.windows.getLastFocused() 恢复状态
 *
 * 里程碑：M4（随 TimeTracker 一起实现）。
 */

export function init() { /* stub, M4 */ }
export function getFocusedWindowId() { return null; }
