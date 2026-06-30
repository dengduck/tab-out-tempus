/**
 * ui/views/focusTimerWidget.js
 * ----------------------------
 * Header 上的专注计时快捷按钮。
 *
 * 交互：
 *   - 未激活 → 点击弹出 dropdown 选时长，确认后开始
 *   - 已激活 → 按钮变 active 态，显示精确到秒的剩余时间，点击停止
 *
 * 数据流：
 *   - 首帧：init(state.focusTimer)
 *   - 订阅：BCAST_STATE_CHANGE → update(payload.focusTimer)
 *   - BCAST_TICK → tickUpdate() 刷新剩余时间
 *
 * 里程碑：M9 → v2.1（P2-22：逻辑收敛到 createHeaderWidget 工厂）。
 */

import { createHeaderWidget } from './headerWidget.js';
import * as messaging from '../messaging.js';

const ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

const widget = createHeaderWidget({
  btnId: 'focusTimerToggle',
  iconSvg: ICON_SVG,
  text: '专注计时',
  presets: [15, 25, 30, 45, 60],
  onStart: (min) => messaging.startFocusTimer(min),
  onStop: () => messaging.stopFocusTimer(),
  titleIdle: '开始专注计时',
  titleActive: '点击停止专注计时',
  logName: 'focusTimerWidget',
});

export const init = widget.init;
export const update = widget.update;
export const tickUpdate = widget.tickUpdate;
