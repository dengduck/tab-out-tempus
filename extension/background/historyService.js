import { SCHEMA_VERSION } from '../shared/constants.js';
import * as defaultTimeLog from './timeLog.js';

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(slices) {
  const rows = [['start', 'end', 'hostname', 'tabId', 'durationMs']];
  for (const slice of slices) {
    rows.push([
      slice.s,
      slice.e,
      slice.h || '',
      slice.tid ?? '',
      slice.e - slice.s,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * History operations stay decoupled from timeTracker until its public reset API exists.
 * clearHistory requires checkpoint and afterClear callbacks so pending/current data cannot
 * be written back after storage is cleared.
 */
export function createHistoryService(deps = {}) {
  const timeLog = deps.timeLog || defaultTimeLog;
  const tracker = deps.timeTracker || {};
  const checkpoint = deps.checkpoint || tracker.checkpoint;
  const beginClear = deps.beginClear || tracker.beginHistoryClear || deps.checkpoint;
  const finishClear = deps.finishClear || tracker.finishHistoryClear || deps.afterClear;
  const abortClear = deps.abortClear || tracker.abortHistoryClear || (async () => {});
  const now = deps.now || (() => Date.now());
  let retentionDays = deps.retentionDays ?? null;

  function requireClearCallbacks() {
    if (![beginClear, finishClear, abortClear].every((fn) => typeof fn === 'function')) {
      throw new Error('clearHistory requires begin/finish/abort lifecycle callbacks');
    }
  }

  async function exportData(format = 'json') {
    if (format !== 'json' && format !== 'csv') {
      throw new TypeError('format must be "json" or "csv"');
    }
    if (typeof checkpoint === 'function') await checkpoint();
    const slices = await timeLog.exportAll();
    if (format === 'csv') return toCsv(slices);
    return JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date(now()).toISOString(),
      timeLog: slices,
    }, null, 2);
  }

  async function clearHistory() {
    requireClearCallbacks();
    let clearing = true;
    try {
      await beginClear();
      await timeLog.awaitQueue();
      const cleared = await timeLog.clearAll();
      await finishClear();
      clearing = false;
      return cleared;
    } finally {
      if (clearing) await abortClear();
    }
  }

  function setRetention(days) {
    if (days !== null && (!Number.isFinite(days) || days <= 0)) {
      throw new TypeError('retention days must be a positive number or null');
    }
    retentionDays = days;
    return retentionDays;
  }

  async function applyRetention() {
    if (retentionDays === null) return 0;
    const cutoff = new Date(now());
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - retentionDays);
    return timeLog.pruneBefore(cutoff.getTime());
  }

  return { exportData, clearHistory, setRetention, applyRetention };
}
