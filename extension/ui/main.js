/**
 * ui/main.js
 * -----------
 * New tab page 入口。
 *
 * 流程（契约见 ARCHITECTURE-v2.md §8 / DECISIONS-v2.md D11）：
 *   1. 握手 REQ_UI_READY
 *   2. 并发拉快照（M2 当前只拉 state + tabs；M6+ 加 todayWork / saved）
 *   3. 首次渲染 tabsGrid
 *   4. 订阅 BCAST_TAB_CHANGE 做增量
 *   5. 委托事件：activate / close-tab / close-all
 *   6. beforeunload 通知 SW
 */

import * as messaging from './messaging.js';
import * as tabsGrid from './views/tabsGrid.js';
import { LOG_PREFIX } from '../shared/constants.js';
import { $ } from './utils/dom.js';

async function main() {
  console.log(LOG_PREFIX, 'UI main bootstrap (v2.0.0 M2 tabsGrid)');

  try {
    await messaging.notifyUIReady();
  } catch (err) {
    console.error(LOG_PREFIX, 'notifyUIReady failed', err);
  }

  const statusEl = $('.header .status');
  const gridEl = $('#tabsGrid');
  if (!gridEl) {
    console.error(LOG_PREFIX, '#tabsGrid not found');
    return;
  }

  // 并发快照（M6+ 会加更多）
  let state, tabsResp;
  try {
    [state, tabsResp] = await Promise.all([
      messaging.getState(),
      messaging.getTabs(),
    ]);
  } catch (err) {
    if (statusEl) statusEl.textContent = `v2.0.0 · M2 · ⚠️ SW 连接失败：${err?.message || err}`;
    console.error(LOG_PREFIX, 'snapshot failed', err);
    return;
  }

  const tabs = tabsResp?.tabs || [];
  if (statusEl) {
    statusEl.textContent = `v2.0.0 · M2 · ${tabs.length} 个标签页 · 暂停原因 ${state.tracking.pauseReasons.length}`;
  }

  // 首次渲染
  tabsGrid.render(gridEl, tabs);

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
    onCloseTab: async (tabId) => {
      try {
        await messaging.closeTab(tabId);
        // UI 不主动更新；等 BCAST_TAB_CHANGE removed 来做 diff
      } catch (err) {
        console.error(LOG_PREFIX, 'closeTab failed', err);
      }
    },
    onCloseAll: async (hostname) => {
      const ids = tabsGrid.getTabIdsByHostname(hostname);
      if (ids.length === 0) return;
      if (!confirm(`关闭 ${hostname} 下的 ${ids.length} 个标签页？`)) return;
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
      try {
        await Promise.all(ids.map((id) => messaging.closeTab(id)));
      } catch (err) {
        console.error(LOG_PREFIX, 'closeHomepages failed', err);
      }
    },
  });

  // 订阅增量
  messaging.subscribeTabChange((payload) => {
    if (!payload) return;
    tabsGrid.applyChange(payload.action, payload.tabInfo);
    // 刷新 header 计数
    if (statusEl) {
      const count = document.querySelectorAll('.tabChip').length;
      statusEl.textContent = `v2.0.0 · M2 · ${count} 个标签页 · 暂停原因 ${state.tracking.pauseReasons.length}`;
    }
  });

  // 离开通知
  window.addEventListener('beforeunload', () => {
    messaging.notifyUIGone().catch(() => { /* best-effort */ });
  });

  console.log(LOG_PREFIX, 'M2 ready,', tabs.length, 'tabs rendered');
}

main();
