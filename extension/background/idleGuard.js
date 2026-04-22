/**
 * background/idleGuard.js
 * ------------------------
 * chrome.idle 键鼠空闲守护。
 *
 * D20（M4.5）：阈值默认 180s，用户可通过 config.idleThresholdSec 配置。
 *   chrome.idle 最低限制 15s。
 * D17 Bug 2 修复：audible 豁免——当前 active tab 正在播放声音时跳过 idle 暂停，
 *   避免"看视频但不动鼠标"被误判为"离开"。
 *
 * 'active' → resume('idle')
 * 'idle' / 'locked' → pause('idle')，但 audible tab 豁免 idle（locked 不豁免）
 *
 * 里程碑：M4 → M4.5（D20）→ M9（audible 豁免）。
 */

import { LOG_PREFIX, IDLE_THRESHOLD_DEFAULT_SEC, STORAGE_KEY } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import { localGet, localSet } from './store.js';
import * as timeTracker from './timeTracker.js';

let initialized = false;
let currentState = 'active';
let effectiveThreshold = IDLE_THRESHOLD_DEFAULT_SEC;

/** @type {((msgType: string, payload: any) => void) | null} */
let emit = null;

/** M10(P1-10): 状态变化后立即广播，消除 1s 延迟 */
function broadcastStateChange() {
  if (typeof emit !== 'function') return;
  try {
    const state = timeTracker.getTrackingState();
    emit(MSG.BCAST_STATE_CHANGE, {
      pauseReasons: state.pauseReasons,
    });
  } catch (_) { /* ignore */ }
}

/**
 * 查询当前焦点窗口的 active tab 是否正在播放声音。
 * @returns {Promise<boolean>}
 */
async function isActiveTabAudible() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.audible === true;
  } catch (_) {
    return false;
  }
}

export async function init(deps = {}) {
  if (initialized) return;
  initialized = true;
  emit = deps.emit || null;

  // D20：读取用户配置的阈值（如果有）
  // P0-02 fix: 增加 userThreshold===0 分支，恢复"关闭"设置
  try {
    const userThreshold = await localGet(STORAGE_KEY.CONFIG_IDLE_THRESHOLD_SEC);
    if (typeof userThreshold === 'number' && userThreshold >= 15) {
      effectiveThreshold = userThreshold;
    } else if (userThreshold === 0) {
      effectiveThreshold = 0;
    }
  } catch (_) { /* use default */ }

  try {
    chrome.idle.setDetectionInterval(effectiveThreshold || 86400);
  } catch (err) {
    console.warn(LOG_PREFIX, 'idle.setDetectionInterval failed', err);
  }

  chrome.idle.onStateChanged.addListener(async (state) => {
    currentState = state;
    if (state === 'active') {
      timeTracker.resume('idle');
      broadcastStateChange();
    } else if (state === 'locked') {
      // 锁屏 = 一定暂停，不做 audible 豁免
      timeTracker.pause('idle');
      broadcastStateChange();
    } else {
      // state === 'idle'：键鼠空闲，但要检查是否在看视频
      const audible = await isActiveTabAudible();
      if (audible) {
        // D17 Bug 2 fix: 正在播放声音 → 跳过 idle 暂停
        console.log(LOG_PREFIX, 'idle detected but active tab is audible — skipping pause');
        return;
      }
      timeTracker.pause('idle');
      broadcastStateChange();
    }
  });

  // 启动时查一次当前状态，避免"SW 冷启动时用户其实 idle 着但 timeTracker 不知道"
  // P1-06: effectiveThreshold===0 时跳过（idle 已关闭）
  if (effectiveThreshold > 0) {
    try {
      chrome.idle.queryState(effectiveThreshold, async (state) => {
        currentState = state;
        if (state === 'active') return;
        if (state === 'idle') {
          const audible = await isActiveTabAudible();
          if (audible) return;  // audible 豁免
        }
        timeTracker.pause('idle');
      });
    } catch (err) {
      console.warn(LOG_PREFIX, 'idle.queryState failed', err);
    }
  }
}

/**
 * 当 idle 已触发但 tab 变成 audible 时，外部可调用此方法重新评估。
 * （可选增强：sw.js 监听 tabs.onUpdated 的 audible 变化时调用）
 */
export async function reevaluateAudible() {
  if (currentState === 'active' || currentState === 'locked') return;
  // P0-01 fix: 缓存进入时的 state，await 返回后若 state 已变则放弃操作
  const stateOnEntry = currentState;
  const audible = await isActiveTabAudible();
  if (currentState !== stateOnEntry) return; // 竞态守卫
  if (audible && timeTracker.getTrackingState().pauseReasons.includes('idle')) {
    // tab 开始播放声音了 → 解除 idle 暂停
    console.log(LOG_PREFIX, 'active tab became audible during idle — resuming');
    timeTracker.resume('idle');
    broadcastStateChange();
  } else if (!audible && !timeTracker.getTrackingState().pauseReasons.includes('idle')) {
    // tab 停止播放声音了 → 重新应用 idle 暂停
    timeTracker.pause('idle');
    broadcastStateChange();
  }
}

export function isIdle() {
  return currentState !== 'active';
}

export function getThreshold() {
  return effectiveThreshold;
}

/**
 * 更新 idle 阈值。0 表示关闭 idle 检测。
 * @param {number} sec — 新阈值（秒），0 = 关闭，最小有效值 15
 */
export async function updateThreshold(sec) {
  if (typeof sec !== 'number') return;

  if (sec === 0) {
    // "关闭" idle 检测：先恢复可能存在的 idle pause，然后把阈值设到最大
    timeTracker.resume('idle');
    broadcastStateChange();
    effectiveThreshold = 0;
    await localSet(STORAGE_KEY.CONFIG_IDLE_THRESHOLD_SEC, 0);
    // Chrome API 不支持真正关闭 idle，设一个超长阈值（24 小时）近似关闭
    try { chrome.idle.setDetectionInterval(86400); } catch (_) {}
    return;
  }

  const clamped = Math.max(15, sec);
  effectiveThreshold = clamped;
  await localSet(STORAGE_KEY.CONFIG_IDLE_THRESHOLD_SEC, clamped);
  try {
    chrome.idle.setDetectionInterval(clamped);
  } catch (err) {
    console.warn(LOG_PREFIX, 'idle.setDetectionInterval failed', err);
  }
}
