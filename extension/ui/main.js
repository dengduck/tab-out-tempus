/**
 * ui/main.js
 * -----------
 * New tab page 入口。
 *
 * 流程（契约见 ARCHITECTURE-v2.md §8 / DECISIONS-v2.md D11）：
 *   1. 装载 DOM 占位
 *   2. 并发拉一次性快照（REQ_GET_STATE / REQ_GET_TABS / REQ_GET_TODAY_WORK / REQ_GET_SAVED）
 *   3. 首次渲染（各 view render）
 *   4. 订阅 BCAST_*（tick / tabChange / stateChange）
 *   5. beforeunload 时通知 SW（REQ_UI_GONE）
 *
 * **此文件是 M1 骨架版**：只做 REQ_UI_READY 握手 + 打印 REQ_GET_STATE 结果到页面，证明
 * UI ↔ SW 通信链路可用。业务视图在 M2+ 逐步接入。
 */

import * as messaging from './messaging.js';
import { LOG_PREFIX } from '../shared/constants.js';

async function main() {
  console.log(LOG_PREFIX, 'UI main bootstrap (v2.0.0 M1 skeleton)');

  // 1. 通知 SW：UI 已加载
  try {
    await messaging.notifyUIReady();
  } catch (err) {
    console.error(LOG_PREFIX, 'notifyUIReady failed', err);
  }

  // 2. M1 演示：拉一次 state，在页面 header 展示 SW 连通情况
  const statusEl = document.querySelector('.header .status');
  try {
    const state = await messaging.getState();
    if (statusEl) {
      statusEl.textContent = `v2.0.0 · M1 骨架 · SW 连接成功（pauseReasons: ${
        state.tracking.pauseReasons.length
      }）`;
    }
    console.log(LOG_PREFIX, 'initial state', state);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `v2.0.0 · M1 骨架 · ⚠️ SW 连接失败：${err?.message || err}`;
    }
    console.error(LOG_PREFIX, 'getState failed', err);
  }

  // 3. 离开时通知 SW
  window.addEventListener('beforeunload', () => {
    messaging.notifyUIGone().catch(() => { /* best-effort */ });
  });

  // 4. TODO(M2+): 初始化各 view 和订阅 BCAST
}

main();
