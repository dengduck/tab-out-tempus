/**
 * background/idleGuard.js
 * ------------------------
 * chrome.idle 键鼠空闲守护。IDLE_THRESHOLD_SEC 无键鼠输入 → timeTracker.pause('idle')。
 *
 * 'active' → resume('idle')
 * 'idle' / 'locked' → pause('idle')
 *
 * 里程碑：M4。
 */

import { LOG_PREFIX, IDLE_THRESHOLD_SEC } from '../shared/constants.js';
import * as timeTracker from './timeTracker.js';

let initialized = false;
let currentState = 'active';

export function init() {
  if (initialized) return;
  initialized = true;

  try {
    chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SEC);
  } catch (err) {
    console.warn(LOG_PREFIX, 'idle.setDetectionInterval failed', err);
  }

  chrome.idle.onStateChanged.addListener((state) => {
    currentState = state;
    if (state === 'active') {
      timeTracker.resume('idle');
    } else {
      // 'idle' | 'locked'
      timeTracker.pause('idle');
    }
  });

  // 启动时查一次当前状态，避免"SW 冷启动时用户其实 idle 着但 timeTracker 不知道"
  try {
    chrome.idle.queryState(IDLE_THRESHOLD_SEC, (state) => {
      currentState = state;
      if (state !== 'active') timeTracker.pause('idle');
    });
  } catch (err) {
    console.warn(LOG_PREFIX, 'idle.queryState failed', err);
  }
}

export function isIdle() {
  return currentState !== 'active';
}
