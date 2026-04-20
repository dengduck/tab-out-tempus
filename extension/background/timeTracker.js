/**
 * background/timeTracker.js
 * --------------------------
 * ✨ v2 时间追踪核心（M4.5 D17 单一时间账本模型）。
 *
 * **timeLog 是唯一持久真相源。**
 * tabSessionMs 是纯内存缓存（= 今日 timeLog 按 tid 聚合），
 * SW 重启时从 timeLog 重建，不持久化。
 *
 * 铁律：
 *   1. timeLog.appendSlice 是唯一持久化时间数据的方式。
 *   2. tabSessionMs 是 timeLog 的内存影子，只在 finalizeActiveSlice 时 `+=`。
 *      禁止赋值覆盖（init 重建例外）。
 *   3. pauseReasons 非空 → 绝对不开新 slice。恢复前提：Set 清空 && 有焦点 tab。
 *   4. finalize 要么把 slice 写掉，要么什么都不做；不允许留"半个 slice"。
 *
 * 数据源 & 边界：
 *   - hostname 从 tabInfoProvider(tabId).url 提取（shared/hostname.js）
 *   - 写 timeLog 通过 timeLog.appendSlice（串行化）
 *   - 持久化仅 __activeSliceSnapshot（30s 周期，防 SW 睡死丢时间）
 *   - 时间注入：nowProvider 允许测试里替换 Date.now
 *
 * 里程碑：M4 → M4.5（D17 收敛）。
 */

import { STORAGE_KEY, LOG_PREFIX, ALARM_PERIOD_S } from '../shared/constants.js';
import { getHostname } from '../shared/hostname.js';
import { localGet, localSet, localRemove } from './store.js';
import { appendSlice, getRange } from './timeLog.js';
import * as tabRegistry from './tabRegistry.js';

/** @typedef {import('../shared/types.js').PauseReason} PauseReason */
/** @typedef {import('../shared/types.js').TrackingState} TrackingState */

// ========== 内部状态 ==========

/**
 * 今日 timeLog 的内存缓存：tabId → 今日已 finalize 的毫秒总和。
 * 纯内存，不持久化。SW 重启时从 timeLog 重建。
 * @type {Map<number, number>}
 */
const tabSessionMs = new Map();

/** 当前正在计时的 tab id；null = 暂停中。 @type {number | null} */
let activeTabId = null;

/** 当前 slice 的起点时间戳（ms）；null = 没有活跃 slice。 @type {number | null} */
let activeSliceStart = null;

/** 当前 active tab 的 hostname（finalize 时写 timeLog 用）。 */
let activeHostname = '';

/** 暂停原因集合。Set.size > 0 即暂停。 @type {Set<PauseReason>} */
const pauseReasons = new Set();

/** 注入的"现在"。测试里替换成 mock。 */
let nowProvider = () => Date.now();

/** 注入的广播 emitter（SW 装载时注入；测试时可为 null）。 */
let emit = null;

/**
 * 注入的 tab 元数据查询。默认用 tabRegistry.get；测试可替换。
 * @type {(tabId:number) => ({url?:string}|null)}
 */
let tabInfoProvider = (tabId) => tabRegistry.get?.(tabId) || null;

/** 是否已初始化（防重入）。 */
let initialized = false;

// ========== 小工具 ==========

function now() { return nowProvider(); }

function log(...args) {
  console.log(LOG_PREFIX, '[tt]', ...args);
}

/**
 * 把给定 tab 的 hostname 从 tabRegistry 里查出来。
 * Tab 不在注册表（已关闭）时返回空串——调用方要容忍。
 */
function hostnameOf(tabId) {
  const info = tabInfoProvider(tabId);
  if (!info) return '';
  return getHostname(info.url || '');
}

/** 能否立即开新 slice：Set 清空 && 有焦点 tab。 */
function canRun() {
  return pauseReasons.size === 0 && activeTabId !== null;
}

