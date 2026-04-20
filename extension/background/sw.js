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
 * 当前阶段：M8（Focus Timer + Blacklist + Private Mode）。
 */

import { MSG, classify } from '../shared/messages.js';
import { LOG_PREFIX, TICK_INTERVAL_MS, STORAGE_KEY } from '../shared/constants.js';
import { getHostname } from '../shared/hostname.js';
import * as tabRegistry from './tabRegistry.js';
import * as timeTracker from './timeTracker.js';
import * as focusModel from './focusModel.js';
import * as idleGuard from './idleGuard.js';
import * as alarms from './alarms.js';
import * as privateMode from './privateMode.js';
import * as blacklist from './blacklist.js';
import * as focusTimer from './focusTimer.js';
import { getRange } from './timeLog.js';
import { localGet, localSet } from './store.js';

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
  tickIntervalId = setInterval(() => {
    if (!hasActiveUIPort) return;
    const state = timeTracker.getTrackingState();
    const todayMs = timeTracker.getTodayTotalMs();
    const activeTabMs = state.activeTabId !== null
      ? timeTracker.getTabCumulativeMs(state.activeTabId)
      : 0;
    broadcast(MSG.BCAST_TICK, {
      now: Date.now(),
      todayMs,
      activeTabId: state.activeTabId,
      activeTabMs,
      isActive: state.isActive,  // M8: 直接告诉 UI 是否在计时
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
    console.log(LOG_PREFIX, 'SW bootstrap v2.0.0 M8');

    // 1. tabRegistry（需要先有它，timeTracker 靠它查 hostname）
    await tabRegistry.init({ emit: broadcast });

    // 2. timeTracker（尚未注册 chrome 事件，只做内部状态恢复）
    await timeTracker.init({ emit: broadcast });

    // 3. tab 事件路由到 timeTracker（tabRegistry 自己的 listener 负责 UI 广播，这里是另一套）
    //    用独立 listener 避免给 tabRegistry 增加计时职责。
    registerTabEventsForTracker();

    // 4. focusModel（会调 timeTracker.onFocusWindow + onActivateTab 补齐初始焦点）
    await focusModel.init();

    // 5. idleGuard (D20: async — reads user config for idle threshold)
    await idleGuard.init();

    // 6. M8 模块（依赖 timeTracker 已 init）
    await privateMode.init({ emit: broadcast });
    await blacklist.init({ emit: broadcast });
    await focusTimer.init({ emit: broadcast });

    // 7. alarms（最后启动 tick）
    alarms.init();
  })();
  return bootstrapPromise;
}

function registerTabEventsForTracker() {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    timeTracker.onActivateTab(activeInfo.tabId, activeInfo.windowId);
    // M8: 切 tab 后检查黑名单
    blacklist.checkTab(activeInfo.tabId);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    timeTracker.onRemoveTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      timeTracker.onUpdateUrl(tabId, '', changeInfo.url);
      // M8: URL 变了也重新检查黑名单
      blacklist.checkTab(tabId);
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
        privateMode: privateMode.getStatus(),
        focusTimer: focusTimer.getStatus(),
        blacklist: blacklist.getList(),
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
      const totalMs = timeTracker.getTodayTotalMs();
      // breakdown 留给 historyView 请求自己拿；这里返回总数即可
      return { totalMs };
    }

    case MSG.REQ_GET_HISTORY: {
      const { start, end } = message;
      if (typeof start !== 'number' || typeof end !== 'number') throw new Error('invalid range');
      const slices = await getRange(start, end);
      return { slices };
    }

    // ===== M7: Save for Later =====

    case MSG.REQ_SAVE_FOR_LATER: {
      const tabId = message.tabId;
      if (typeof tabId !== 'number') throw new Error('invalid tabId');
      const tab = tabRegistry.get(tabId);
      if (!tab) throw new Error('tab not found');
      const entry = {
        id: `${Date.now()}-${tabId}`,
        url: tab.url,
        title: tab.title || tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        savedAt: Date.now(),
      };
      const saved = (await localGet(STORAGE_KEY.SAVED)) || [];
      saved.push(entry);
      await localSet(STORAGE_KEY.SAVED, saved);
      return { entry };
    }

    case MSG.REQ_GET_SAVED: {
      const saved = (await localGet(STORAGE_KEY.SAVED)) || [];
      return { saved };
    }

    case MSG.REQ_REMOVE_SAVED: {
      const entryId = message.id;
      if (!entryId) throw new Error('invalid id');
      const saved = (await localGet(STORAGE_KEY.SAVED)) || [];
      const filtered = saved.filter((e) => e.id !== entryId);
      await localSet(STORAGE_KEY.SAVED, filtered);
      return { removed: entryId };
    }

    // ===== M8: Private Mode =====

    case MSG.REQ_START_PRIVATE_MODE: {
      const durationMin = message.durationMin;
      if (typeof durationMin !== 'number' || durationMin <= 0) throw new Error('invalid durationMin');
      return await privateMode.start(durationMin);
    }

    case MSG.REQ_STOP_PRIVATE_MODE: {
      await privateMode.stop();
      return { stopped: true };
    }

    // ===== M8: Focus Timer =====

    case MSG.REQ_START_FOCUS_TIMER: {
      const durationMin = message.durationMin;
      if (typeof durationMin !== 'number' || durationMin <= 0) throw new Error('invalid durationMin');
      const opts = {};
      if (typeof message.strict === 'boolean') opts.strict = message.strict;
      if (Array.isArray(message.allowedHosts)) opts.allowedHosts = message.allowedHosts;
      return await focusTimer.start(durationMin, opts);
    }

    case MSG.REQ_STOP_FOCUS_TIMER: {
      await focusTimer.stop();
      return { stopped: true };
    }

    // ===== M8: Blacklist =====

    case MSG.REQ_BLACKLIST_ADD: {
      const hostname = message.hostname;
      if (typeof hostname !== 'string' || !hostname) throw new Error('invalid hostname');
      await blacklist.add(hostname);
      return { added: hostname, list: blacklist.getList() };
    }

    case MSG.REQ_BLACKLIST_REMOVE: {
      const hostname = message.hostname;
      if (typeof hostname !== 'string' || !hostname) throw new Error('invalid hostname');
      await blacklist.remove(hostname);
      return { removed: hostname, list: blacklist.getList() };
    }

    default:
      throw new Error(`not_implemented: ${message.type}`);
  }
}

// 辅助：过滤用（UI 端若需要 hostname 也走 shared）
export { getHostname };
