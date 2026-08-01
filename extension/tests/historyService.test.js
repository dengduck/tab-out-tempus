import { suite, test, assert } from './testUtil.js';
import { resetMockStorage } from './mockChrome.js';
import * as timeLog from '../background/timeLog.js';
import { createHistoryService } from '../background/historyService.js';
import { SCHEMA_VERSION } from '../shared/constants.js';

async function reset() {
  await timeLog.awaitQueue();
  resetMockStorage();
  timeLog.__resetForTests();
}

async function expectReject(promise, expected, message) {
  let error = null;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  assert.equal(error, expected, message);
}

suite('HistoryService — export', () => {
  test('JSON exports slices across month shards with metadata', async () => {
    await reset();
    const start = new Date(2026, 0, 31, 23, 59, 59).getTime();
    const end = new Date(2026, 1, 1, 0, 0, 1).getTime();
    await timeLog.appendSlice({ s: start, e: end, h: '跨月.example', tid: 7 });

    const exportedAt = Date.UTC(2026, 6, 1);
    const service = createHistoryService({ now: () => exportedAt });
    const data = JSON.parse(await service.exportData('json'));

    assert.equal(data.schemaVersion, SCHEMA_VERSION, 'schema version');
    assert.equal(data.exportedAt, new Date(exportedAt).toISOString(), 'export timestamp');
    assert.equal(data.timeLog.length, 2, 'cross-month slice is exported from both shards');
    assert.equal(data.timeLog[0].s, start, 'first part starts at original timestamp');
    assert.equal(data.timeLog[1].e, end, 'second part ends at original timestamp');
  });

  test('CSV preserves Unicode and escapes quotes', async () => {
    await reset();
    await timeLog.appendSlice({ s: 100, e: 250, h: '例子,"测试".com', tid: 9 });

    const csv = await createHistoryService().exportData('csv');

    assert.ok(csv.startsWith('start,end,hostname,tabId,durationMs\r\n'), 'stable CSV header');
    assert.ok(csv.includes('"例子,""测试"".com"'), 'Unicode hostname and quotes escaped');
    assert.ok(csv.includes(',9,150'), 'numeric fields exported');
  });
});

suite('timeLog — destructive operations', () => {
  test('clearAll deletes only timeLog.* keys', async () => {
    await reset();
    await chrome.storage.local.set({
      'timeLog.2026-01': [{ s: 1, e: 2, h: 'a.com' }],
      'timeLog.2026-02': [{ s: 2, e: 3, h: 'b.com' }],
      config: { keep: true },
      saved: [{ id: 1 }],
    });

    const order = [];
    const service = createHistoryService({
      checkpoint: async () => { order.push('checkpoint'); },
      afterClear: async () => { order.push('afterClear'); },
    });
    const count = await service.clearHistory();
    const stored = await chrome.storage.local.get(null);

    assert.equal(count, 2, 'two timeLog shards cleared');
    assert.deepEqual(order, ['checkpoint', 'afterClear'], 'checkpoint and reset callbacks run in order');
    assert.ok(!('timeLog.2026-01' in stored), 'January shard removed');
    assert.ok(!('timeLog.2026-02' in stored), 'February shard removed');
    assert.deepEqual(stored.config, { keep: true }, 'config retained');
    assert.deepEqual(stored.saved, [{ id: 1 }], 'saved data retained');
  });

  test('pruneBefore removes old shards and trims the boundary slice', async () => {
    await reset();
    const cutoff = new Date(2026, 2, 15, 12).getTime();
    await chrome.storage.local.set({
      'timeLog.2026-02': [{ s: cutoff - 20, e: cutoff - 10, h: 'old.com' }],
      'timeLog.2026-03': [
        { s: cutoff - 10, e: cutoff, h: 'ends-at-cutoff.com' },
        { s: cutoff - 5, e: cutoff + 5, h: 'boundary.com', tid: 2 },
        { s: cutoff + 10, e: cutoff + 20, h: 'new.com' },
      ],
      'timeLog.2026-04': [{ s: cutoff + 30, e: cutoff + 40, h: 'later.com' }],
      config: 'keep',
    });

    const affected = await timeLog.pruneBefore(cutoff);
    const stored = await chrome.storage.local.get(null);

    assert.equal(affected, 3, 'two removed slices and one trimmed slice');
    assert.ok(!('timeLog.2026-02' in stored), 'fully expired shard removed');
    assert.equal(stored['timeLog.2026-03'].length, 2, 'boundary shard retained useful slices');
    assert.equal(stored['timeLog.2026-03'][0].s, cutoff, 'crossing slice trimmed to cutoff');
    assert.equal(stored['timeLog.2026-03'][0].tid, 2, 'trim preserves optional fields');
    assert.equal(stored['timeLog.2026-04'].length, 1, 'future shard untouched');
    assert.equal(stored.config, 'keep', 'unrelated key untouched');
  });

  test('queue remains usable after a failed prune', async () => {
    await reset();
    await chrome.storage.local.set({
      'timeLog.2026-01': [{ s: 1, e: 2, h: 'old.com' }],
    });
    const originalRemove = chrome.storage.local.remove;
    const failure = new Error('remove failed');
    chrome.storage.local.remove = async () => { throw failure; };
    try {
      await expectReject(timeLog.pruneBefore(10), failure, 'storage failure propagates');
    } finally {
      chrome.storage.local.remove = originalRemove;
    }

    await timeLog.appendSlice({ s: 20, e: 30, h: 'new.com' });
    const slices = await timeLog.exportAll();
    assert.ok(slices.some((slice) => slice.h === 'new.com'), 'later writes still run');
  });
});

