/**
 * ui/messaging.js
 * ----------------
 * UI 端与 SW 通信封装：REQ_* 走 sendMessage，BCAST_* 走 runtime Port。
 * Port 断线自动重连，页面关闭时由 Chrome 自动触发 onDisconnect。
 * 契约：ARCHITECTURE-v2.md §3.9 / §5 / DECISIONS-v2.md D10。
 * 请求式 API 返回 Promise<data>；订阅式 API 返回 unsubscribe。
 */

import { MSG } from '../shared/messages.js';
import { LOG_PREFIX } from '../shared/constants.js';

// ========== 请求式通用封装 ==========

/** SW 未就绪重试：次数与每次退避（ms）。P1-14。 */
const SW_RETRY_DELAYS = [120, 300];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 单次发送，区分两类失败：
 *   - SW 冷启动（response 为空 / "Could not establish connection" / "message port closed"）→ 可重试
 *   - SW 明确返回 { ok:false } 业务错误 → 不重试，直接抛
 * @returns {{data:any}} 成功时返回 { data }；可重试失败抛带 `retryable=true` 的 Error
 */
async function sendOnce(type, payload) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    // sendMessage 在 SW 未就绪时会 reject（lastError）——标记为可重试
    const e = new Error(err?.message || `sendMessage failed for ${type}`);
    e.retryable = true;
    throw e;
  }
  if (!response) {
    const e = new Error(`no response from SW for ${type}`);
    e.retryable = true;
    throw e;
  }
  if (!response.ok) {
    // 业务错误，不重试
    throw new Error(response.error || `SW returned error for ${type}`);
  }
  return { data: response.data };
}

/**
 * 发送一条 REQ_* 消息，返回 response.data 或抛错。
 * P1-14：SW 冷启动时自动重试（短退避），业务错误不重试。
 * @param {string} type
 * @param {object} [payload]
 */
async function request(type, payload = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= SW_RETRY_DELAYS.length; attempt++) {
    try {
      const { data } = await sendOnce(type, payload);
      return data;
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === SW_RETRY_DELAYS.length) throw err;
      await sleep(SW_RETRY_DELAYS[attempt]);
    }
  }
  throw lastErr;
}

// ========== UI Port 生命周期 ==========

const subscribers = new Map();
const reconnectSubscribers = new Set();
let connectedOnce = false;
let uiPort = null;
let reconnectEnabled = false;
let reconnectTimer = null;
let heartbeatTimer = null;

function dispatchBroadcast(message) {
  const callbacks = subscribers.get(message?.type);
  if (!callbacks) return;
  for (const cb of callbacks) {
    try { cb(message.payload); }
    catch (err) { console.error(LOG_PREFIX, 'subscribe callback error', message.type, err); }
  }
}

function connectUIPort() {
  if (uiPort) return;
  try {
    const port = chrome.runtime.connect({ name: 'tempus-ui' });
    const isReconnect = connectedOnce;
    connectedOnce = true;
    uiPort = port;
    port.onMessage.addListener(dispatchBroadcast);
    if (isReconnect) {
      queueMicrotask(() => {
        for (const cb of reconnectSubscribers) {
          try { cb(); } catch (err) { console.error(LOG_PREFIX, 'reconnect callback failed', err); }
        }
      });
    }
    heartbeatTimer = setInterval(() => {
      try { port.postMessage({ type: 'UI_HEARTBEAT' }); } catch (_) { /* reconnect handles it */ }
    }, 20_000);
    port.onDisconnect.addListener(() => {
      if (uiPort === port) uiPort = null;
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (reconnectEnabled && reconnectTimer === null) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectUIPort();
        }, 250);
      }
    });
  } catch (err) {
    console.warn(LOG_PREFIX, 'UI port connect failed', err);
    if (reconnectEnabled && reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectUIPort();
      }, 250);
    }
  }
}

export async function notifyUIReady() {
  reconnectEnabled = true;
  connectUIPort();
  return { connected: uiPort !== null };
}

export async function notifyUIGone() {
  reconnectEnabled = false;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  uiPort?.disconnect();
  uiPort = null;
  return { disconnected: true };
}

/** @returns {Promise<import('../shared/types.js').GlobalState>} */
export function getState() {
  return request(MSG.REQ_GET_STATE);
}

// ========== M2+ 待实现的请求（签名先定，body 抛 not_implemented） ==========

export function getTabs()            { return request(MSG.REQ_GET_TABS); }
export function closeTab(tabId)      { return request(MSG.REQ_CLOSE_TAB, { tabId }); }
export function getTodayWork()       { return request(MSG.REQ_GET_TODAY_WORK); }
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
export function getConfig() { return request(MSG.REQ_GET_CONFIG); }
export function setTheme(theme) { return request(MSG.REQ_SET_THEME, { theme }); }
export function setRetention(days) { return request(MSG.REQ_SET_RETENTION, { days }); }
export function setFocusHosts(hosts) { return request(MSG.REQ_SET_FOCUS_HOSTS, { hosts }); }
export function setGroupMode(mode) { return request(MSG.REQ_SET_GROUP_MODE, { mode }); }
export function upsertCategory(category) { return request(MSG.REQ_UPSERT_CATEGORY, { category }); }
export function removeCategory(categoryId) { return request(MSG.REQ_REMOVE_CATEGORY, { categoryId }); }
export function setDomainCategory(hostname, categoryId) {
  return request(MSG.REQ_SET_DOMAIN_CATEGORY, { hostname, categoryId });
}
export function setDomainBudget(hostname, budgetMs) {
  return request(MSG.REQ_SET_DOMAIN_BUDGET, { hostname, budgetMs });
}
export function setDomainRule(hostname, categoryId, budgetMs) {
  return request(MSG.REQ_SET_DOMAIN_RULE, { hostname, categoryId, budgetMs });
}
export function upsertCustomGroup(group) { return request(MSG.REQ_UPSERT_CUSTOM_GROUP, { group }); }
export function removeCustomGroup(groupId) { return request(MSG.REQ_REMOVE_CUSTOM_GROUP, { groupId }); }
export function exportHistory(format) { return request(MSG.REQ_EXPORT_HISTORY, { format }); }
export function clearHistory() { return request(MSG.REQ_CLEAR_HISTORY); }

// ========== 订阅式（M4+ 启用） ==========

/**
 * 订阅 BCAST_* 广播，返回 unsubscribe 函数。
 * @param {string} msgType
 * @param {(payload: any) => void} cb
 */
function subscribe(msgType, cb) {
  let callbacks = subscribers.get(msgType);
  if (!callbacks) {
    callbacks = new Set();
    subscribers.set(msgType, callbacks);
  }
  callbacks.add(cb);
  return () => {
    callbacks.delete(cb);
    if (callbacks.size === 0) subscribers.delete(msgType);
  };
}

export function subscribeTick(cb)        { return subscribe(MSG.BCAST_TICK, cb); }
export function subscribeTabChange(cb)   { return subscribe(MSG.BCAST_TAB_CHANGE, cb); }
export function subscribeStateChange(cb) { return subscribe(MSG.BCAST_STATE_CHANGE, cb); }
export function subscribeConfigChange(cb) { return subscribe(MSG.BCAST_CONFIG_CHANGE, cb); }
export function subscribeSavedChange(cb) { return subscribe(MSG.BCAST_SAVED_CHANGE, cb); }
export function subscribeReconnect(cb) {
  reconnectSubscribers.add(cb);
  return () => reconnectSubscribers.delete(cb);
}
