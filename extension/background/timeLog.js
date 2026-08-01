/**
 * background/timeLog.js
 * ----------------------
 * 按月分片的 timeLog 存储。Key 形如 `timeLog.2026-04` → Array<TimeSlice>。
 *
 * 关键约束：
 *   - appendSlice 必须串行化（v1 踩过并发竞争丢 slice 的坑）
 *     实现方式：一个单 Promise chain，所有写入 await 前一个
 *   - queryRange 只读，不需要排队
 *   - 跨月 slice（罕见）在 appendSlice 里切成两段
 *
 * 里程碑：M4。
 */

import { localGet, localSet } from './store.js';
import { STORAGE_KEY, LOG_PREFIX } from '../shared/constants.js';

/** @typedef {import('../shared/types.js').TimeSlice} TimeSlice */

/** 串行写入队列。Promise chain 模式：新任务 await 前一个 Promise。 */
let writeQueue = Promise.resolve();

/**
 * 将读写任务串到队尾。调用方收到原始失败，队列本身吞掉失败后可继续工作。
 * @template T
 * @param {() => Promise<T>} task
 * @param {string} label
 * @returns {Promise<T>}
 */
function enqueue(task, label) {
  const operation = writeQueue.then(task);
  writeQueue = operation.catch((err) => {
    console.error(LOG_PREFIX, `${label} failed`, err);
  });
  return operation;
}

function isTimeLogKey(key) {
  return typeof key === 'string' && key.startsWith(STORAGE_KEY.TIME_LOG_PREFIX);
}

/** 返回 UTC 时间戳对应的 'YYYY-MM' 分片 key（用本地时间取月份，和用户感官对齐）。 */
function shardOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function shardKey(yearMonth) {
  return STORAGE_KEY.TIME_LOG_PREFIX + yearMonth;
}

/** 计算跨月拆分：返回 [{ym, slice}, ...]。99.99% 情况下返回长度 1。 */
function splitByMonth(slice) {
  const startYm = shardOf(slice.s);
  const endYm = shardOf(slice.e);
  if (startYm === endYm) return [{ ym: startYm, slice }];
  // 跨月：切在 endYm 月初的 0:00（本地时间）
  const endMonthStart = new Date(slice.e);
  endMonthStart.setDate(1);
  endMonthStart.setHours(0, 0, 0, 0);
  const cut = endMonthStart.getTime();
  // 防御：cut 必须严格落在 (s, e) 内
  if (cut <= slice.s || cut >= slice.e) return [{ ym: startYm, slice }];
  return [
    { ym: startYm, slice: { ...slice, e: cut } },
    { ym: endYm, slice: { ...slice, s: cut } },
  ];
}

/**
 * 追加一条 slice 到月分片。串行化。
 * @param {TimeSlice} slice
 */
export async function appendSlice(slice) {
  if (!slice || typeof slice.s !== 'number' || typeof slice.e !== 'number') return;
  if (slice.e <= slice.s) return;  // 空/负长度丢弃
  if (!slice.h) slice.h = '';

  const task = async () => {
    const parts = splitByMonth(slice);
    let inserted = 0;
    for (const { ym, slice: s } of parts) {
      const key = shardKey(ym);
      const cur = (await localGet(key)) || [];
      if (s.id && cur.some((item) => item.id === s.id && item.s === s.s && item.e === s.e)) continue;
      cur.push({
        s: s.s, e: s.e, h: s.h,
        ...(typeof s.tid === 'number' ? { tid: s.tid } : {}),
        ...(s.id ? { id: s.id } : {}),
      });
      await localSet(key, cur);
      inserted++;
    }
    return inserted;
  };

  return enqueue(task, 'appendSlice');
}

/**
 * 查询区间（跨月聚合）。
 * @param {number} startTs  UTC 毫秒
 * @param {number} endTs    UTC 毫秒
 * @returns {Promise<Array<TimeSlice>>}
 */
export async function getRange(startTs, endTs) {
  if (endTs <= startTs) return [];
  const startYm = shardOf(startTs);
  const endYm = shardOf(endTs);
  const shards = enumerateMonths(startYm, endYm);
  const result = [];
  for (const ym of shards) {
    const arr = (await localGet(shardKey(ym))) || [];
    for (const sl of arr) {
      // 区间相交判断（半开区间 [s, e)）
      if (sl.e > startTs && sl.s < endTs) {
        // 裁剪到区间内
        const s = Math.max(sl.s, startTs);
        const e = Math.min(sl.e, endTs);
        if (e > s) result.push({
          s, e, h: sl.h,
          ...(typeof sl.tid === 'number' ? { tid: sl.tid } : {}),
          ...(sl.id ? { id: sl.id } : {}),
        });
      }
    }
  }
  return result;
}

/** 枚举 [startYm, endYm]（含）之间的所有 'YYYY-MM'。 */
function enumerateMonths(startYm, endYm) {
  const [sy, sm] = startYm.split('-').map(Number);
  const [ey, em] = endYm.split('-').map(Number);
  const out = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length > 600) break;  // 50 年保险绳
  }
  return out;
}

/** 等待调用时已经排入的所有任务结束。 */
export async function awaitQueue() {
  await writeQueue;
}

/** 返回全部 timeLog 分片内容，且不读取其他 key 的值。 */
export function exportAll() {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(null);
    const slices = [];
    for (const key of Object.keys(stored).filter(isTimeLogKey).sort()) {
      const shard = stored[key];
      if (!Array.isArray(shard)) continue;
      for (const slice of shard) slices.push({ ...slice });
    }
    slices.sort((a, b) => (a.s - b.s) || (a.e - b.e));
    return slices;
  }, 'exportAll');
}

/** 删除全部且仅删除 timeLog.* key。返回删除的分片 key 数。 */
export function clearAll() {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored).filter(isTimeLogKey);
    if (keys.length > 0) await chrome.storage.local.remove(keys);
    return keys.length;
  }, 'clearAll');
}

/**
 * 删除 cutoff 之前的数据；跨过 cutoff 的 slice 从 cutoff 开始保留。
 * 返回被删除或裁剪的 slice 数。
 * @param {number} cutoff
 */
export function pruneBefore(cutoff) {
  if (!Number.isFinite(cutoff)) {
    return Promise.reject(new TypeError('cutoff must be a finite timestamp'));
  }

  return enqueue(async () => {
    const stored = await chrome.storage.local.get(null);
    let affected = 0;
    for (const key of Object.keys(stored).filter(isTimeLogKey)) {
      const shard = stored[key];
      if (!Array.isArray(shard)) continue;

      const kept = [];
      let changed = false;
      for (const slice of shard) {
        if (!slice || !Number.isFinite(slice.s) || !Number.isFinite(slice.e)) {
          kept.push(slice);
        } else if (slice.e <= cutoff) {
          affected++;
          changed = true;
        } else if (slice.s < cutoff) {
          kept.push({ ...slice, s: cutoff });
          affected++;
          changed = true;
        } else {
          kept.push(slice);
        }
      }

      if (!changed) continue;
      if (kept.length === 0) await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({ [key]: kept });
    }
    return affected;
  }, 'pruneBefore');
}

/** 兼容现有测试名。 */
export async function flush() {
  await awaitQueue();
}

/** 测试用：重置状态（清队列指针，不动 storage）。 */
export function __resetForTests() {
  writeQueue = Promise.resolve();
}
