/**
 * ui/main.js
 * -----------
 * New tab page 入口。
 *
 * 流程（契约见 ARCHITECTURE-v2.md §8 / DECISIONS-v2.md D11）：
 *   1. 建立 runtime Port（断线自动重连）
 *   2. 并发拉快照：state + tabs + todayWork + tabTimes
 *   3. 首次渲染 header + tabsGrid + 时间 badge
 *   4. 订阅 Port 广播的 tab 增量、tick 和状态变化
 *   5. 委托事件：activate / close-tab / close-all（M3 动效）
 *
 * 里程碑：M6（历史统计面板）。
 */

import * as messaging from './messaging.js';
import * as tabsGrid from './views/tabsGrid.js';
import * as header from './views/header.js';
import * as historyView from './views/historyView.js';
import * as sidebar from './views/sidebar.js';
import * as settingsPanel from './views/settingsPanel.js';
import * as privateModeWidget from './views/privateModeWidget.js';
import * as focusTimerWidget from './views/focusTimerWidget.js';
import * as welcomeBanner from './views/welcomeBanner.js';
import { LOG_PREFIX } from '../shared/constants.js';
import { $ } from './utils/dom.js';
import { playSwoosh } from './utils/audio.js';
import { burst as confettiBurst } from './utils/confetti.js';
import { applyTheme } from './theme.js';

let lastState = null;  // 缓存 global state，更新 status 行用

