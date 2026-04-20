/**
 * ui/main.js
 * -----------
 * New tab page 入口。
 *
 * 流程（契约见 ARCHITECTURE-v2.md §8 / DECISIONS-v2.md D11）：
 *   1. 握手 REQ_UI_READY
 *   2. 并发拉快照：state + tabs + todayWork + tabTimes
 *   3. 首次渲染 header + tabsGrid + 时间 badge
 *   4. 订阅 BCAST_TAB_CHANGE（增量 DOM）/ BCAST_TICK（刷今日工作）/ BCAST_STATE_CHANGE（刷状态圆点）
 *   5. 每秒主动拉 getTabTimes()（BCAST_TICK 只给 header/activeTab，chip 批量用 REQ）
 *   6. 委托事件：activate / close-tab / close-all（M3 动效）
 *   7. beforeunload 通知 SW
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
import { LOG_PREFIX } from '../shared/constants.js';
import { $ } from './utils/dom.js';
import { playSwoosh } from './utils/audio.js';
import { burst as confettiBurst } from './utils/confetti.js';

let lastState = null;  // 缓存 global state，更新 status 行用

async function main() {
  console.log(LOG_PREFIX, 'UI main bootstrap (v2.0.0 M9)');

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
    if (statusEl) statusEl.textContent = `v2.0.0 · M9 · ⚠️ SW 连接失败：${err?.message || err}`;
    console.error(LOG_PREFIX, 'snapshot failed', err);
    return;
  }

  lastState = state;
  const tabs = tabsResp?.tabs || [];

  // 首次渲染
  tabsGrid.render(gridEl, tabs);
  header.render({
    todayMs: todayResp?.totalMs ?? 0,
    isActive: !!state.tracking?.isActive,
  });
  header.updateStatus(tabs.length, state.tracking?.pauseReasons || []);

  // 首帧 chip/card 时长
  tabsGrid.applyTimeSnapshot({
    tabTimes: timesResp?.tabTimes || {},
    activeTabId: timesResp?.activeTabId ?? null,
  });

  // M6: 初始化历史统计面板（默认收起，点 📊 展开）
  historyView.init();

  // M7: 初始化 Save for Later 侧边栏
  const sidebarEl = $('#sidebar');
  sidebar.render(sidebarEl, savedResp?.saved || []);

  // M9: 初始化设置面板（只有 Blacklist）
  settingsPanel.init({
    blacklist: state.blacklist ?? [],
  });

  // M9: Header 快捷控件
  privateModeWidget.init(state.privateMode ?? null);
  focusTimerWidget.init(state.focusTimer ?? null);

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
        if (resp?.entry) sidebar.add(resp.entry);
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
    if (!payload) return;
    tabsGrid.applyChange(payload.action, payload.tabInfo);
    const count = document.querySelectorAll('.tabChip:not(.tabChip--leaving)').length;
    header.updateStatus(count, lastState?.tracking?.pauseReasons || []);
  });

  // ========== 订阅：每秒 tick ==========
  // BCAST_TICK 的 payload：{now, todayMs, activeTabId, activeTabMs}
  // 我们用它：
  //   1. 直接更新 header（todayMs, isActive 从 activeTabId 是否存在推断）
  //   2. 节流触发一次批量 tabTimes 刷新（chip badge + card 聚合）
  //      —— 1s 一次批量 REQ 成本很低（就是读一个 Map），比让 SW broadcast 整个 times dict 更干净
  let timesRefreshInFlight = false;
  messaging.subscribeTick(async (payload) => {
    if (!payload) return;
    // M8: 用 SW 的 isActive 真相，不从 activeTabId 推断（暂停时 activeTabId 仍非 null）
    const isActive = typeof payload.isActive === 'boolean' ? payload.isActive : (payload.activeTabId != null);
    header.updateTodayMs(payload.todayMs, isActive);

    // M9: 刷新 header widget 的倒计时
    privateModeWidget.tickUpdate();
    focusTimerWidget.tickUpdate();

    // 节流：上一次 REQ 还没回来就跳过这一轮
    if (timesRefreshInFlight) return;
    timesRefreshInFlight = true;
    try {
      const ids = tabsGrid.getAllTabIds();
      if (ids.length === 0) return;
      const resp = await messaging.getTabTimes(ids);
      tabsGrid.applyTimeSnapshot({
        tabTimes: resp?.tabTimes || {},
        activeTabId: resp?.activeTabId ?? null,
      });
    } catch (err) {
      // SW 短暂 suspended 等情况——下一秒重试即可
    } finally {
      timesRefreshInFlight = false;
    }
  });

  // ========== 订阅：pauseReasons/tracking 状态变化 ==========
  messaging.subscribeStateChange((payload) => {
    if (!payload) return;
    lastState = {
      ...(lastState || {}),
      tracking: payload.tracking,
    };
    header.updateStateBadges({
      pauseReasons: payload.pauseReasons,
      tracking: payload.tracking,
    });
    const count = document.querySelectorAll('.tabChip:not(.tabChip--leaving)').length;
    header.updateStatus(count, payload.pauseReasons || []);
    // M9: 同步 header widget + 设置面板
    privateModeWidget.update(payload.privateMode);
    focusTimerWidget.update(payload.focusTimer);
    settingsPanel.updateState(payload);
  });

  // ========== 离开通知 ==========
  window.addEventListener('beforeunload', () => {
    messaging.notifyUIGone().catch(() => { /* best-effort */ });
  });

  console.log(LOG_PREFIX, 'M9 ready,', tabs.length, 'tabs, todayMs =', todayResp?.totalMs);
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
