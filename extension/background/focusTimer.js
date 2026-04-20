/**
 * background/focusTimer.js
 * -------------------------
 * 番茄钟：倒计时 N 分钟。
 *
 * strict=true 模式：开启后，对不在白名单里的 hostname 自动暂停计时。
 * strict=false（默认）：纯倒计时提醒，不影响计时。
 *
 * 存储：chrome.storage.local['focusTimer'] = {startTime, endTime, durationMs, strict, allowedHosts} | null
 *
 * 里程碑：M8。
 */

import { STORAGE_KEY, LOG_PREFIX } from '../shared/constants.js';
import { localGet, localSet, localRemove } from './store.js';
import * as timeTracker from './timeTracker.js';

const ALARM_NAME = 'tempus-focus-timer-end';

let state = null;   // {startTime, endTime, durationMs, strict, allowedHosts}
let emit = null;

function log(...args) {
  console.log(LOG_PREFIX, '[ft]', ...args);
}

function broadcastChange() {
  if (typeof emit === 'function') {
    try {
      emit('BCAST_STATE_CHANGE', {
        pauseReasons: timeTracker.getPauseReasons(),
        tracking: timeTracker.getTrackingState(),
        focusTimer: getStatus(),
      });
    } catch (_) { /* ignore */ }
  }
}

// ========== 公共 API ==========

/**
 * @param {number} durationMin
 * @param {{strict?: boolean, allowedHosts?: string[]}} opts
 */
export async function start(durationMin, opts = {}) {
  if (typeof durationMin !== 'number' || durationMin <= 0) {
    throw new Error('invalid durationMin');
  }

  const now = Date.now();
  state = {
    startTime: now,
    endTime: now + durationMin * 60 * 1000,
    durationMs: durationMin * 60 * 1000,
    strict: !!opts.strict,
    allowedHosts: Array.isArray(opts.allowedHosts) ? opts.allowedHosts : [],
  };

  await localSet(STORAGE_KEY.FOCUS_TIMER, state);
  chrome.alarms.create(ALARM_NAME, { when: state.endTime });

  log('started', durationMin, 'min, strict =', state.strict);
  broadcastChange();
  return getStatus();
}

export async function stop() {
  if (!state) return;

  state = null;
  await localRemove(STORAGE_KEY.FOCUS_TIMER);
  try { chrome.alarms.clear(ALARM_NAME); } catch (_) { /* ignore */ }

  log('stopped');
  broadcastChange();
}

export function getStatus() {
  if (!state) return null;
  const remaining = state.endTime - Date.now();
  if (remaining <= 0) return null;
  return {
    active: true,
    startTime: state.startTime,
    endTime: state.endTime,
    durationMs: state.durationMs,
    remainingMs: remaining,
    strict: state.strict,
    allowedHosts: state.allowedHosts,
    elapsed: Date.now() - state.startTime,
    progress: Math.min(1, (Date.now() - state.startTime) / state.durationMs),
  };
}

/**
 * SW 启动时恢复。
 * @param {{emit?: Function}} deps
 */
export async function init(deps = {}) {
  emit = deps.emit || null;

  const stored = await localGet(STORAGE_KEY.FOCUS_TIMER);
  if (!stored || typeof stored.endTime !== 'number') return;

  const remaining = stored.endTime - Date.now();
  if (remaining <= 0) {
    await localRemove(STORAGE_KEY.FOCUS_TIMER);
    log('init: expired, cleaned up');
    return;
  }

  state = stored;
  chrome.alarms.create(ALARM_NAME, { when: state.endTime });
  log('init: restored, remaining =', Math.round(remaining / 1000), 's');
}

// ========== Alarm handler ==========

export async function onAlarm(alarmName) {
  if (alarmName !== ALARM_NAME) return;
  log('alarm fired → focus timer ended');
  await stop();
  // 可以在这里发通知（M9 再加 chrome.notifications）
}
