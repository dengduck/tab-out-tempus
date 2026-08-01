/**
 * background/focusModel.js
 * -------------------------
 * 封装 chrome.windows.onFocusChanged，作为"当前该给谁计时"的**单一真相源**。
 *
 * 职责：
 *   - 维护 focusedWindowId（内存）；WINDOW_ID_NONE → null（Chrome 失焦）
 *   - 状态变化时通知 timeTracker.onFocusWindow
 *   - 启动时从 chrome.windows.getLastFocused() 恢复状态
 *
 * 里程碑：M4。
 */

import { LOG_PREFIX } from '../shared/constants.js';
import * as timeTracker from './timeTracker.js';

/** @type {number | null} */
let focusedWindowId = null;

let initialized = false;

export function onFocusChanged(winId) {
  const isNone =
    winId === null ||
    winId === undefined ||
    winId === chrome.windows.WINDOW_ID_NONE;
  focusedWindowId = isNone ? null : winId;
  timeTracker.onFocusWindow(focusedWindowId);
}

export async function init() {
  if (initialized) return;
  initialized = true;

  // 冷启动时先查一次
  try {
    const win = await chrome.windows.getLastFocused();
    if (win && typeof win.id === 'number' && win.focused) {
      onFocusChanged(win.id);
      // 顺便把当前 active tab 喂给 timeTracker
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (activeTab && typeof activeTab.id === 'number') {
        timeTracker.onActivateTab(activeTab.id, win.id);
      }
    } else {
      // Chrome 不在焦点
      onFocusChanged(null);
    }
  } catch (err) {
    console.warn(LOG_PREFIX, 'focusModel init query failed', err);
  }
}

export function getFocusedWindowId() {
  return focusedWindowId;
}

export function isFocused() {
  return focusedWindowId !== null;
}
