/**
 * background/sw.js
 * -----------------
 * Service Worker 入口。
 *
 * 职责：
 *   1. 监听 chrome.* 事件并**路由**到具体业务模块。本文件自己不写业务逻辑。
 *   2. 维护 UI 连接状态（hasActiveUIPort），决定是否广播 BCAST_TICK。
 *   3. 启动时按正确顺序调用各模块 init()（顶层 import + onInstalled + onStartup 三入口）。
 *
 * 当前阶段：M4（TimeTracker + focusModel + idleGuard + alarms 全部接入）。
 */

import { MSG, classify } from '../shared/messages.js';
import { LOG_PREFIX, TICK_INTERVAL_MS } from '../shared/constants.js';
import { getHostname } from '../shared/hostname.js';
import * as tabRegistry from './tabRegistry.js';
import * as timeTracker from './timeTracker.js';
import * as focusModel from './focusModel.js';
import * as idleGuard from './idleGuard.js';
import * as alarms from './alarms.js';
import { getRange } from './timeLog.js';

// ========== UI 连接状态 ==========

let hasActiveUIPort = false;
let tickIntervalId = null;

// ========== 广播 ==========

function broadcast(type, payload) {
  if (!hasActiveUIPort) return;
  try {
    chrome.runtime.sendMessage({ type, payload }).catch(() => { /* no receivers */ });
  } catch (_) { /* ignore */ }
}

function startTickBroadcast() {
  if (tickIntervalId !== null) return;
  // setInterval 在 SW 活跃期间有效；SW 睡了会停，但没 UI 的时候本来就不需要广播。
  // UI 存在 = 必有 port 在通讯 = SW 不会睡。
  tickIntervalId = setInterval(async () => {
    if (!hasActiveUIPort) return;
    const state = timeTracker.getTrackingState();
    const todayMs = await timeTracker.getTodayTotalMs();
    const activeTabMs = state.activeTabId !== null
      ? timeTracker.getTabCumulativeMs(state.activeTabId)
      : 0;
    broadcast(MSG.BCAST_TICK, {
      now: Date.now(),
      todayMs,
      activeTabId: state.activeTabId,
      activeTabMs,
    });
  }, TICK_INTERVAL_MS);
}

function stopTickBroadcast() {
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

// ========== Bootstrap ==========

let bootstrapped = false;
let bootstrapPromise = null;

async function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    if (bootstrapped) return;
    bootstrapped = true;
    console.log(LOG_PREFIX, 'SW bootstrap v2.0.0 M4');

    // 1. tabRegistry（需要先有它，timeTracker 靠它查 hostname）
    await tabRegistry.init({ emit: broadcast });

    // 2. timeTracker（尚未注册 chrome 事件，只做内部状态恢复）
    await timeTracker.init({ emit: broadcast });

    // 3. tab 事件路由到 timeTracker（tabRegistry 自己的 listener 负责 UI 广播，这里是另一套）
    //    用独立 listener 避免给 tabRegistry 增加计时职责。
    registerTabEventsForTracker();

    // 4. focusModel（会调 timeTracker.onFocusWindow + onActivateTab 补齐初始焦点）
    await focusModel.init();

    // 5. idleGuard
    idleGuard.init();

    // 6. alarms（最后启动 tick）
    alarms.init();
  })();
  return bootstrapPromise;
}

function registerTabEventsForTracker() {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    timeTracker.onActivateTab(activeInfo.tabId, activeInfo.windowId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    timeTracker.onRemoveTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      // 取"之前的 url"需要额外缓存；简化：让 timeTracker 自己比较 old/new hostname
      // 这里拿不到 oldUrl，传 '' 走，onUpdateUrl 内部看到 hostname 变了就 finalize+start
      timeTracker.onUpdateUrl(tabId, '', changeInfo.url);
    }
  });
}

// 三入口覆盖冷启动 + 事件唤醒 + 模块加载
chrome.runtime.onInstalled.addListener(() => { bootstrap(); });
chrome.runtime.onStartup.addListener(() => { bootstrap(); });
bootstrap();

// ========== 消息路由 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const kind = classify(message?.type);
  if (kind !== 'req') return false;

  handleRequest(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      console.error(LOG_PREFIX, 'handler error', message?.type, err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });

  return true;  // MV3 异步响应必须返回 true
});

async function handleRequest(message, _sender) {
  // 确保 bootstrap 完成（某些 REQ 在 SW 冷启动的瞬间可能先于 bootstrap 触发）
  await bootstrap();

  switch (message.type) {
    case MSG.REQ_UI_READY:
      hasActiveUIPort = true;
      startTickBroadcast();
      return { ok: true };

    case MSG.REQ_UI_GONE:
      hasActiveUIPort = false;
      stopTickBroadcast();
      return { ok: true };

    case MSG.REQ_GET_STATE:
      return {
        tracking: timeTracker.getTrackingState(),
        privateMode: null,        // M8 再接
        focusTimer: null,         // M8 再接
        blacklist: [],            // M8 再接
      };

    case MSG.REQ_GET_TABS:
      return { tabs: tabRegistry.getAll() };

    case MSG.REQ_CLOSE_TAB: {
      const tabId = message.tabId;
      if (typeof tabId !== 'number') throw new Error('invalid tabId');
      await chrome.tabs.remove(tabId);
      return { closed: tabId };
    }

    case MSG.REQ_GET_TAB_TIME: {
      const tabId = message.tabId;
      if (typeof tabId !== 'number') throw new Error('invalid tabId');
      const cumulativeMs = timeTracker.getTabCumulativeMs(tabId);
      const state = timeTracker.getTrackingState();
      return { cumulativeMs, isActive: state.activeTabId === tabId };
    }

    case MSG.REQ_GET_TAB_TIMES: {
      // 批量：允许 tabIds 省略（= 全部已知 tab）
      const ids = Array.isArray(message.tabIds) ? message.tabIds : null;
      const state = timeTracker.getTrackingState();
      const result = {};
      if (ids) {
        for (const id of ids) {
          if (typeof id !== 'number') continue;
          result[id] = timeTracker.getTabCumulativeMs(id);
        }
      } else {
        // 全量：遍历 tabRegistry
        for (const t of tabRegistry.getAll()) {
          result[t.id] = timeTracker.getTabCumulativeMs(t.id);
        }
      }
      return { tabTimes: result, activeTabId: state.activeTabId };
    }

    case MSG.REQ_GET_TODAY_WORK: {
      const totalMs = await timeTracker.getTodayTotalMs();
      // breakdown 留给 historyView 请求自己拿；这里返回总数即可
      return { totalMs };
    }

    case MSG.REQ_GET_HISTORY: {
      const { start, end } = message;
      if (typeof start !== 'number' || typeof end !== 'number') throw new Error('invalid range');
      const slices = await getRange(start, end);
      return { slices };
    }

    default:
      throw new Error(`not_implemented: ${message.type}`);
  }
}

// 辅助：过滤用（UI 端若需要 hostname 也走 shared）
export { getHostname };
