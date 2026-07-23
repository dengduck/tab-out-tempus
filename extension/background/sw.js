/**
 * background/sw.js
 * -----------------
 * Service Worker 入口。
 *
 * 职责：
 *   1. 监听 chrome.* 事件并**路由**到具体业务模块。本文件自己不写业务逻辑。
 *   2. 维护真实 runtime Port 集合，只向活跃 UI 广播 BCAST_*。
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

const uiPorts = new Set();
let tickIntervalId = null;

// ========== 广播 ==========

function broadcast(type, payload) {
  for (const port of uiPorts) {
    try { port.postMessage({ type, payload }); }
    catch (_) { uiPorts.delete(port); }
  }
}

function startTickBroadcast() {
  if (tickIntervalId !== null) return;
  tickIntervalId = setInterval(() => {
    if (uiPorts.size === 0) return;
    const state = timeTracker.getTrackingState();
    const tabTimes = {};
    for (const tab of tabRegistry.getAll()) {
      tabTimes[tab.id] = timeTracker.getTabCumulativeMs(tab.id);
    }
    broadcast(MSG.BCAST_TICK, {
      now: Date.now(),
      todayMs: timeTracker.getTodayTotalMs(),
      activeTabId: state.activeTabId,
      isActive: state.isActive,
      tabTimes,
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
    console.log(LOG_PREFIX, 'SW bootstrap', chrome.runtime.getManifest().version);

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
    await idleGuard.init({ emit: broadcast });

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
      // M8+M10(P0-08): URL 变了重新检查黑名单，但只对 active tab
      // 非 active tab 的 URL 变化不影响计时状态（下次 activate 会重新检查）
      const state = timeTracker.getTrackingState();
      if (state.activeTabId === tabId) {
        blacklist.checkTab(tabId);
      }
    }
    // D17 Bug 2: audible 状态变化时，让 idleGuard 重新评估
    if ('audible' in changeInfo) {
      idleGuard.reevaluateAudible();
    }
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tempus-ui') return;
  uiPorts.add(port);
  port.onMessage.addListener(() => { /* heartbeat keeps MV3 SW active while UI is open */ });
  bootstrap().then(startTickBroadcast).catch((err) => {
    console.error(LOG_PREFIX, 'UI port bootstrap failed', err);
  });
  port.onDisconnect.addListener(() => {
    uiPorts.delete(port);
    if (uiPorts.size === 0) stopTickBroadcast();
  });
});

// 三入口覆盖冷启动 + 事件唤醒 + 模块加载
chrome.runtime.onInstalled.addListener(async (details) => {
  // 仅首次安装时记录安装时间（更新时不覆盖）
  if (details.reason === 'install') {
    const existing = await localGet(STORAGE_KEY.INSTALL_TIME);
    if (!existing) {
      await localSet(STORAGE_KEY.INSTALL_TIME, Date.now());
    }
  }
  bootstrap();
});
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
    // 兼容旧 UI；新版本使用 runtime Port 自动管理连接生命周期。
    case MSG.REQ_UI_READY:
    case MSG.REQ_UI_GONE:
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

    // ===== M9: Idle Threshold =====

    case MSG.REQ_GET_IDLE_THRESHOLD: {
      return { threshold: idleGuard.getThreshold() };
    }

    case MSG.REQ_SET_IDLE_THRESHOLD: {
      const sec = message.threshold;
      if (typeof sec !== 'number' || sec < 0) throw new Error('invalid threshold');
      await idleGuard.updateThreshold(sec);
      return { threshold: idleGuard.getThreshold() };
    }

    default:
      throw new Error(`not_implemented: ${message.type}`);
  }
}

// 辅助：过滤用（UI 端若需要 hostname 也走 shared）
export { getHostname };
