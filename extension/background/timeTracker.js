/**
 * D17 单一时间账本：timeLog 是持久真相；tabSessionMs 是今日内存缓存。
 * 只有 finalizeActiveSlice 能对缓存 +=；pauseReasons 非空时禁止开启 slice。
 * active snapshot 仅用于补偿 SW 意外休眠，nowProvider/tabInfoProvider 供测试注入。
 */

import { STORAGE_KEY, LOG_PREFIX, ALARM_PERIOD_S } from '../shared/constants.js';
import { getHostname } from '../shared/hostname.js';
import { localGet, localSet, localRemove } from './store.js';
import { appendSlice, getRange } from './timeLog.js';
import * as tabRegistry from './tabRegistry.js';

/** @typedef {import('../shared/types.js').PauseReason} PauseReason */
/** @typedef {import('../shared/types.js').TrackingState} TrackingState */

// ========== 内部状态 ==========

/** 今日 timeLog 内存缓存：tabId → 已 finalize 毫秒总和。SW 重启时从 timeLog 重建。 @type {Map<number, number>} */
const tabSessionMs = new Map();
/** @type {number | null} */
let activeTabId = null;
/** @type {number | null} */
let activeSliceStart = null;
let activeHostname = '';
let currentDayStart = null;
/** @type {Set<PauseReason>} */
const pauseReasons = new Set();
let nowProvider = () => Date.now();
let emit = null;
/** @type {(tabId:number) => ({url?:string}|null)} */
let tabInfoProvider = (tabId) => tabRegistry.get?.(tabId) || null;
let initialized = false;

// ========== 小工具 ==========

function now() { return nowProvider(); }

function log(...args) {
  console.log(LOG_PREFIX, '[tt]', ...args);
}

/** 从 tabRegistry 取 hostname；未知 tab 返回空串。 */
function hostnameOf(tabId) {
  const info = tabInfoProvider(tabId);
  if (!info) return '';
  return getHostname(info.url || '');
}

/** 能否立即开新 slice：Set 清空 && 有焦点 tab。 */
function canRun() {
  return pauseReasons.size === 0 && activeTabId !== null;
}

/** 本地日期范围；用 setDate 取次日零点，兼容 DST 的 23/25 小时日。 */
function localDayRange(ts) {
  const startDate = new Date(ts);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() };
}

// ========== 核心原子操作 ==========

/** 结算活跃 slice 到 timeLog 和今日缓存；无活跃 slice 时 no-op。 */
function finalizeActiveSlice(endTs = now()) {
  if (activeTabId === null || activeSliceStart === null) return;
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

  // 落盘 slice（普通事件入口不 await；周期 checkpoint 会等待写入完成）
  if (finishedHostname) {
    return appendSlice({ s: startTs, e: endTs, h: finishedHostname, tid: finishedTabId });
  }
  return null;
}

/** canRun() 时开启新 slice；调用方负责先结算旧 slice。 */
function startSlice(startTs = now()) {
  if (!canRun()) return;
  activeSliceStart = startTs;
  activeHostname = hostnameOf(activeTabId);
}

