/**
 * background/timeTracker.js
 * --------------------------
 * ✨ v2 时间追踪核心。**唯一**能修改 tabCumulativeMs 的地方。
 *
 * 铁律（违反即 v1 时代的 bug 借尸还魂）：
 *   1. tabCumulativeMs 只允许 +=；禁止赋值、禁止减少。唯一例外：init 从 snapshot 恢复时的"初始化赋值"。
 *   2. pauseReasons 非空 → 绝对不开新 slice。恢复的前提是 Set 清空 且 有焦点 tab。
 *   3. 所有"暂停行为"必须走 pause(reason) / resume(reason)；禁止绕过 Set 直接改 activeTabId。
 *   4. finalize 要么把 slice 写掉，要么什么都不做；不允许留"半个 slice"。
 *
 * 数据源 & 边界：
 *   - hostname 从 tabRegistry.get(tabId).url 提取（shared/hostname.js）
 *   - 写 timeLog 通过 timeLog.appendSlice（串行化）
 *   - 持久化通过 store（__tabCumulative + __activeSliceSnapshot）
 *   - 时间注入：nowProvider 允许测试里替换 Date.now（默认用 Date.now）
 *
 * 里程碑：M4。
 */

import { STORAGE_KEY, LOG_PREFIX, ALARM_PERIOD_S } from '../shared/constants.js';
import { getHostname } from '../shared/hostname.js';
import { localGet, localSet, localRemove } from './store.js';
import { appendSlice, getRange } from './timeLog.js';
import * as tabRegistry from './tabRegistry.js';

/** @typedef {import('../shared/types.js').PauseReason} PauseReason */
/** @typedef {import('../shared/types.js').TrackingState} TrackingState */

// ========== 内部状态 ==========

/** 单调累计器。唯一允许的写操作是 `+=`。 @type {Map<number, number>} */
const tabCumulativeMs = new Map();

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

// ========== 核心原子操作 ==========

/**
 * finalize 当前活跃 slice：把 [activeSliceStart, now] 写 timeLog，并 += 到 cumulative。
 * 没有活跃 slice 时 no-op。**单调性由这个函数独家保证。**
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

  // 单调累加（铁律 #1）
  const prev = tabCumulativeMs.get(finishedTabId) || 0;
  tabCumulativeMs.set(finishedTabId, prev + delta);

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
 * tab 关闭。finalize 最后一段，清 cumulative（可选；保留可用于"关了 30s 再开"场景，
 * 但 v2 的语义是"每 tab 从打开到关闭的 lifetime"，关了就归零）。
 */
