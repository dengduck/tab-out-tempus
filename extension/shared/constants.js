/**
 * shared/constants.js
 * --------------------
 * 全局魔法数字 / 常量。SW 和 UI 都引用。
 * 改动这里的值 = 改动产品行为，请同时更新 ARCHITECTURE-v2.md / DECISIONS-v2.md。
 */

// ========== 时间 / 计时相关 ==========

/** TimeTracker 周期性快照间隔（秒）。SW 重启时最多丢这个时间的计时。 */
export const ALARM_PERIOD_S = 30;

/** chrome.idle 键鼠空闲检测默认阈值（秒）。D20：默认 180s，用户可配置。 */
export const IDLE_THRESHOLD_DEFAULT_SEC = 180;

/** BCAST_TICK 广播间隔（毫秒）。仅在有活跃 UI 连接时发送。 */
export const TICK_INTERVAL_MS = 1000;

// ========== Tab 分组规则 ==========

/**
 * Homepages 分组包含的 hostname。
 * 访问路径为根路径（/ 或 /home 等简单路径）时进入 Homepages 分组。
 * 后续在 ui/utils/domain.js 里消费。
 */
export const HOMEPAGE_HOSTS = Object.freeze([
  'gmail.com',
  'mail.google.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'youtube.com',
  'github.com',
]);

// ========== Storage Key 命名 ==========
// 所有 chrome.storage.local / session 的 key 都必须从这里取，不准硬编码字符串。

export const STORAGE_KEY = Object.freeze({
  TIME_LOG_PREFIX: 'timeLog.',            // + 'YYYY-MM'
  TAB_CUMULATIVE: '__tabCumulative',
  ACTIVE_SLICE_SNAPSHOT: '__activeSliceSnapshot',
  SAVED: 'saved',
  PRIVATE_MODE: 'privateMode',
  FOCUS_TIMER: 'focusTimer',
  BLACKLIST: 'blacklist',
  CONFIG: 'config',
  CONFIG_IDLE_THRESHOLD_SEC: 'config.idleThresholdSec',
  // session-only
  HOSTNAME_LAST_FOCUS: '__hostnameLastFocus',
});

// ========== 版本 ==========

/** 当前 storage schema 版本，不兼容变更时递增并写迁移逻辑。 */
export const SCHEMA_VERSION = 2;

/** 日志前缀，方便 console 过滤。 */
export const LOG_PREFIX = '[tempus]';
