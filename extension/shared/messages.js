/**
 * shared/messages.js
 * -------------------
 * UI ↔ SW 所有消息类型集中定义。冻结于 M0（见 ARCHITECTURE-v2.md §5 / DECISIONS-v2.md D10）。
 *
 * 两类前缀：
 *   REQ_*   —— 请求式：UI 主动发，SW sendResponse 回复（一次性查询）
 *   BCAST_* —— 订阅式：SW 主动广播，UI 通过 chrome.runtime.onMessage 接收
 *
 * 新增消息类型必须：
 *   1. 用正确前缀
 *   2. 在对应 handler 里实现 payload/response 契约（见本文件下方注释）
 *   3. 文档 ARCHITECTURE-v2.md §5 同步更新
 */

export const MSG = Object.freeze({
  // ===== 请求式 REQ_* =====
  REQ_GET_TABS:           'REQ_GET_TABS',
  REQ_CLOSE_TAB:          'REQ_CLOSE_TAB',
  REQ_GET_TODAY_WORK:     'REQ_GET_TODAY_WORK',
  REQ_GET_TAB_TIME:       'REQ_GET_TAB_TIME',
  REQ_GET_TAB_TIMES:      'REQ_GET_TAB_TIMES',
  REQ_GET_HISTORY:        'REQ_GET_HISTORY',
  REQ_SAVE_FOR_LATER:     'REQ_SAVE_FOR_LATER',
  REQ_GET_SAVED:          'REQ_GET_SAVED',
  REQ_REMOVE_SAVED:       'REQ_REMOVE_SAVED',
  REQ_START_FOCUS_TIMER:  'REQ_START_FOCUS_TIMER',
  REQ_STOP_FOCUS_TIMER:   'REQ_STOP_FOCUS_TIMER',
  REQ_START_PRIVATE_MODE: 'REQ_START_PRIVATE_MODE',
  REQ_STOP_PRIVATE_MODE:  'REQ_STOP_PRIVATE_MODE',
  REQ_GET_STATE:          'REQ_GET_STATE',
  REQ_BLACKLIST_ADD:      'REQ_BLACKLIST_ADD',
  REQ_BLACKLIST_REMOVE:   'REQ_BLACKLIST_REMOVE',
  REQ_SET_IDLE_THRESHOLD: 'REQ_SET_IDLE_THRESHOLD',
  REQ_GET_IDLE_THRESHOLD: 'REQ_GET_IDLE_THRESHOLD',

  // UI 生命周期通知（让 SW 决定要不要广播 TICK）
  REQ_UI_READY:           'REQ_UI_READY',
  REQ_UI_GONE:            'REQ_UI_GONE',

  // ===== 订阅式 BCAST_* =====
  BCAST_TICK:         'BCAST_TICK',           // {now, todayMs, activeTabId, activeTabMs}
  BCAST_TAB_CHANGE:   'BCAST_TAB_CHANGE',     // {action: 'added'|'removed'|'updated'|'moved', tabInfo}
  BCAST_STATE_CHANGE: 'BCAST_STATE_CHANGE',   // {pauseReasons, privateMode, focusTimer}
});

/**
 * 判断消息类型是请求还是广播。
 * @param {string} type
 * @returns {'req'|'bcast'|'unknown'}
 */
export function classify(type) {
  if (typeof type !== 'string') return 'unknown';
  if (type.startsWith('REQ_')) return 'req';
  if (type.startsWith('BCAST_')) return 'bcast';
  return 'unknown';
}

/**
 * 统一的响应包装。所有 REQ_* handler 应通过 sendResponse 返回这个形状。
 * @typedef {{ok: true, data: any} | {ok: false, error: string}} Response
 */
