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

/** @typedef {{id:number,url:string,title:string,favIconUrl:string,windowId:number,firstSeen:number}} TabInfo */

/** @type {Map<number, TabInfo>} */
const tabs = new Map();

/** @type {((msgType: string, payload: any) => void) | null} */
let emit = null;

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
  emit = deps.emit || null;

  // 初次灌满 map
  try {
    const all = await chrome.tabs.query({});
    tabs.clear();
    for (const t of all) {
      if (typeof t.id === 'number') tabs.set(t.id, toInfo(t));
    }
    console.log(LOG_PREFIX, 'tabRegistry init,', tabs.size, 'tabs');
  } catch (err) {
    console.error(LOG_PREFIX, 'tabRegistry init query failed', err);
  }

  // 事件监听。SW 重启后这些 listener 会重注册（顶层 import 再跑一遍 init）
  chrome.tabs.onCreated.addListener((tab) => {
    if (typeof tab.id !== 'number') return;
    const info = toInfo(tab);
    tabs.set(tab.id, info);
    broadcast('added', info);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tabs.has(tabId)) {
      // 第一次见这个 tab（SW 冷启动期间创建的）
      if (typeof tab?.id === 'number') {
        const info = toInfo(tab);
        tabs.set(tabId, info);
        broadcast('added', info);
        return;
      }
      return;
    }
    const prev = tabs.get(tabId);
    // 只处理我们关心的字段变化
    const next = {
      ...prev,
      url: changeInfo.url || tab?.url || prev.url,
      title: changeInfo.title || tab?.title || prev.title,
      favIconUrl: changeInfo.favIconUrl || tab?.favIconUrl || prev.favIconUrl,
      windowId: tab?.windowId ?? prev.windowId,
    };
    const changed =
      next.url !== prev.url ||
      next.title !== prev.title ||
      next.favIconUrl !== prev.favIconUrl ||
      next.windowId !== prev.windowId;
    if (!changed) return;
    tabs.set(tabId, next);
    broadcast('updated', next);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const prev = tabs.get(tabId);
    if (!prev) return;
    tabs.delete(tabId);
    broadcast('removed', prev);
  });

  // windowId 变化通过 onUpdated 捕获；onAttached 额外补一刀
  chrome.tabs.onAttached?.addListener?.((tabId, attachInfo) => {
    const prev = tabs.get(tabId);
    if (!prev) return;
    const next = { ...prev, windowId: attachInfo.newWindowId };
    tabs.set(tabId, next);
    broadcast('moved', next);
  });

  // onActivated 不改元数据，但 M5+ 要拿来切换活跃计时。M2 先不处理。
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