suite('HistoryService — failure propagation and retention', () => {
  test('clearHistory propagates failures and stops later phases', async () => {
    const checkpointFailure = new Error('checkpoint failed');
    let clearCalled = false;
    let resetCalled = false;
    const checkpointService = createHistoryService({
      timeLog: {
        awaitQueue: async () => {},
        clearAll: async () => { clearCalled = true; },
      },
      checkpoint: async () => { throw checkpointFailure; },
      afterClear: async () => { resetCalled = true; },
    });

    await expectReject(checkpointService.clearHistory(), checkpointFailure, 'checkpoint failure propagates');
    assert.ok(!clearCalled, 'storage is not cleared after checkpoint failure');
    assert.ok(!resetCalled, 'cache reset is not called after checkpoint failure');

    const clearFailure = new Error('clear failed');
    const clearService = createHistoryService({
      timeLog: {
        awaitQueue: async () => {},
        clearAll: async () => { throw clearFailure; },
      },
      checkpoint: async () => {},
      afterClear: async () => { resetCalled = true; },
    });
    await expectReject(clearService.clearHistory(), clearFailure, 'clear failure propagates');
  });

  test('begin-clear failure always invokes abort cleanup', async () => {
    let paused = false;
    const service = createHistoryService({
      timeLog: { awaitQueue: async () => {}, clearAll: async () => 0 },
      beginClear: async () => { paused = true; throw new Error('snapshot remove failed'); },
      finishClear: async () => { paused = false; },
      abortClear: async () => { paused = false; },
    });
    let rejected = false;
    try { await service.clearHistory(); } catch (_) { rejected = true; }
    assert.ok(rejected, 'preparation failure propagates');
    assert.equal(paused, false, 'abort releases held pause');
  });

  test('applyRetention uses the configured day cutoff and null disables it', async () => {
    const calls = [];
    const now = Date.UTC(2026, 6, 10);
    const service = createHistoryService({
      now: () => now,
      timeLog: { pruneBefore: async (cutoff) => { calls.push(cutoff); return 4; } },
    });

    assert.equal(await service.applyRetention(), 0, 'null retention is disabled');
    service.setRetention(30);
    assert.equal(await service.applyRetention(), 4, 'prune result propagated');
    const expectedCutoff = new Date(now);
    expectedCutoff.setHours(0, 0, 0, 0);
    expectedCutoff.setDate(expectedCutoff.getDate() - 30);
    assert.equal(calls[0], expectedCutoff.getTime(), 'retention cutoff uses local calendar days');
    service.setRetention(null);
    assert.equal(await service.applyRetention(), 0, 'retention can be disabled again');
  });
});
