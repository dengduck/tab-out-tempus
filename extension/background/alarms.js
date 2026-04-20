/**
 * background/alarms.js
 * ---------------------
 * chrome.alarms 统一管理。v2 只用一个周期 alarm：
 *   'tempus-tick' 每 ALARM_PERIOD_S 秒触发 → timeTracker.tick()
 *
 * 铁律：永远不用 setInterval，SW 休眠会停。
 *
 * 里程碑：M4。
 */

import { LOG_PREFIX, ALARM_PERIOD_S } from '../shared/constants.js';
import * as timeTracker from './timeTracker.js';

const ALARM_TICK = 'tempus-tick';

let initialized = false;

export function init() {
  if (initialized) return;
  initialized = true;

  // chrome.alarms.create 的 periodInMinutes 最小支持 0.5（Chrome 120+ 放宽了，但仍有下限）
  const periodMin = Math.max(ALARM_PERIOD_S / 60, 0.5);

  chrome.alarms.create(ALARM_TICK, { periodInMinutes: periodMin });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_TICK) {
      timeTracker.tick().catch((err) =>
        console.error(LOG_PREFIX, 'tick failed', err)
      );
    }
  });

  console.log(LOG_PREFIX, 'alarms init, tick every', periodMin, 'min');
}
