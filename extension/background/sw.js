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
 * **此文件是 M1 骨架版**，只保证 SW 能正常 register、console 有输出、能响应
 * REQ_GET_STATE（返回空状态）。业务实现放到 M2+ 对应模块里。
 */

import { MSG, classify } from '../shared/messages.js';
import { LOG_PREFIX } from '../shared/constants.js';

// ========== 临时状态（M1 占位，M2+ 逐步替换为真模块） ==========

let hasActiveUIPort = false;

// ========== 启动 ==========

function bootstrap() {
  console.log(LOG_PREFIX, 'SW bootstrap (v2.0.0 M1 skeleton)');
  // M4+ 会在这里调各模块 init()
  // timeTracker.init();
  // focusModel.init();
  // idleGuard.init();
  // privateMode.init();
  // blacklist.init();
  // focusTimer.init();
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
 * M1 只实现 REQ_UI_READY / REQ_UI_GONE / REQ_GET_STATE；其余返回 "not_implemented"。
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
      // M1 返回空骨架。M4+ 从真实模块聚合。
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

    default:
      throw new Error(`not_implemented: ${message.type}`);
  }
}