export function onRemoveTab(tabId) {
  if (typeof tabId !== 'number') return;
  if (tabId === activeTabId) {
    finalizeActiveSlice();
    activeTabId = null;
    activeHostname = '';
    pauseReasons.add('no-active-tab');
  }
  tabCumulativeMs.delete(tabId);
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
 * 30s 周期 tick：
 *   1. 把当前活跃 slice 做一次"快照 finalize"（不真的关 slice，只写 snapshot 让 SW 重启能续）
 *   2. 刷一份 __tabCumulative 到 storage
 * 设计选择：不真的 finalize 然后 start（那样会切得碎）；只记录 snapshot。
 */
export async function tick() {
  await persistSnapshot();
}

async function persistSnapshot() {
  // cumulative
  const dump = {};
  for (const [k, v] of tabCumulativeMs) dump[k] = v;
  await localSet(STORAGE_KEY.TAB_CUMULATIVE, dump);

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
}

/**
 * SW 启动调用。
 *   - 从 __tabCumulative 恢复累计（初始化赋值，铁律 #1 的唯一例外）
 *   - 从 __activeSliceSnapshot 恢复"丢失的片段"：把 [sliceStart, min(now, sliceStart + ALARM_PERIOD_S*2)] 算成有效
 *     （上限 ALARM_PERIOD_S*2 是防御：万一 SW 睡了太久，不把用户实际离开的时间也算上）
 */
export async function init(deps = {}) {
  emit = deps.emit || null;
  if (deps.nowProvider) nowProvider = deps.nowProvider;
  if (deps.tabInfoProvider) tabInfoProvider = deps.tabInfoProvider;
  if (initialized) return;
  initialized = true;

  // 恢复 cumulative
  const dump = await localGet(STORAGE_KEY.TAB_CUMULATIVE);
  if (dump && typeof dump === 'object') {
    for (const k of Object.keys(dump)) {
      const id = Number(k);
      const v = Number(dump[k]);
      if (Number.isFinite(id) && Number.isFinite(v) && v >= 0) {
        tabCumulativeMs.set(id, v);
      }
    }
  }

  // 恢复丢失 slice
  const snap = await localGet(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
  if (snap && typeof snap.sliceStart === 'number' && typeof snap.tabId === 'number') {
    const cap = snap.sliceStart + ALARM_PERIOD_S * 2 * 1000;
    const endTs = Math.min(now(), cap);
    const delta = endTs - snap.sliceStart;
    if (delta > 0) {
      const prev = tabCumulativeMs.get(snap.tabId) || 0;
      tabCumulativeMs.set(snap.tabId, prev + delta);
      if (snap.hostname) {
        appendSlice({ s: snap.sliceStart, e: endTs, h: snap.hostname, tid: snap.tabId });
      }
    }
    await localRemove(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
  }

  // 初始状态：尚未收到任何 activate / focus 事件 → no-active-tab
  pauseReasons.add('no-active-tab');

  log('init done, restored tabs =', tabCumulativeMs.size);
}

// ========== 公共 API：读接口 ==========

export function getTabCumulativeMs(tabId) {
  const base = tabCumulativeMs.get(tabId) || 0;
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
 * 为了不让本函数每次都查一次 storage（UI 1s 一次 tick），内部做了粗缓存：
 *   1s 内复用同一份 historical 数据。
 */
let todayCache = { ts: 0, historicalMs: 0 };

export async function getTodayTotalMs() {
  const { start, end } = localDayRange(now());
  const nowTs = now();
  if (nowTs - todayCache.ts < 1000) {
    return todayCache.historicalMs + getActiveRunningMs();
  }
  const slices = await getRange(start, end);
  let hist = 0;
  for (const sl of slices) hist += sl.e - sl.s;
  todayCache = { ts: nowTs, historicalMs: hist };
  return hist + getActiveRunningMs();
}

function localDayRange(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return { start, end: start + 24 * 3600 * 1000 };
}

export function getHostnameTotalMsForOpenTabs(hostname) {
  let total = 0;
  for (const [tabId] of tabCumulativeMs) {
    const info = tabInfoProvider(tabId);
    if (!info) continue;
    if (getHostname(info.url || '') !== hostname) continue;
    total += getTabCumulativeMs(tabId);
  }
  return total;
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
    tabCumulativeMs.clear();
    activeTabId = null;
    activeSliceStart = null;
    activeHostname = '';
    pauseReasons.clear();
    nowProvider = () => Date.now();
    tabInfoProvider = (tabId) => tabRegistry.get?.(tabId) || null;
    emit = null;
    initialized = false;
    todayCache = { ts: 0, historicalMs: 0 };
  },
  setNowProvider(fn) { nowProvider = fn; },
  setTabInfoProvider(fn) { tabInfoProvider = fn; },
  setInitialized(b) { initialized = b; },
  getCumulativeMap() { return new Map(tabCumulativeMs); },
  getInternalActiveTabId() { return activeTabId; },
  getInternalSliceStart() { return activeSliceStart; },
  forceStart({ tabId, hostname, sliceStart }) {
    activeTabId = tabId;
    activeHostname = hostname;
    activeSliceStart = sliceStart;
  },
};
