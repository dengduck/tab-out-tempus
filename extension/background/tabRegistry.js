/**
 * background/tabRegistry.js
 * --------------------------
 * tabId ↔ TabInfo 元数据维护。**纯事实登记，不碰时间**。
 *
 * 职责：
 *   - 启动时 chrome.tabs.query({}) 把所有 open tab 灌进内存 map
 *   - 订阅 onCreated / onUpdated / onRemoved / onActivated 维护增量
 *   - 每次变更通过注入的 emitter 广播 BCAST_TAB_CHANGE（UI 订阅）
 *
 * 里程碑：M2。
 *
 * **注意**：本模块不调用 chrome.runtime.sendMessage（SW 主动广播用 sendMessage(undefined)
 * 会弹错 "no receivers"）。改为：由 sw.js 在装载时注入一个 emit 回调，本模块只管调用它。
 */

import { LOG_PREFIX } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';

/** @typedef {import('../shared/types.js').TabInfo} TabInfo */

/** @type {Map<number, TabInfo>} */
const tabs = new Map();

/** @type {((msgType: string, payload: any) => void) | null} */
let emit = null;

let initialized = false;

function toInfo(tab) {
  return {
    id: tab.id,
    url: tab.url || tab.pendingUrl || '',
    title: tab.title || '',
    favIconUrl: tab.favIconUrl || '',
    windowId: tab.windowId,
    firstSeen: Date.now(),
  };
}

function broadcast(action, tabInfo) {
  if (typeof emit === 'function') {
    try {
      emit(MSG.BCAST_TAB_CHANGE, { action, tabInfo });
    } catch (err) {
      console.error(LOG_PREFIX, 'tabRegistry broadcast failed', err);
    }
  }
}

/**
 * 模块初始化。
 * @param {{emit: (type: string, payload: any) => void}} deps
 */
export async function init(deps = {}) {
  if (initialized) return;
  emit = deps.emit || null;
  const all = await chrome.tabs.query({});
  tabs.clear();
  for (const tab of all) {
    if (typeof tab.id === 'number') tabs.set(tab.id, toInfo(tab));
  }
  initialized = true;
  console.log(LOG_PREFIX, 'tabRegistry init,', tabs.size, 'tabs');
}

export function onCreated(tab) {
  if (typeof tab?.id !== 'number') return;
  const info = toInfo(tab);
  tabs.set(tab.id, info);
  broadcast('added', info);
}

export function onUpdated(tabId, changeInfo, tab) {
  if (!tabs.has(tabId)) {
    if (typeof tab?.id === 'number') onCreated(tab);
    return;
  }
  const prev = tabs.get(tabId);
  const next = {
    ...prev,
    url: changeInfo.url || tab?.url || prev.url,
    title: changeInfo.title || tab?.title || prev.title,
    favIconUrl: changeInfo.favIconUrl || tab?.favIconUrl || prev.favIconUrl,
    windowId: tab?.windowId ?? prev.windowId,
  };
  if (next.url === prev.url && next.title === prev.title
    && next.favIconUrl === prev.favIconUrl && next.windowId === prev.windowId) return;
  tabs.set(tabId, next);
  broadcast('updated', next);
}

export function onRemoved(tabId) {
  const prev = tabs.get(tabId);
  if (!prev) return;
  tabs.delete(tabId);
  broadcast('removed', prev);
}

export function onAttached(tabId, attachInfo) {
  const prev = tabs.get(tabId);
  if (!prev) return;
  const next = { ...prev, windowId: attachInfo.newWindowId };
  tabs.set(tabId, next);
  broadcast('moved', next);
}

export function get(tabId) {
  return tabs.get(tabId) || null;
}

export function getAll() {
  return Array.from(tabs.values());
}

export function has(tabId) {
  return tabs.has(tabId);
}
