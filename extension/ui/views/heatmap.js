/**
 * ui/views/heatmap.js
 * --------------------
 * 24 小时热力图：纯 CSS + JS 实现，每小时一格。
 * 颜色深浅映射使用时长占比。
 *
 * 输入：byHour = number[24]（每小时的毫秒总量）
 * 输出：一个 DOM 元素（直接 append 到面板里）
 *
 * 里程碑：M6。
 */

import { h } from '../utils/dom.js';

/**
 * @param {number[]} byHour 长度 24 的数组，每项为该小时累计毫秒
 * @returns {HTMLElement}
 */
export function render(byHour) {
  if (!Array.isArray(byHour) || byHour.length !== 24) {
    byHour = new Array(24).fill(0);
  }

  const maxMs = Math.max(...byHour, 1);  // 防止除零

  const container = h('div', { class: 'heatmap' });
  const title = h('h4', { class: 'heatmap__title' }, ['24 小时分布']);
  container.appendChild(title);

  const grid = h('div', { class: 'heatmap__grid' });

  for (let hour = 0; hour < 24; hour++) {
    const ms = byHour[hour];
    const intensity = ms / maxMs;  // 0~1
    const mins = Math.round(ms / 60000);
    const label = `${String(hour).padStart(2, '0')}:00`;
    const tooltip = `${label} — ${mins} 分钟`;

    const cell = h('div', {
      class: 'heatmap__cell',
      title: tooltip,
      'data-hour': String(hour),
    });

    // 颜色：从浅到深的 orange 色阶
    const alpha = Math.round(intensity * 0.85 * 100) / 100;
    cell.style.backgroundColor = intensity > 0
      ? `rgba(224, 122, 63, ${Math.max(alpha, 0.05)})`
      : 'rgba(0, 0, 0, 0.03)';

    const hourLabel = h('span', { class: 'heatmap__hour' }, [String(hour)]);
    cell.appendChild(hourLabel);
    grid.appendChild(cell);
  }

  container.appendChild(grid);
  return container;
}