/** 今日本地时间 0:00 ~ 24:00 的 UTC 毫秒范围。 */
function localDayRange(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return { start, end: start + 24 * 3600 * 1000 };
}

// ========== 核心原子操作 ==========

/**
 * finalize 当前活跃 slice：把 [activeSliceStart, now] 写 timeLog，并 += 到 tabSessionMs 缓存。
 * 没有活跃 slice 时 no-op。
 */
function finalizeActiveSlice() {
  if (activeTabId === null || activeSliceStart === null) return;
  const endTs = now();
  const startTs = activeSliceStart;
  const delta = endTs - startTs;

  // 关掉状态（无论 delta 是否合法，都要关）
  const finishedTabId = activeTabId;
  const finishedHostname = activeHostname;
  activeSliceStart = null;
  // 注意：这里不清 activeTabId。activeTabId 表示"焦点 tab 是谁"，
  // 它由 onActivateTab / onFocusWindow 显式改；finalize 只关 slice。

  if (delta <= 0) return;  // 时钟回拨或同毫秒事件

  // 更新内存缓存（铁律 #2：只 +=）
  const prev = tabSessionMs.get(finishedTabId) || 0;
  tabSessionMs.set(finishedTabId, prev + delta);

  // 落盘 slice（串行化队列；不 await，让 caller 快）
  if (finishedHostname) {
    appendSlice({ s: startTs, e: endTs, h: finishedHostname, tid: finishedTabId });
  }
}

/**
 * 开启新 slice。前置条件：canRun() === true。
 * 调用方负责先 finalize 老 slice。
 */
function startSlice() {
  if (!canRun()) return;
  activeSliceStart = now();
  activeHostname = hostnameOf(activeTabId);
}

function broadcastStateChange() {
  if (typeof emit === 'function') {
    try {
      emit('BCAST_STATE_CHANGE', {
        pauseReasons: Array.from(pauseReasons),
        tracking: getTrackingState(),
      });
    } catch (_) { /* ignore */ }
  }
}

// ========== 公共 API：暂停/恢复 ==========

/** @param {PauseReason} reason */
export function pause(reason) {
  if (!reason) return;
  const wasPaused = pauseReasons.size > 0;
  pauseReasons.add(reason);
  // 第一次进入暂停：finalize
  if (!wasPaused) {
    finalizeActiveSlice();
  }
  broadcastStateChange();
}

/** @param {PauseReason} reason */
export function resume(reason) {
  if (!reason) return;
  if (!pauseReasons.has(reason)) return;
  pauseReasons.delete(reason);
  // 最后一个 reason 解除 & 有焦点 tab → 开新 slice
  if (pauseReasons.size === 0 && activeTabId !== null && activeSliceStart === null) {
    startSlice();
  }
  broadcastStateChange();
}

export function isPausedBy(reason) {
  return pauseReasons.has(reason);
}

export function getPauseReasons() {
  return Array.from(pauseReasons);
}

// ========== 公共 API：事件入口（sw.js 路由） ==========

/**
 * 窗口焦点变化。windowId === null / WINDOW_ID_NONE 表示 Chrome 失焦。
 * 这里只管 'window-blur' reason；具体 active tab 由 onActivateTab 驱动。
 */
export function onFocusWindow(windowId) {
  if (windowId === null || windowId === undefined || windowId === chrome.windows.WINDOW_ID_NONE) {
    pause('window-blur');
  } else {
    resume('window-blur');
  }
}

/**
 * tab 激活。切换活跃 tab = finalize 老 slice + 换目标 + 开新 slice（若未暂停）。
 * @param {number} tabId
 * @param {number} [_windowId]
 */
