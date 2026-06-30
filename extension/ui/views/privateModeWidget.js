/**
 * ui/views/privateModeWidget.js
 * ----------------------------
 * Header 上的隐私模式快捷按钮。
 *
 * 交互：
 *   - 未激活 → 点击弹出 dropdown 选时长（15/30/45/60/120 分钟）
 *   - 已激活 → 按钮变 active 态，显示精确到秒的剩余时间，点击关闭
 *
 * 数据流：
 *   - 首帧：init(state.privateMode)
 *   - 订阅：BCAST_STATE_CHANGE → update(payload.privateMode)
 *   - BCAST_TICK → tickUpdate() 刷新剩余时间
 *
 * 里程碑：M9 → v2.1（P2-22：逻辑收敛到 createHeaderWidget 工厂）。
 */

import { createHeaderWidget } from './headerWidget.js';
import * as messaging from '../messaging.js';

const ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

const widget = createHeaderWidget({
  btnId: 'privateModeToggle',
  iconSvg: ICON_SVG,
  text: '隐私时间',
  presets: [15, 30, 45, 60, 120],
  presetLabel: (min) => (min >= 60 ? `${min / 60} 小时` : `${min} 分钟`),
  onStart: (min) => messaging.startPrivateMode(min),
  onStop: () => messaging.stopPrivateMode(),
  titleIdle: '开启隐私模式',
  titleActive: '点击关闭隐私模式',
  logName: 'privateModeWidget',
});

export const init = widget.init;
export const update = widget.update;
export const tickUpdate = widget.tickUpdate;
