/**
 * ui/messaging.js
 * ----------------
 * UI 端与 SW 通信的封装。所有 chrome.runtime.sendMessage 调用都走这里。
 *
 * 契约：ARCHITECTURE-v2.md §3.9 / §5 / DECISIONS-v2.md D10。
 *
 * 请求式 API：返回 Promise<data>，失败抛 Error
 * 订阅式 API：返回 unsubscribe 函数
 *
 * **M1 只实现：notifyUIReady / notifyUIGone / getState**。
 * 其余 API 在对应 M 里填。
 */

import { MSG } from '../shared/messages.js';
import { LOG_PREFIX } from '../shared/constants.js';

// ========== 请求式通用封装 ==========

/**
 * 发送一条 REQ_* 消息，返回 response.data 或抛错。
 * @param {string} type
 * @param {object} [payload]
 */
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response) throw new Error(`no response from SW for ${type}`);
  if (!response.ok) throw new Error(response.error || `SW returned error for ${type}`);
  return response.data;
}

// ========== M1 已实现的请求 ==========

export function notifyUIReady() {
  return request(MSG.REQ_UI_READY);
}

export function notifyUIGone() {
  return request(MSG.REQ_UI_GONE);
}

/** @returns {Promise<import('../shared/types.js').GlobalState>} */
export function getState() {
  return request(MSG.REQ_GET_STATE);
}

// ========== M2+ 待实现的请求（签名先定，body 抛 not_implemented） ==========

export function getTabs()            { return request(MSG.REQ_GET_TABS); }
export function closeTab(tabId)      { return request(MSG.REQ_CLOSE_TAB, { tabId }); }
export function getTodayWork()       { return request(MSG.REQ_GET_TODAY_WORK); }
export function getTabTime(tabId)    { return request(MSG.REQ_GET_TAB_TIME, { tabId }); }
export function getTabTimes(tabIds)  { return request(MSG.REQ_GET_TAB_TIMES, { tabIds }); }
export function getHistoryRange(start, end) {
  return request(MSG.REQ_GET_HISTORY, { start, end });
}
export function saveForLater(tabId)  { return request(MSG.REQ_SAVE_FOR_LATER, { tabId }); }
export function getSaved()           { return request(MSG.REQ_GET_SAVED); }
export function removeSaved(id)      { return request(MSG.REQ_REMOVE_SAVED, { id }); }
export function startFocusTimer(durationMin, opts = {}) {
  return request(MSG.REQ_START_FOCUS_TIMER, { durationMin, ...opts });
}
export function stopFocusTimer()     { return request(MSG.REQ_STOP_FOCUS_TIMER); }
export function startPrivateMode(durationMin) {
  return request(MSG.REQ_START_PRIVATE_MODE, { durationMin });
}
export function stopPrivateMode()    { return request(MSG.REQ_STOP_PRIVATE_MODE); }
export function blacklistAdd(hostname)    { return request(MSG.REQ_BLACKLIST_ADD, { hostname }); }
export function blacklistRemove(hostname) { return request(MSG.REQ_BLACKLIST_REMOVE, { hostname }); }
export function getIdleThreshold()        { return request(MSG.REQ_GET_IDLE_THRESHOLD); }
export function setIdleThreshold(threshold) { return request(MSG.REQ_SET_IDLE_THRESHOLD, { threshold }); }

// ========== 订阅式（M4+ 启用） ==========

/**
 * 订阅 BCAST_* 广播，返回 unsubscribe 函数。
 * @param {string} msgType
 * @param {(payload: any) => void} cb
 */
function subscribe(msgType, cb) {
  const listener = (message) => {
    if (message?.type === msgType) {
      try {
        cb(message.payload);
      } catch (err) {
        console.error(LOG_PREFIX, 'subscribe callback error', msgType, err);
      }
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function subscribeTick(cb)        { return subscribe(MSG.BCAST_TICK, cb); }
export function subscribeTabChange(cb)   { return subscribe(MSG.BCAST_TAB_CHANGE, cb); }
export function subscribeStateChange(cb) { return subscribe(MSG.BCAST_STATE_CHANGE, cb); }