export function onActivateTab(tabId, _windowId) {
  if (typeof tabId !== 'number') return;

  // 换目标前先 finalize 老的
  finalizeActiveSlice();

  activeTabId = tabId;
  activeHostname = '';  // 先清，startSlice 里再取

  // 若没被任何 reason 暂停 → 开新 slice
  // 否则 no-op：activeTabId 已更新，pauseReasons 清空后 resume 会自然启动
  if (canRun()) {
    startSlice();
  } else {
    // no-active-tab reason 在此处该清（因为现在有 active tab 了）
    if (pauseReasons.has('no-active-tab')) {
      pauseReasons.delete('no-active-tab');
      if (canRun() && activeSliceStart === null) startSlice();
    }
  }
}

/**
 * tab 关闭。finalize 最后一段。
 * D17：不清 tabSessionMs（timeLog 天然保留已关闭 tab 的记录）。
 */
export function onRemoveTab(tabId) {
  if (typeof tabId !== 'number') return;
  if (tabId === activeTabId) {
    finalizeActiveSlice();
    activeTabId = null;
    activeHostname = '';
    pauseReasons.add('no-active-tab');
  }
  // D17 变化：不再 delete tabSessionMs（关闭的 tab 时间在 timeLog 里保留）
  broadcastStateChange();
}

/**
 * URL 变化可能意味着 hostname 切换。旧 slice finalize 到旧 hostname，新 slice 用新 hostname。
 */
export function onUpdateUrl(tabId, oldUrl, newUrl) {
  if (typeof tabId !== 'number') return;
  if (tabId !== activeTabId) return;  // 非活跃 tab 的 URL 变化不影响计时
  const oldH = getHostname(oldUrl || '');
  const newH = getHostname(newUrl || '');
  if (oldH === newH) return;
  finalizeActiveSlice();
  if (canRun()) startSlice();
}

// ========== 公共 API：周期性 ==========

/**
 * 30s 周期 tick：持久化 active slice snapshot（防 SW 睡死）。
 * D17：不再持久化 tabCumulative（时间真相在 timeLog）。
 */
export async function tick() {
  await persistSnapshot();
}

