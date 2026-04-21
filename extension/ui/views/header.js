/**
 * ui/views/header.js
 * -------------------
 * "今日工作"时长 + pauseReasons / privateMode / focusTimer 状态指示。
 *
 * 数据流：
 *   - 首帧：main.js 调 render(initial) 把 todayMs + isActive 塞进来
 *   - 订阅：main.js 订阅 BCAST_TICK（1s 一次），调 updateTodayMs(ms, isActive)
 *   - 订阅：main.js 订阅 BCAST_STATE_CHANGE，调 updateStateBadges(state)
 *
 * UI 侧"平滑插值"策略（避免 BCAST_TICK 的 1s 抖动被看出来）：
 *   SW 的 BCAST_TICK 是 1s 一次，但"今日工作"的最小显示单位是 1 分钟，视觉上
 *   每秒刷新几乎没差别。所以本 view 不做本地插值——**信 SW 的数字即可**。
 *   这是 v1.3.5 教训：UI 不要做"影子时钟"，影子时钟和 SW 的真相会漂移。
 *
 * 里程碑：M5。
 */

import { $ } from '../utils/dom.js';
import { formatDuration } from '../utils/formatDuration.js';

/** @type {HTMLElement|null} */
let valueEl = null;
/** @type {HTMLElement|null} */
let dotEl = null;
/** @type {HTMLElement|null} */
let containerEl = null;
/** @type {HTMLElement|null} */
let statusEl = null;

/** 本地缓存，避免无意义 DOM 写入 */
let lastRenderedText = '';
let lastRenderedActive = null;

/**
 * 首次渲染。容错：元素不存在就跳过（header 可能被外部定制替换）。
 * @param {{todayMs:number, isActive:boolean}} initial
 */
export function render(initial = {}) {
  containerEl = $('#todayWork');
  valueEl = $('#todayWorkValue');
  dotEl = $('#todayWorkDot');
  statusEl = $('.header .status');

  if (!containerEl || !valueEl) return;

  containerEl.hidden = false;
  updateTodayMs(initial.todayMs ?? 0, !!initial.isActive);
}

/**
 * @param {number} ms 今日累计工作毫秒
 * @param {boolean} [isActive] 是否正在计时（SW 的 tracking.isActive）。undefined 时不改圆点状态
 */
export function updateTodayMs(ms, isActive) {
  if (!valueEl) return;
  const text = formatDuration(ms);
  if (text !== lastRenderedText) {
    valueEl.textContent = text;
    lastRenderedText = text;
  }
  if (typeof isActive === 'boolean' && dotEl && isActive !== lastRenderedActive) {
    dotEl.classList.toggle('is-active', isActive);
    lastRenderedActive = isActive;
  }
}

/**
 * pauseReasons / privateMode / focusTimer 变化。
 * M5 只用 pauseReasons 控制 dot；privateMode/focusTimer 在 M8 接。
 * @param {{pauseReasons?: string[], tracking?: {isActive?: boolean}}} state
 */
export function updateStateBadges(state) {
  if (!dotEl) return;
  const isActive = !!state?.tracking?.isActive;
  if (isActive !== lastRenderedActive) {
    dotEl.classList.toggle('is-active', isActive);
    lastRenderedActive = isActive;
  }
}

/**
 * 更新 header 下方的 status 行（tabs 数 + 暂停原因）。
 * 单独暴露给 main.js 用，避免 main.js 自己操 DOM。
 */
export function updateStatus(tabCount, pauseReasons = []) {
  if (!statusEl) statusEl = $('.header .status');
  if (!statusEl) return;
  const reasons = pauseReasons.length > 0 ? ` · ⏸ ${pauseReasons.join(',')}` : '';
  const version = chrome.runtime?.getManifest?.()?.version || '2.0.0';
  statusEl.textContent = `v${version} · ${tabCount} 个标签页${reasons}`;
}
