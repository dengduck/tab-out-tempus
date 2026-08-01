/**
 * D17 单一时间账本：timeLog 是持久真相；tabSessionMs 是今日内存缓存。
 * 只有 finalizeActiveSlice 能对缓存 +=；pauseReasons 非空时禁止开启 slice。
 * active snapshot 仅用于补偿 SW 意外休眠，nowProvider/tabInfoProvider 供测试注入。
 */

import { STORAGE_KEY, LOG_PREFIX, ALARM_PERIOD_S } from '../shared/constants.js';
import { getHostname } from '../shared/hostname.js';
import { localRemove } from './store.js';
import { appendSlice, getRange, flush as flushTimeLog } from './timeLog.js';
import * as persistence from './timeTrackerPersistence.js';
import * as tabRegistry from './tabRegistry.js';

/** @typedef {import('../shared/types.js').PauseReason} PauseReason */
/** @typedef {import('../shared/types.js').TrackingState} TrackingState */

// ========== 内部状态 ==========
/** 今日 timeLog 缓存：tabId → 已结算毫秒。 @type {Map<number, number>} */
const tabSessionMs = new Map();
const domainSessionMs = new Map();
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
function log(...args) { console.log(LOG_PREFIX, '[tt]', ...args); }
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
/** 结算活跃 slice 到 timeLog 和今日缓存。 */
function finalizeActiveSlice(endTs = now()) {
  if (activeTabId === null || activeSliceStart === null) return;
  const startTs = activeSliceStart;
  const delta = endTs - startTs;

  const finishedTabId = activeTabId;
  const finishedHostname = activeHostname;
  activeSliceStart = null; // activeTabId 仍表示焦点 tab
  if (delta <= 0) return;

  // 缓存只允许 +=
  const prev = tabSessionMs.get(finishedTabId) || 0;
  tabSessionMs.set(finishedTabId, prev + delta);
  if (finishedHostname) {
    domainSessionMs.set(finishedHostname, (domainSessionMs.get(finishedHostname) || 0) + delta);
  }

  if (!finishedHostname) return null;
  return persistence.queueSlice({ s: startTs, e: endTs, h: finishedHostname, tid: finishedTabId });
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
  domainSessionMs.clear();
  currentDayStart = dayStart;
  if (wasRunning && canRun()) startSlice(dayStart);
}

function activeSnapshot() {
  return { tabId: activeTabId, hostname: activeHostname, sliceStart: activeSliceStart };
}

function persistSoon() {
  void persistence.persist(activeSnapshot())
    .catch((err) => console.error(LOG_PREFIX, 'snapshot persist failed', err));
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
  if (!wasPaused) finalizeActiveSlice();
  persistSoon();
  broadcastStateChange();
}

/** @param {PauseReason} reason */
export function resume(reason) {
  if (!reason) return;
  rolloverDayIfNeeded();
  if (!pauseReasons.has(reason)) return;
  pauseReasons.delete(reason);
  if (pauseReasons.size === 0 && activeTabId !== null && activeSliceStart === null) startSlice();
  persistSoon();
  broadcastStateChange();
}

export function isPausedBy(reason) { return pauseReasons.has(reason); }
export function getPauseReasons() { return Array.from(pauseReasons); }

// ========== 事件入口（sw.js 路由） ==========
/** 窗口焦点变化；active tab 由 onActivateTab 驱动。 */
export function onFocusWindow(windowId) {
  if (windowId === null || windowId === undefined || windowId === chrome.windows.WINDOW_ID_NONE) {
    pause('window-blur');
  } else {
    resume('window-blur');
  }
}

/** tab 激活：结算旧 slice，换目标，未暂停时开启新 slice。 */
export function onActivateTab(tabId, _windowId) {
  if (typeof tabId !== 'number') return;
  rolloverDayIfNeeded();

  finalizeActiveSlice();
  activeTabId = tabId;
  activeHostname = '';

  if (canRun()) {
    startSlice();
  } else {
    if (pauseReasons.has('no-active-tab')) {
      pauseReasons.delete('no-active-tab');
      if (canRun() && activeSliceStart === null) startSlice();
    }
  }
  persistSoon();
}

/** tab 关闭时结算最后一段；缓存保留已关闭 tab 的今日时间。 */
export function onRemoveTab(tabId) {
  if (typeof tabId !== 'number') return;
  rolloverDayIfNeeded();
  if (tabId === activeTabId) {
    finalizeActiveSlice();
    activeTabId = null;
    activeHostname = '';
    pauseReasons.add('no-active-tab');
  }
  persistSoon();
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
  persistSoon();
}