async function persistSnapshot() {
  // active slice snapshot（SW 重启时用来 finalize 丢失的时间）
  if (activeTabId !== null && activeSliceStart !== null) {
    await localSet(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT, {
      tabId: activeTabId,
      hostname: activeHostname,
      sliceStart: activeSliceStart,
    });
  } else {
    await localRemove(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
  }

  // D17 迁移：清理 v1 遗留的 __tabCumulative 数据（一次性）
  try {
    await localRemove(STORAGE_KEY.TAB_CUMULATIVE);
  } catch (_) { /* ignore */ }
}

/**
 * SW 启动调用。
 *   - 从 timeLog 今日数据重建 tabSessionMs（D17：timeLog 是唯一真相）
 *   - 从 __activeSliceSnapshot 恢复"丢失的片段"
 */
export async function init(deps = {}) {
  emit = deps.emit || null;
  if (deps.nowProvider) nowProvider = deps.nowProvider;
  if (deps.tabInfoProvider) tabInfoProvider = deps.tabInfoProvider;
  if (initialized) return;
  initialized = true;

  // D17：从 timeLog 今日数据重建 tabSessionMs
  const { start, end } = localDayRange(now());
  const todaySlices = await getRange(start, end);
  for (const sl of todaySlices) {
    if (typeof sl.tid === 'number') {
      const prev = tabSessionMs.get(sl.tid) || 0;
      tabSessionMs.set(sl.tid, prev + (sl.e - sl.s));
    }
  }

  // 恢复丢失 slice（SW 睡死期间的时间补偿）
  const snap = await localGet(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
  if (snap && typeof snap.sliceStart === 'number' && typeof snap.tabId === 'number') {
    const cap = snap.sliceStart + ALARM_PERIOD_S * 2 * 1000;
    const endTs = Math.min(now(), cap);
    const delta = endTs - snap.sliceStart;
    if (delta > 0) {
      // 更新内存缓存
      const prev = tabSessionMs.get(snap.tabId) || 0;
      tabSessionMs.set(snap.tabId, prev + delta);
      // 写 timeLog
      if (snap.hostname) {
        appendSlice({ s: snap.sliceStart, e: endTs, h: snap.hostname, tid: snap.tabId });
      }
    }
    await localRemove(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
  }

  // 初始状态：尚未收到任何 activate / focus 事件 → no-active-tab
  pauseReasons.add('no-active-tab');

  log('init done, today sessions =', tabSessionMs.size, 'tabs');
}

// ========== 公共 API：读接口 ==========

/**
 * 单个 tab 今日累计时长。= tabSessionMs 缓存 + (活跃 tab 的 running slice)。
 * API 语义不变（UI 层无感）。
 */
export function getTabCumulativeMs(tabId) {
  const base = tabSessionMs.get(tabId) || 0;
  if (tabId === activeTabId && activeSliceStart !== null) {
    return base + (now() - activeSliceStart);
  }
  return base;
}

export function getActiveRunningMs() {
  if (activeTabId === null || activeSliceStart === null) return 0;
  return now() - activeSliceStart;
}

/**
 * "今日工作"= 今日 timeLog 聚合 + 当前 running slice。
 * 优化：用 tabSessionMs 总和代替每次查 storage。
 */
export function getTodayTotalMs() {
  let total = 0;
  for (const ms of tabSessionMs.values()) total += ms;
  total += getActiveRunningMs();
  return total;
}

/**
 * 指定 hostname 下所有 open tab 的今日累计总时长。
 * （M5 域名卡聚合时长 / M6 域名排行 都用这个）
 */
export function getHostnameTotalMsForOpenTabs(hostname) {
  let total = 0;
  for (const [tabId] of tabSessionMs) {
    const info = tabInfoProvider(tabId);
    if (!info) continue;
    if (getHostname(info.url || '') !== hostname) continue;
    total += getTabCumulativeMs(tabId);
  }
  return total;
}

/**
 * 今日域名维度聚合：返回 {hostname: ms} 字典。
 * 数据来源是 timeLog 缓存（tabSessionMs），不再额外查 storage。
 * 给 M6 历史统计用。
 */
export function getDomainTodayMs() {
  const result = {};
  for (const [tabId, ms] of tabSessionMs) {
    const info = tabInfoProvider(tabId);
    const host = info ? getHostname(info.url || '') : '';
    if (!host) continue;
    result[host] = (result[host] || 0) + ms;
  }
  // 加上 running slice
  if (activeTabId !== null && activeSliceStart !== null) {
    const host = activeHostname || hostnameOf(activeTabId);
    if (host) {
      result[host] = (result[host] || 0) + (now() - activeSliceStart);
    }
  }
  return result;
}

/** @returns {TrackingState} */
export function getTrackingState() {
  return {
    isActive: canRun() && activeSliceStart !== null,
    activeTabId,
    pauseReasons: Array.from(pauseReasons),
    sliceStart: activeSliceStart,
  };
}

// ========== 测试钩子（仅测试代码使用） ==========

export const __testing = {
  reset() {
    tabSessionMs.clear();
    activeTabId = null;
    activeSliceStart = null;
    activeHostname = '';
    pauseReasons.clear();
    nowProvider = () => Date.now();
    tabInfoProvider = (tabId) => tabRegistry.get?.(tabId) || null;
    emit = null;
    initialized = false;
  },
  setNowProvider(fn) { nowProvider = fn; },
  setTabInfoProvider(fn) { tabInfoProvider = fn; },
  setInitialized(b) { initialized = b; },
  getSessionMap() { return new Map(tabSessionMs); },
  getInternalActiveTabId() { return activeTabId; },
  getInternalSliceStart() { return activeSliceStart; },
  forceStart({ tabId, hostname, sliceStart }) {
    activeTabId = tabId;
    activeHostname = hostname;
    activeSliceStart = sliceStart;
  },
};