function rolloverDayIfNeeded() {
  const dayStart = localDayRange(now()).start;
  if (currentDayStart === null) currentDayStart = dayStart;
  if (dayStart === currentDayStart) return;

  const wasRunning = activeSliceStart !== null;
  if (wasRunning) finalizeActiveSlice(dayStart);
  tabSessionMs.clear();
  currentDayStart = dayStart;
  if (wasRunning && canRun()) startSlice(dayStart);
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

// ========== 暂停/恢复 ==========
/** @param {PauseReason} reason */
export function pause(reason) {
  if (!reason) return;
  rolloverDayIfNeeded();
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
  rolloverDayIfNeeded();
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

// ========== 事件入口（sw.js 路由） ==========
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
  rolloverDayIfNeeded();

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
  rolloverDayIfNeeded();
  if (tabId === activeTabId) {
    finalizeActiveSlice();
    activeTabId = null;
    activeHostname = '';
    pauseReasons.add('no-active-tab');
  }
  // D17 变化：不再 delete tabSessionMs（关闭的 tab 时间在 timeLog 里保留）
  broadcastStateChange();
}

/** URL 变化致 hostname 切换：旧 slice finalize 到旧 host，新 slice 用新 host。 */
export function onUpdateUrl(tabId, oldUrl, newUrl) {
  if (typeof tabId !== 'number') return;
  rolloverDayIfNeeded();
  if (tabId !== activeTabId) return;  // 非活跃 tab 的 URL 变化不影响计时
  const oldH = getHostname(oldUrl || '');
  const newH = getHostname(newUrl || '');
  if (oldH === newH) return;
  finalizeActiveSlice();
  if (canRun()) startSlice();
}

// ========== 周期性 ==========
/** 长 slice 先结算并轮转，再保存新 slice 快照。 */
export async function tick() {
  rolloverDayIfNeeded();
  const maxSliceMs = ALARM_PERIOD_S * 2 * 1000;
  if (activeSliceStart !== null && now() - activeSliceStart >= maxSliceMs) {
    const write = finalizeActiveSlice();
    if (canRun()) startSlice();
    if (write) await write;
  }
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

/** SW 启动调用：从 timeLog 重建今日 tabSessionMs + 从 snapshot 恢复丢失片段。 */
export async function init(deps = {}) {
  emit = deps.emit || null;
  if (deps.nowProvider) nowProvider = deps.nowProvider;
  if (deps.tabInfoProvider) tabInfoProvider = deps.tabInfoProvider;
  if (initialized) return;
  initialized = true;

  // D17：从 timeLog 今日数据重建 tabSessionMs
  const { start, end } = localDayRange(now());
  currentDayStart = start;
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
      // timeLog 保留完整补偿段；今日缓存只计入本地零点之后的交集。
      const todayDelta = endTs - Math.max(snap.sliceStart, currentDayStart);
      if (todayDelta > 0) {
        const prev = tabSessionMs.get(snap.tabId) || 0;
        tabSessionMs.set(snap.tabId, prev + todayDelta);
      }
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

// ========== 读接口 ==========
/** 单个 tab 今日累计时长 = 缓存 + running slice。 */
export function getTabCumulativeMs(tabId) {
  rolloverDayIfNeeded();
  const base = tabSessionMs.get(tabId) || 0;
  if (tabId === activeTabId && activeSliceStart !== null) {
    return base + (now() - activeSliceStart);
  }
  return base;
}

export function getActiveRunningMs() {
  rolloverDayIfNeeded();
  if (activeTabId === null || activeSliceStart === null) return 0;
  return now() - activeSliceStart;
}

/** "今日工作" = tabSessionMs 总和 + 当前 running slice（不查 storage）。 */
export function getTodayTotalMs() {
  rolloverDayIfNeeded();
  let total = 0;
  for (const ms of tabSessionMs.values()) total += ms;
  total += getActiveRunningMs();
  return total;
}

/** 指定 hostname 下所有 open tab 的今日累计总时长（M5 域名卡 / M6 排行用）。 */
export function getHostnameTotalMsForOpenTabs(hostname) {
  rolloverDayIfNeeded();
  let total = 0;
  for (const [tabId] of tabSessionMs) {
    const info = tabInfoProvider(tabId);
    if (!info) continue;
    if (getHostname(info.url || '') !== hostname) continue;
    total += getTabCumulativeMs(tabId);
  }
  return total;
}

/** 今日域名维度聚合 → {hostname: ms}，数据源 tabSessionMs（M6 历史统计用）。 */
export function getDomainTodayMs() {
  rolloverDayIfNeeded();
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
  rolloverDayIfNeeded();
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
    currentDayStart = null;
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
