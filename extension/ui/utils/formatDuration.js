/**
 * ui/utils/formatDuration.js
 * ---------------------------
 * 时长（毫秒）→ 人读格式字符串。
 *
 * 默认规则：最小单位 1 分钟。小于 1 分钟显示 "<1m" / "<1分钟"。
 * opt-in: {allowSeconds: true} 可显示秒级（当前无调用者）。
 *
 * 里程碑：M5。
 */

/**
 * @param {number} ms
 * @param {Object} [opts]
 * @param {boolean} [opts.allowSeconds=false]
 * @param {'en'|'zh'} [opts.locale='zh']
 */
export function formatDuration(_ms, _opts = {}) {
  // stub, M5
  return '';
}