// ========== 周期性 ==========
/** 强制结算并轮转当前 slice，用于导出和持久化边界。 */
export async function checkpoint() {
  rolloverDayIfNeeded();
  if (activeSliceStart !== null) {
    const write = finalizeActiveSlice();
    if (canRun()) startSlice();
    if (write) await write;
  }
  await persistence.flushPending();
  await persistence.persist(activeSnapshot());
}

/** 长 slice 先结算并轮转，再保存新 slice 快照。 */
export async function tick() {
  rolloverDayIfNeeded();
  const maxSliceMs = ALARM_PERIOD_S * 2 * 1000;
  if (activeSliceStart !== null && now() - activeSliceStart >= maxSliceMs) {
    await checkpoint();
    return;
  }
  await persistence.flushPending();
  await persistence.persist(activeSnapshot());
}

/** 历史清理事务：暂停计时并确保已完成 slice 全部落盘。 */
export async function beginHistoryClear() {
  pause('history-clear');
  await persistence.flushPending();
  await flushTimeLog();
  await persistence.clearSnapshot();
}

/** 清理完成后重置今日缓存并恢复计时。 */
export function finishHistoryClear() {
  tabSessionMs.clear();
  domainSessionMs.clear();
  currentDayStart = localDayRange(now()).start;
  resume('history-clear');
}

export function abortHistoryClear() {
  resume('history-clear');
}

function cacheRecoveredSlice(slice, dayStart, dayEnd) {
  const duration = Math.min(slice.e, dayEnd) - Math.max(slice.s, dayStart);
  if (duration <= 0) return;
  if (typeof slice.tid === 'number') {
    tabSessionMs.set(slice.tid, (tabSessionMs.get(slice.tid) || 0) + duration);
  }
  if (slice.h) domainSessionMs.set(slice.h, (domainSessionMs.get(slice.h) || 0) + duration);
}

/** SW 启动调用：从 timeLog 重建今日缓存 + 从 snapshot 恢复丢失片段。 */
export async function init(deps = {}) {
  emit = deps.emit || null;
  if (deps.nowProvider) nowProvider = deps.nowProvider;
  if (deps.tabInfoProvider) tabInfoProvider = deps.tabInfoProvider;
  if (initialized) return;
  tabSessionMs.clear();
  domainSessionMs.clear();
  persistence.reset();
  pauseReasons.clear();

  // D17：从 timeLog 今日数据重建 tabSessionMs
  const { start, end } = localDayRange(now());
  currentDayStart = start;
  const todaySlices = await getRange(start, end);
  for (const sl of todaySlices) {
    const duration = sl.e - sl.s;
    if (typeof sl.tid === 'number') {
      const prev = tabSessionMs.get(sl.tid) || 0;
      tabSessionMs.set(sl.tid, prev + duration);
    }
    if (sl.h) domainSessionMs.set(sl.h, (domainSessionMs.get(sl.h) || 0) + duration);
  }

  const snap = await persistence.loadSnapshot();
  if (snap) {
    for (const candidate of Array.isArray(snap.pending) ? snap.pending : []) {
      if (!candidate?.h || candidate.e <= candidate.s) continue;
      const slice = { ...candidate, id: candidate.id || persistence.sliceId(candidate) };
      if (await appendSlice(slice)) cacheRecoveredSlice(slice, start, end);
    }
    if (typeof snap.sliceStart === 'number' && typeof snap.tabId === 'number' && snap.hostname) {
      const endTs = Math.min(now(), snap.sliceStart + ALARM_PERIOD_S * 2 * 1000);
      if (endTs > snap.sliceStart) {
        const slice = { s: snap.sliceStart, e: endTs, h: snap.hostname, tid: snap.tabId };
        slice.id = persistence.sliceId(slice);
        if (await appendSlice(slice)) cacheRecoveredSlice(slice, start, end);
      }
    }
    await persistence.clearSnapshot();
  }

  pauseReasons.add('no-active-tab');
  try { await localRemove(STORAGE_KEY.TAB_CUMULATIVE); } catch (_) { /* legacy cleanup is best effort */ }
  initialized = true;
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
  const result = Object.fromEntries(domainSessionMs);
  if (activeTabId !== null && activeSliceStart !== null) {
    const host = activeHostname || hostnameOf(activeTabId);
    if (host) result[host] = (result[host] || 0) + (now() - activeSliceStart);
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
    domainSessionMs.clear();
    persistence.reset();
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
