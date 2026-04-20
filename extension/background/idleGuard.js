/**
 * background/idleGuard.js
 * ------------------------
 * chrome.idle 键鼠空闲守护。
 *
 * D20（M4.5）：阈值默认 180s，用户可通过 config.idleThresholdSec 配置。
 *   chrome.idle 最低限制 15s。
 *
 * 'active' → resume('idle')
 * 'idle' / 'locked' → pause('idle')
 *
 * 里程碑：M4 → M4.5（D20）。
 */

import { LOG_PREFIX, IDLE_THRESHOLD_DEFAULT_SEC, STORAGE_KEY } from '../shared/constants.js';
import { localGet } from './store.js';
import * as timeTracker from './timeTracker.js';

let initialized = false;
let currentState = 'active';
let effectiveThreshold = IDLE_THRESHOLD_DEFAULT_SEC;

export async function init() {
  if (initialized) return;
  initialized = true;

  // D20：读取用户配置的阈值（如果有）
  try {
    const userThreshold = await localGet(STORAGE_KEY.CONFIG_IDLE_THRESHOLD_SEC);
    if (typeof userThreshold === 'number' && userThreshold >= 15) {
      effectiveThreshold = userThreshold;
    }
  } catch (_) { /* use default */ }

  try {
    chrome.idle.setDetectionInterval(effectiveThreshold);
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
    chrome.idle.queryState(effectiveThreshold, (state) => {
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

export function getThreshold() {
  return effectiveThreshold;
}
