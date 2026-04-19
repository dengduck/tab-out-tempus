/**
 * background/sw.js
 * -----------------
 * Service Worker 入口。
 *
 * 职责（契约冻结于 M0）：
 *   1. 监听 chrome.* 事件并**路由**到具体业务模块。本文件自己不写业务逻辑。
 *   2. 维护 UI 连接状态（hasActiveUIPort），决定是否广播 BCAST_TICK。
 *   3. 启动时调用各模块 init()（onInstalled / onStartup / 顶层 import 三入口）。
 *
 * 当前阶段：M2（tab 分组）。tabRegistry 已接入并能广播 BCAST_TAB_CHANGE。
 */

import { MSG, classify } from '../shared/messages.js';
import { LOG_PREFIX } from '../shared/constants.js';
import * as tabRegistry from './tabRegistry.js';

// ========== 临时状态（M1 占位，M4+ 逐步替换为真模块） ==========

let hasActiveUIPort = false;

// ========== 广播（SW → 所有活跃 UI） ==========

/**
 * 向所有打开的 new tab page 广播一条消息。
 * 没人接收时 chrome.runtime.sendMessage 会 reject "no receiving end"，这里静默吞掉。
 */
function broadcast(type, payload) {
  if (!hasActiveUIPort) return;  // 没 UI 在听，省一次 IPC
  try {
    chrome.runtime.sendMessage({ type, payload }).catch(() => { /* no receivers */ });
  } catch (_) {
    /* sendMessage 可能同步抛，忽略 */
  }
}

// ========== 启动 ==========

let bootstrapped = false;

async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  console.log(LOG_PREFIX, 'SW bootstrap (v2.0.0 M2 tabRegistry)');

  await tabRegistry.init({ emit: broadcast });

  // M4+ 会在这里继续调各模块 init()
  // timeTracker.init(); focusModel.init(); idleGuard.init(); ...
}

// 三入口都 init（覆盖冷启动 + 事件唤醒 + 模块加载）
chrome.runtime.onInstalled.addListener(() => {
  console.log(LOG_PREFIX, 'onInstalled');
  bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  console.log(LOG_PREFIX, 'onStartup');
  bootstrap();
});

bootstrap();  // 顶层模块加载时

// ========== 消息路由 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const kind = classify(message?.type);
  if (kind !== 'req') {
    // 广播消息不应该被 SW 自己收到；忽略
    return false;
  }

  handleRequest(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      console.error(LOG_PREFIX, 'handler error', message?.type, err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });

  return true;  // MV3 异步响应必须返回 true
});

/**
 * 路由 REQ_* 消息到具体处理函数。
 */
async function handleRequest(message, _sender) {
  switch (message.type) {
    case MSG.REQ_UI_READY:
      hasActiveUIPort = true;
      console.log(LOG_PREFIX, 'UI ready');
      return { ok: true };

    case MSG.REQ_UI_GONE:
      hasActiveUIPort = false;
      console.log(LOG_PREFIX, 'UI gone');
      return { ok: true };

    case MSG.REQ_GET_STATE:
      // M2 返回空骨架。M4+ 从真实模块聚合。
      return {
        tracking: {
          isActive: false,
          activeTabId: null,
          pauseReasons: [],
          sliceStart: null,
        },
        privateMode: null,
        focusTimer: null,
        blacklist: [],
      };

    case MSG.REQ_GET_TABS:
      return { tabs: tabRegistry.getAll() };

    case MSG.REQ_CLOSE_TAB: {
      const tabId = message.tabId;
      if (typeof tabId !== 'number') throw new Error('invalid tabId');
      await chrome.tabs.remove(tabId);
      return { closed: tabId };
    }

    default:
      throw new Error(`not_implemented: ${message.type}`);
  }
}
