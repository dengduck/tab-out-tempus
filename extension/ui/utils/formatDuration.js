/**
 * ui/utils/formatDuration.js
 * ---------------------------
 * 时长（毫秒）→ 人读格式字符串。
 *
 * 默认规则（v1.3.5 教训）：**最小单位 1 分钟**。小于 1 分钟显示 "<1m" / "<1 分钟"。
 * 这样能避免 UI 上出现"活 tab 秒跳"的视觉噪音——时间的价值是分钟级的。
 *
 * opt-in: {allowSeconds: true} 显示秒级，仅用于测试 / debug。
 *
 * 输出形式（locale='zh'）：
 *   <1 分钟 / 5 分钟 / 1 小时 3 分钟 / 2 小时
 *
 * 输出形式（locale='en'）：
 *   <1m / 5m / 1h 3m / 2h
 *
 * 里程碑：M5。
 *
 * @param {number} ms 毫秒数；NaN/null/负值均按 0 处理
 * @param {Object} [opts]
 * @param {boolean} [opts.allowSeconds=false]
 * @param {'en'|'zh'} [opts.locale='zh']
 * @returns {string}
 */
export function formatDuration(ms, opts = {}) {
  const locale = opts.locale === 'en' ? 'en' : 'zh';
  const allowSeconds = !!opts.allowSeconds;

  // 容错：非数字/负值归零
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) ms = 0;

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (allowSeconds) {
    // 带秒的完整格式
    if (h > 0 && m > 0) return locale === 'en' ? `${h}h ${m}m ${s}s` : `${h} 小时 ${m} 分 ${s} 秒`;
    if (h > 0)          return locale === 'en' ? `${h}h ${s}s`       : `${h} 小时 ${s} 秒`;
    if (m > 0)          return locale === 'en' ? `${m}m ${s}s`       : `${m} 分 ${s} 秒`;
    return locale === 'en' ? `${s}s` : `${s} 秒`;
  }

  // 默认：最小单位 1 分钟
  if (totalSec < 60) {
    return locale === 'en' ? '<1m' : '<1 分钟';
  }

  if (h > 0 && m > 0) return locale === 'en' ? `${h}h ${m}m` : `${h} 小时 ${m} 分钟`;
  if (h > 0)          return locale === 'en' ? `${h}h`       : `${h} 小时`;
  return locale === 'en' ? `${m}m` : `${m} 分钟`;
}

/**
 * 紧凑版——给 tab chip badge 用。永远是最短形式（不用"小时/分钟"这种长词）：
 *   <1m / 5m / 1h / 1h3m
 * locale 参数保留，但紧凑模式下中英文一致（纯符号）。
 */
export function formatDurationCompact(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return '<1m';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}
