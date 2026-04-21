/**
 * background/privateMode.js
 * --------------------------
 * 隐私计时窗口：用户启动后指定分钟数内暂停计时（不写入 timeLog）。
 *
 * 接口：
 *   start(durationMin)      → pause('private-mode'), 注册到期 alarm
 *   stop()                  → resume('private-mode'), 清 storage
 *   getStatus()             → {active, endTime, remainingMs} | null
 *   init()                  → SW 启动时恢复（若未过期续注册 alarm）
 *
 * 存储：chrome.storage.local['privateMode'] = {endTime: number} | null
 *
 * 里程碑：M8。
 * 参考：docs/v1-feature-reference/private-mode.md
 */

import { STORAGE_KEY, LOG_PREFIX } from '../shared/constants.js';
import { localGet, localSet, localRemove } from './store.js';
import * as timeTracker from './timeTracker.js';

const PAUSE_REASON = 'private-mode';
const ALARM_NAME = 'tempus-private-mode-end';

let endTime = null;   // Unix ms; null = 未激活
let emit = null;

function log(...args) {
  console.log(LOG_PREFIX, '[pm]', ...args);
}

function broadcastChange() {
  if (typeof emit === 'function') {
    try {
      emit('BCAST_STATE_CHANGE', {
        pauseReasons: timeTracker.getPauseReasons(),
        tracking: timeTracker.getTrackingState(),
        privateMode: getStatus(),
      });
    } catch (_) { /* ignore */ }
  }
}

// ========== 公共 API ==========

export async function start(durationMin) {
  if (typeof durationMin !== 'number' || durationMin <= 0) {
    throw new Error('invalid durationMin');
  }

  endTime = Date.now() + durationMin * 60 * 1000;
  await localSet(STORAGE_KEY.PRIVATE_MODE, { endTime });

  // 注册到期 alarm
  chrome.alarms.create(ALARM_NAME, { when: endTime });

  timeTracker.pause(PAUSE_REASON);
  log('started, endTime =', new Date(endTime).toISOString());
  broadcastChange();
  return getStatus();
}

export async function stop() {
  if (endTime === null) return;

  endTime = null;
  await localRemove(STORAGE_KEY.PRIVATE_MODE);

  try { chrome.alarms.clear(ALARM_NAME); } catch (_) { /* ignore */ }

  timeTracker.resume(PAUSE_REASON);
  log('stopped');
  broadcastChange();
}

export function getStatus() {
  if (endTime === null) return null;
  const remaining = endTime - Date.now();
  if (remaining <= 0) {
    // 已过期但 alarm 尚未触发（SW 休眠等极端情况） → 主动清理
    endTime = null;
    localRemove(STORAGE_KEY.PRIVATE_MODE).catch(() => {});
    try { chrome.alarms.clear(ALARM_NAME); } catch (_) { /* ignore */ }
    return null;
  }
  return {
    active: true,
    endTime,
    remainingMs: remaining,
  };
}

/**
 * SW 启动时恢复。
 * @param {{emit?: Function}} deps
 */
export async function init(deps = {}) {
  emit = deps.emit || null;

  const stored = await localGet(STORAGE_KEY.PRIVATE_MODE);
  if (!stored || typeof stored.endTime !== 'number') return;

  const remaining = stored.endTime - Date.now();
  if (remaining <= 0) {
    // 已过期 → 清理
    await localRemove(STORAGE_KEY.PRIVATE_MODE);
    log('init: expired, cleaned up');
    return;
  }

  // 恢复
  endTime = stored.endTime;
  chrome.alarms.create(ALARM_NAME, { when: endTime });
  timeTracker.pause(PAUSE_REASON);
  log('init: restored, remaining =', Math.round(remaining / 1000), 's');
}

// ========== Alarm handler（由 alarms.js 或 sw.js 调用） ==========

export async function onAlarm(alarmName) {
  if (alarmName !== ALARM_NAME) return;
  log('alarm fired → stopping private mode');
  await stop();
}
