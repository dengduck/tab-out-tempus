/**
 * ui/views/historyView.js
 * ------------------------
 * Today / Week / Month / Year 切换视图 + 域名排行 + 24h 热力图。
 * 按需加载（点开才拉数据）。
 *
 * 数据流：
 *   1. 点 📊 触发 toggle() → 首次 open 时调 loadRange('today')
 *   2. 点 tab 切换时调 loadRange(period)
 *   3. 通过 messaging.getHistoryRange(start, end) 获取 timeLog slices
 *   4. 本地聚合生成域名排行 + 小时热力图 → render 到 DOM
 *
 * 里程碑：M6。
 */

import { h, $ } from '../utils/dom.js';
import { formatDuration } from '../utils/formatDuration.js';
import * as messaging from '../messaging.js';
import { render as renderHeatmap } from './heatmap.js';

/** @type {HTMLElement|null} */
let panelEl = null;
let isOpen = false;
let currentPeriod = 'today';

const PERIODS = ['today', 'week', 'month', 'year'];
const PERIOD_LABELS = { today: '今天', week: '本周', month: '本月', year: '今年' };

/**
 * 初始化并绑定 toggle 按钮。
 */
export function init() {
  panelEl = $('#historyPanel');
  const btn = $('#historyToggle');
  if (btn) btn.addEventListener('click', toggle);
}

export function toggle() {
  isOpen = !isOpen;
  if (!panelEl) return;
  panelEl.hidden = !isOpen;
  const btn = $('#historyToggle');
  if (btn) btn.classList.toggle('is-active', isOpen);
  if (isOpen) loadRange(currentPeriod);
}

export function close() {
  isOpen = false;
  if (panelEl) panelEl.hidden = true;
  const btn = $('#historyToggle');
  if (btn) btn.classList.remove('is-active');
}

// ========== 时间范围计算 ==========

function periodRange(period) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'today') {
    // 今天 00:00 — 23:59
  } else if (period === 'week') {
    // 本周一 00:00
    const dow = start.getDay() || 7;  // 周日=7
    start.setDate(start.getDate() - (dow - 1));
  } else if (period === 'month') {
    start.setDate(1);
  } else if (period === 'year') {
    start.setMonth(0, 1);
  }

  return { start: start.getTime(), end: end.getTime() + 1 };
}

// ========== 数据加载 + 聚合 ==========

async function loadRange(period) {
  currentPeriod = period;
  if (!panelEl) return;

  panelEl.innerHTML = '';
  panelEl.appendChild(renderTabs(period));
  panelEl.appendChild(h('p', { class: 'historyPanel__loading' }, ['加载中…']));

  try {
    const { start, end } = periodRange(period);
    const resp = await messaging.getHistoryRange(start, end);
    const slices = resp?.slices || [];
    renderStats(slices, period);
  } catch (err) {
    panelEl.querySelector('.historyPanel__loading')?.remove();
    panelEl.appendChild(h('p', { class: 'historyPanel__error' }, [`加载失败: ${err?.message || err}`]));
  }
}

function renderTabs(activePeriod) {
  const tabs = h('div', { class: 'historyPanel__tabs' });
  for (const p of PERIODS) {
    const btn = h('button', {
      class: `historyPanel__tab${p === activePeriod ? ' is-active' : ''}`,
      'data-period': p,
    }, [PERIOD_LABELS[p]]);
    btn.addEventListener('click', () => loadRange(p));
    tabs.appendChild(btn);
  }
  return tabs;
}

function renderStats(slices, period) {
  if (!panelEl) return;
  panelEl.querySelector('.historyPanel__loading')?.remove();

  // 总时长
  let totalMs = 0;
  const byHost = {};      // hostname → ms
  const byHour = new Array(24).fill(0);  // 24h heatmap (only for 'today')

  for (const sl of slices) {
    const dur = sl.e - sl.s;
    totalMs += dur;
    if (sl.h) byHost[sl.h] = (byHost[sl.h] || 0) + dur;

    // 小时热力图（只在 today）
    if (period === 'today') {
      distributeToHours(sl, byHour);
    }
  }

  // 总时长
  const summaryEl = h('div', { class: 'historyPanel__summary' }, [
    h('span', { class: 'historyPanel__totalLabel' }, [`${PERIOD_LABELS[period]}累计`]),
    h('span', { class: 'historyPanel__totalValue' }, [formatDuration(totalMs)]),
  ]);
  panelEl.appendChild(summaryEl);

  // 24h 热力图（仅 today）
  if (period === 'today') {
    const heatmapEl = renderHeatmap(byHour);
    panelEl.appendChild(heatmapEl);
  }

  // 域名排行
  const sorted = Object.entries(byHost)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);  // top 15

  if (sorted.length > 0) {
    const rankEl = h('div', { class: 'historyPanel__ranking' });
    rankEl.appendChild(h('h4', { class: 'historyPanel__rankTitle' }, ['域名排行']));
    const list = h('ol', { class: 'historyPanel__rankList' });
    for (const [host, ms] of sorted) {
      const pct = totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0;
      const item = h('li', { class: 'historyPanel__rankItem' }, [
        h('span', { class: 'historyPanel__rankHost' }, [host]),
        h('span', { class: 'historyPanel__rankBar' }),
        h('span', { class: 'historyPanel__rankTime' }, [formatDuration(ms, { locale: 'en' })]),
        h('span', { class: 'historyPanel__rankPct' }, [`${pct}%`]),
      ]);
      // 设置 bar 宽度（CSS custom property）
      const bar = item.querySelector('.historyPanel__rankBar');
      if (bar) bar.style.width = `${pct}%`;
      list.appendChild(item);
    }
    rankEl.appendChild(list);
    panelEl.appendChild(rankEl);
  } else {
    panelEl.appendChild(h('p', { class: 'historyPanel__empty' }, ['暂无数据']));
  }
}

/**
 * 把一个 slice 的时间按小时分配（用于热力图）。
 */
function distributeToHours(sl, byHour) {
  const start = new Date(sl.s);
  const end = new Date(sl.e);
  let cursor = new Date(start);

  while (cursor < end) {
    const hour = cursor.getHours();
    const nextHour = new Date(cursor);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(hour + 1);
    const segEnd = nextHour < end ? nextHour : end;
    byHour[hour] += segEnd.getTime() - cursor.getTime();
    cursor = segEnd;
  }
}