async function main() {
  const version = chrome.runtime.getManifest().version;
  console.log(LOG_PREFIX, 'UI main bootstrap', version);

  try {
    await messaging.notifyUIReady();
  } catch (err) {
    console.error(LOG_PREFIX, 'notifyUIReady failed', err);
  }

  const gridEl = $('#tabsGrid');
  if (!gridEl) {
    console.error(LOG_PREFIX, '#tabsGrid not found');
    return;
  }

  // 并发快照（D11 一次性拉齐首帧需要的所有数据，之后都走增量）
  let state, tabsResp, todayResp, timesResp, savedResp;
  try {
    [state, tabsResp, todayResp, timesResp, savedResp] = await Promise.all([
      messaging.getState(),
      messaging.getTabs(),
      messaging.getTodayWork(),
      messaging.getTabTimes(),  // 全量（不传 tabIds）
      messaging.getSaved(),     // M7: saved for later
    ]);
  } catch (err) {
    header.updateStatus(0, []);
    const statusEl = $('.header .status');
    if (statusEl) statusEl.textContent = `v${version} · ⚠️ SW 连接失败：${err?.message || err}`;
    console.error(LOG_PREFIX, 'snapshot failed', err);
    return;
  }

  lastState = state;
  let savedEntries = savedResp?.saved || [];
  let resyncing = false;
  const queuedBroadcasts = [];
  const queueDuringResync = (type, payload) => {
    if (!resyncing) return false;
    queuedBroadcasts.push({ type, payload });
    return true;
  };
  applyTheme(state.config?.theme || 'system');
  const tabs = tabsResp?.tabs || [];

  // 首次渲染
  tabsGrid.render(gridEl, tabs, { saved: savedEntries, config: state.config });
  header.render({
    todayMs: todayResp?.totalMs ?? 0,
    isActive: !!state.tracking?.isActive,
  });
  header.updateStatus(tabs.length, state.tracking?.pauseReasons || []);

  // 首帧 chip/card 时长
  tabsGrid.applyTimeSnapshot({
    tabTimes: timesResp?.tabTimes || {},
    domainTimes: timesResp?.domainTimes || {},
    activeTabId: timesResp?.activeTabId ?? null,
  });

  // M6: 初始化历史统计面板（默认收起，点 📊 展开）
  historyView.init();

  // M7: 初始化 Save for Later 侧边栏
  const sidebarEl = $('#sidebar');
  const handleSavedRemoved = () => {
    messaging.getSaved().then(({ saved }) => {
      savedEntries = saved || [];
      tabsGrid.setSavedEntries(savedEntries);
    }).catch(() => {});
  };
  sidebar.render(sidebarEl, savedEntries, { onRemoved: handleSavedRemoved });

  settingsPanel.init({
    blacklist: state.blacklist ?? [],
    config: state.config,
  });

  // M9: Header 快捷控件
  privateModeWidget.init(state.privateMode ?? null);
  focusTimerWidget.init(state.focusTimer ?? null);

  // M9: 首次安装欢迎横幅（7 天后自动消失或用户点 × 关掉）
  welcomeBanner.init();

  function applyTabChange(payload) {
    tabsGrid.applyChange(payload.action, payload.tabInfo);
    const count = document.querySelectorAll('.tabChip:not(.tabChip--leaving)').length;
    header.updateStatus(count, lastState?.tracking?.pauseReasons || []);
  }

  function applyTick(payload) {
    const isActive = typeof payload.isActive === 'boolean' ? payload.isActive : (payload.activeTabId != null);
    header.updateTodayMs(payload.todayMs, isActive);
    privateModeWidget.tickUpdate();
    focusTimerWidget.tickUpdate();
    tabsGrid.applyTimeSnapshot({
      tabTimes: payload.tabTimes || {}, domainTimes: payload.domainTimes || {},
      activeTabId: payload.activeTabId ?? null,
    });
  }

  function applySaved(payload) {
    if (!Array.isArray(payload?.saved)) return;
    savedEntries = payload.saved;
    sidebar.render(sidebarEl, savedEntries, { onRemoved: handleSavedRemoved });
    tabsGrid.setSavedEntries(savedEntries);
  }

  function applyConfig(payload) {
    if (!payload?.config) return;
    lastState = { ...(lastState || {}), config: payload.config };
    applyTheme(payload.config.theme || 'system');
    tabsGrid.setConfig(payload.config);
    settingsPanel.updateState({ config: payload.config });
  }

  function applyState(payload) {
    const tracking = payload.tracking ?? lastState?.tracking;
    const pauseReasons = payload.pauseReasons ?? tracking?.pauseReasons ?? [];
    lastState = {
      ...(lastState || {}),
      ...(payload.blacklist !== undefined ? { blacklist: payload.blacklist } : {}),
      ...(payload.privateMode !== undefined ? { privateMode: payload.privateMode } : {}),
      ...(payload.focusTimer !== undefined ? { focusTimer: payload.focusTimer } : {}),
      tracking,
    };
    header.updateStateBadges({ pauseReasons, tracking });
    const count = document.querySelectorAll('.tabChip:not(.tabChip--leaving)').length;
    header.updateStatus(count, pauseReasons);
    if (payload.privateMode !== undefined) privateModeWidget.update(payload.privateMode);
    if (payload.focusTimer !== undefined) focusTimerWidget.update(payload.focusTimer);
    settingsPanel.updateState(payload);
  }

  function replayQueuedBroadcasts() {
    while (queuedBroadcasts.length) {
      const { type, payload } = queuedBroadcasts.shift();
      if (type === 'tab') applyTabChange(payload);
      else if (type === 'tick') applyTick(payload);
      else if (type === 'saved') applySaved(payload);
      else if (type === 'config') applyConfig(payload);
      else if (type === 'state') applyState(payload);
    }
  }

  async function resyncAfterReconnect() {
    if (resyncing) return;
    resyncing = true;
    try {
      const [nextState, nextTabs, nextToday, nextTimes, nextSaved] = await Promise.all([
        messaging.getState(), messaging.getTabs(), messaging.getTodayWork(),
        messaging.getTabTimes(), messaging.getSaved(),
      ]);
      lastState = nextState;
      savedEntries = nextSaved?.saved || [];
      applyTheme(nextState.config?.theme || 'system');
      tabsGrid.render(gridEl, nextTabs?.tabs || [], { saved: savedEntries, config: nextState.config });
      tabsGrid.applyTimeSnapshot({
        tabTimes: nextTimes?.tabTimes || {}, domainTimes: nextTimes?.domainTimes || {},
        activeTabId: nextTimes?.activeTabId ?? null,
      });
      sidebar.render(sidebarEl, savedEntries, { onRemoved: handleSavedRemoved });
      settingsPanel.updateState({ blacklist: nextState.blacklist, config: nextState.config });
      privateModeWidget.update(nextState.privateMode ?? null);
      focusTimerWidget.update(nextState.focusTimer ?? null);
      header.updateTodayMs(nextToday?.totalMs ?? 0, !!nextState.tracking?.isActive);
      header.updateStatus((nextTabs?.tabs || []).length, nextState.tracking?.pauseReasons || []);
    } catch (err) {
      console.error(LOG_PREFIX, 'Port reconnect resync failed', err);
    } finally {
      resyncing = false;
      replayQueuedBroadcasts();
    }
  }
  messaging.subscribeReconnect(resyncAfterReconnect);

  // 事件委托
  tabsGrid.bindEvents(gridEl, {
    onActivate: async (tabId, windowId) => {
      try {
        await chrome.tabs.update(tabId, { active: true });
        if (typeof windowId === 'number' && !Number.isNaN(windowId)) {
          await chrome.windows.update(windowId, { focused: true });
        }
      } catch (err) {
        console.error(LOG_PREFIX, 'activate failed', err);
      }
    },
    onCloseTab: async (tabId, event) => {
      closeWithFx([tabId], { event, pitch: 1 });
      try {
        await messaging.closeTab(tabId);
      } catch (err) {
        console.error(LOG_PREFIX, 'closeTab failed', err);
      }
    },
    onCloseAll: async (hostname) => {
      const ids = tabsGrid.getTabIdsByHostname(hostname);
      if (ids.length === 0) return;
      if (!confirm(`关闭 ${hostname} 下的 ${ids.length} 个标签页？`)) return;
      closeWithFx(ids, { pitch: 0.7, stagger: 30 });
      try {
        await Promise.all(ids.map((id) => messaging.closeTab(id)));
      } catch (err) {
        console.error(LOG_PREFIX, 'closeAll failed', err);
      }
    },
    onCloseHomepages: async () => {
      const ids = tabsGrid.getHomepageTabIds();
      if (ids.length === 0) return;
      if (!confirm(`关闭 ${ids.length} 个首页标签？`)) return;
      closeWithFx(ids, { pitch: 0.7, stagger: 30 });
      try {
        await Promise.all(ids.map((id) => messaging.closeTab(id)));
      } catch (err) {
        console.error(LOG_PREFIX, 'closeHomepages failed', err);
      }
    },
    onSaveForLater: async (tabId) => {
      try {
        const resp = await messaging.saveForLater(tabId);
        if (resp?.entry && resp.created) {
          sidebar.add(resp.entry);
          savedEntries = [resp.entry, ...savedEntries];
        }
        if (resp?.entry) tabsGrid.setUrlSaved(resp.entry.url, true);
      } catch (err) {
        console.error(LOG_PREFIX, 'saveForLater failed', err);
      }
    },
    onCloseDuplicates: async (hostname) => {
      const ids = tabsGrid.getDuplicateTabIds(hostname);
      if (ids.length === 0) return;
      if (!confirm(`关闭 ${ids.length} 个重复标签页？（每组保留最早打开的）`)) return;
      closeWithFx(ids, { pitch: 0.7, stagger: 30 });
      try {
        await Promise.all(ids.map((id) => messaging.closeTab(id)));
      } catch (err) {
        console.error(LOG_PREFIX, 'closeDuplicates failed', err);
      }
    },
  });

  // ========== 订阅：tab 增量 ==========
  messaging.subscribeTabChange((payload) => {
    if (!payload || queueDuringResync('tab', payload)) return;
    applyTabChange(payload);
  });

  // ========== 订阅：每秒 tick ==========
  // Port 广播一次性携带 header + 全部 tab 时间，避免每秒追加一轮 REQ IPC。
  messaging.subscribeTick((payload) => {
    if (!payload || queueDuringResync('tick', payload)) return;
    applyTick(payload);
  });

  // ========== 订阅：pauseReasons/tracking 状态变化 ==========
  messaging.subscribeSavedChange((payload) => {
    if (!payload || queueDuringResync('saved', payload)) return;
    applySaved(payload);
  });

  messaging.subscribeConfigChange((payload) => {
    if (!payload || queueDuringResync('config', payload)) return;
    applyConfig(payload);
  });

  messaging.subscribeStateChange((payload) => {
    if (!payload || queueDuringResync('state', payload)) return;
    applyState(payload);
  });

  console.log(LOG_PREFIX, 'v2.0.2 ready,', tabs.length, 'tabs, todayMs =', todayResp?.totalMs);
}

/**
 * 带动画地关闭一批 tab：swoosh + 每个 chip 位置 confetti + chip 淡出。
 * @param {number[]} tabIds
 * @param {{event?: MouseEvent, pitch?: number, stagger?: number}} opts
 */
function closeWithFx(tabIds, opts = {}) {
  const pitch = opts.pitch ?? 1;
  const stagger = opts.stagger ?? 0;
  playSwoosh({ pitch });

  tabIds.forEach((id, idx) => {
    const fire = () => {
      const center = tabsGrid.getChipCenter(id);
      if (center) {
        confettiBurst(center.x, center.y, { count: tabIds.length > 1 ? 18 : 28 });
      }
      tabsGrid.animateRemoveChip(id);
    };
    if (stagger > 0 && idx > 0) {
      setTimeout(fire, idx * stagger);
    } else {
      fire();
    }
  });
}

main();
