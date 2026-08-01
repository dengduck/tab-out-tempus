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
import * as tabRegistry from './tabRegistry.js';
import * as timeTracker from './timeTracker.js';
import * as focusModel from './focusModel.js';
import * as idleGuard from './idleGuard.js';
import * as alarms from './alarms.js';
import * as privateMode from './privateMode.js';
import * as blacklist from './blacklist.js';
import * as featureHub from './featureHub.js';
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
      domainTimes: timeTracker.getDomainTodayMs(),
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

// 同步注册 wake listener；真正处理前等待 bootstrap 恢复持久状态。
chrome.alarms.onAlarm.addListener((alarm) => {
  void bootstrap()
    .then(() => alarms.handleAlarm(alarm))
    .catch((err) => console.error(LOG_PREFIX, 'alarm bootstrap/handler failed', err));
});

async function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    if (bootstrapped) return;
    console.log(LOG_PREFIX, 'SW bootstrap', chrome.runtime.getManifest().version);

    // 1. tabRegistry（需要先有它，timeTracker 靠它查 hostname）
    await tabRegistry.init({ emit: broadcast });

    // 2. timeTracker（尚未注册 chrome 事件，只做内部状态恢复）
    await timeTracker.init({ emit: broadcast });

    // 3. focusModel（补齐初始窗口与 active tab；wake listeners 已在模块求值时注册）
    await focusModel.init();

    // 5. idleGuard (D20: async — reads user config for idle threshold)
    await idleGuard.init({ emit: broadcast });

    // 6. M8 模块（依赖 timeTracker 已 init）
    await privateMode.init({ emit: broadcast });
    await blacklist.init({ emit: broadcast });
    await featureHub.init({ emit: broadcast });

    // 7. alarms（最后启动 tick）
    await alarms.init();
    bootstrapped = true;
  })().catch((err) => {
    bootstrapped = false;
    bootstrapPromise = null;
    throw err;
  });
  return bootstrapPromise;
}

function routeWake(label, handler) {
  void bootstrap().then(handler).catch((err) => {
    console.error(LOG_PREFIX, `${label} wake handler failed`, err);
  });
}

function registerWakeListeners() {
  chrome.tabs.onCreated.addListener((tab) => {
    routeWake('tab-created', () => tabRegistry.onCreated(tab));
  });
  chrome.tabs.onActivated.addListener((info) => {
    routeWake('tab-activated', async () => {
      timeTracker.onActivateTab(info.tabId, info.windowId);
      blacklist.checkTab(info.tabId);
      await featureHub.onTabActivated(info);
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    routeWake('tab-removed', async () => {
      tabRegistry.onRemoved(tabId);
      timeTracker.onRemoveTab(tabId);
      await featureHub.onTabRemoved(tabId);
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    routeWake('tab-updated', async () => {
      const previousUrl = tabRegistry.get(tabId)?.url || '';
      tabRegistry.onUpdated(tabId, changeInfo, tab);
      if (changeInfo.url) {
        timeTracker.onUpdateUrl(tabId, previousUrl, changeInfo.url);
        if (timeTracker.getTrackingState().activeTabId === tabId) blacklist.checkTab(tabId);
      }
      if ('audible' in changeInfo) await idleGuard.reevaluateAudible();
      await featureHub.onTabUpdated(tabId, changeInfo, tab);
    });
  });
  chrome.tabs.onAttached?.addListener?.((tabId, info) => {
    routeWake('tab-attached', () => tabRegistry.onAttached(tabId, info));
  });
  chrome.windows.onFocusChanged.addListener((windowId) => {
    routeWake('window-focus', () => focusModel.onFocusChanged(windowId));
  });
  chrome.idle.onStateChanged.addListener((state) => {
    routeWake('idle-state', () => idleGuard.onStateChanged(state));
  });
}

registerWakeListeners();

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
  const featureResult = await featureHub.handleRequest(message, tabRegistry);
  if (featureResult !== null) return featureResult;

  switch (message.type) {
    // 兼容旧 UI；新版本使用 runtime Port 自动管理连接生命周期。
    case MSG.REQ_UI_READY:
    case MSG.REQ_UI_GONE:
      return { ok: true };

    case MSG.REQ_GET_STATE: {
      const extras = featureHub.getState();
      return {
        tracking: timeTracker.getTrackingState(),
        privateMode: privateMode.getStatus(),
        focusTimer: extras.focusTimer,
        blacklist: blacklist.getList(),
        config: extras.config,
      };
    }

    case MSG.REQ_GET_TABS:
      return { tabs: tabRegistry.getAll() };

    case MSG.REQ_CLOSE_TAB: {
      const tabId = message.tabId;
      if (typeof tabId !== 'number') throw new Error('invalid tabId');
      await chrome.tabs.remove(tabId);
      return { closed: tabId };
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
      return { tabTimes: result, domainTimes: timeTracker.getDomainTodayMs(), activeTabId: state.activeTabId };
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

    // ===== M8: Blacklist =====

    case MSG.REQ_BLACKLIST_ADD: {
      const hostname = message.hostname;
      if (typeof hostname !== 'string' || !hostname) throw new Error('invalid hostname');
      const added = await blacklist.add(hostname);
      return { added, list: blacklist.getList() };
    }

    case MSG.REQ_BLACKLIST_REMOVE: {
      const hostname = message.hostname;
      if (typeof hostname !== 'string' || !hostname) throw new Error('invalid hostname');
      const removed = await blacklist.remove(hostname);
      return { removed, list: blacklist.getList() };
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
