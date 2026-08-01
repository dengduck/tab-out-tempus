/**
 * background/alarms.js
 * ---------------------
 * chrome.alarms 统一管理。
 *
 * 周期 alarm：
 *   'tempus-tick' 每 ALARM_PERIOD_S 秒触发 → timeTracker.tick()
 *
 * 一次性 alarm（M8）：
 *   'tempus-private-mode-end' → privateMode.onAlarm()
 *   'tempus-focus-timer-end'  → focusTimer.onAlarm()
 *
 * 铁律：永远不用 setInterval，SW 休眠会停。
 *
 * 里程碑：M4 → M8。
 */

import { LOG_PREFIX, ALARM_PERIOD_S } from '../shared/constants.js';
import * as timeTracker from './timeTracker.js';
import * as privateMode from './privateMode.js';
import * as focusTimer from './focusTimer.js';
import * as featureHub from './featureHub.js';

const ALARM_TICK = 'tempus-tick';

let initialized = false;

export async function handleAlarm(alarm) {
  if (alarm.name === ALARM_TICK) {
    await timeTracker.tick();
    await featureHub.onTick();
    return;
  }
  const results = await Promise.allSettled([
    privateMode.onAlarm(alarm.name),
    focusTimer.onAlarm(alarm.name),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') console.error(LOG_PREFIX, 'alarm handler failed', result.reason);
  }
}

export async function init() {
  if (initialized) return;
  const periodMin = Math.max(ALARM_PERIOD_S / 60, 0.5);
  await chrome.alarms.create(ALARM_TICK, { periodInMinutes: periodMin });
  initialized = true;
  console.log(LOG_PREFIX, 'alarms init, tick every', periodMin, 'min');
}
