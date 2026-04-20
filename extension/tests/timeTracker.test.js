/**
 * tests/timeTracker.test.js
 * --------------------------
 * 覆盖 D17 单一时间账本模型 + M4 核心用例。
 *
 * 注意：本文件依赖 mockChrome.js 已在 runTests.html 里先加载。
 */

import { suite, test, assert } from './testUtil.js';
import { resetMockStorage } from './mockChrome.js';
import * as timeTracker from '../background/timeTracker.js';
import * as timeLog from '../background/timeLog.js';
import { STORAGE_KEY } from '../shared/constants.js';

// --------- helpers ---------

/** 可控时钟：测试里手工 advance */
function makeClock(start) {
  let t = start;
  return {
    now() { return t; },
    advance(ms) { t += ms; },
    set(v) { t = v; },
  };
}

function tabInfoFactory(map) {
  return (tabId) => map.get(tabId) || null;
}

async function freshTracker(clockStart = 1_700_000_000_000, tabs = []) {
  // 先等旧 timeLog 队列清空（防止上一个测试的 fire-and-forget appendSlice 泄漏到本测试的 storage）
  await timeLog.flush();
  resetMockStorage();
  timeLog.__resetForTests();
  timeTracker.__testing.reset();

  const clock = makeClock(clockStart);
  const tabMap = new Map();
  for (const t of tabs) tabMap.set(t.id, t);

  await timeTracker.init({
    nowProvider: () => clock.now(),
    tabInfoProvider: tabInfoFactory(tabMap),
    emit: null,
  });
  return { clock, tabMap };
}

// --------- suites ---------

suite('TimeTracker — 基本累加', () => {
  test('onActivate → 等 1s → finalize via another activate：getTabCumulativeMs ≈ 1000ms', async () => {
    const { clock } = await freshTracker(0, [
      { id: 1, url: 'https://github.com/foo' },
      { id: 2, url: 'https://example.com' },
    ]);
    timeTracker.onActivateTab(1);
    clock.advance(1000);
    timeTracker.onActivateTab(2);  // finalize tab 1
    const ms = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(ms, 1000, 10, 'tab 1 cumulative ≈ 1000ms');
  });

  test('onRemoveTab：D17 不清 session 缓存，finalize 的 slice 进 timeLog', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://github.com/foo' }]);
    timeTracker.onActivateTab(1);
    clock.advance(1000);
    timeTracker.onRemoveTab(1);
    // D17 变化：onRemoveTab 不再清 tabSessionMs
    const ms = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(ms, 1000, 10, 'D17: cumulative NOT cleared on close');
    // 真实的持久化证据在 timeLog
    await timeLog.flush();
    const slices = await timeLog.getRange(-1, 1e15);
    assert.equal(slices.length, 1, 'one slice written');
    assert.greaterOrEqual(slices[0].e - slices[0].s, 900, 'slice duration ≈ 1s');
  });

  test('finalize 只 +=，从不覆盖', async () => {
    const { clock } = await freshTracker(0, [{ id: 2, url: 'https://example.com' }]);
    timeTracker.onActivateTab(2);
    clock.advance(500);
    // 模拟切换到别的 tab 再切回来（两次 active）
    timeTracker.onActivateTab(2);  // 切回自己：finalize 前一段，再开新
    clock.advance(300);
    // 再切回自己一次
    timeTracker.onActivateTab(2);
    clock.advance(200);
    const cur = timeTracker.getTabCumulativeMs(2);
    // 500 + 300 + 200 = 1000（running 200 也算）
    assert.closeTo(cur, 1000, 10, 'cumulative += correctly');
  });

  test('同一 tab 多次切入切出，cumulative 严格递增', async () => {
    const { clock } = await freshTracker(0, [
      { id: 1, url: 'https://a.com' },
      { id: 2, url: 'https://b.com' },
    ]);
    timeTracker.onActivateTab(1);
    const snapshots = [];
    for (let i = 0; i < 5; i++) {
      clock.advance(100);
      timeTracker.onActivateTab(2);
      clock.advance(50);
      timeTracker.onActivateTab(1);
      snapshots.push(timeTracker.getTabCumulativeMs(1));
    }
    for (let i = 1; i < snapshots.length; i++) {
      assert.ok(snapshots[i] >= snapshots[i - 1], `monotonic at ${i}: ${snapshots[i - 1]} → ${snapshots[i]}`);
    }
  });
});

suite('TimeTracker — 多窗口 focus', () => {
  test('窗口失焦 → pauseReasons 加 window-blur，无累加', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    clock.advance(500);
    const before = timeTracker.getTabCumulativeMs(1);

    timeTracker.onFocusWindow(null);  // Chrome 失焦
    assert.ok(timeTracker.isPausedBy('window-blur'), 'paused by window-blur');
    clock.advance(2000);
    const duringBlur = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(duringBlur, before, 10, 'no accumulation during blur');
  });

  test('重新 focus → 恢复累加', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    clock.advance(500);
    timeTracker.onFocusWindow(null);
    clock.advance(2000);
    timeTracker.onFocusWindow(1);  // 回来
    assert.ok(!timeTracker.isPausedBy('window-blur'), 'resumed');
    clock.advance(300);
    const ms = timeTracker.getTabCumulativeMs(1);
    // 500 (before blur) + 300 (after resume) ≈ 800
    assert.closeTo(ms, 800, 10, 'sum of active intervals');
  });
});

suite('TimeTracker — pauseReasons 多源叠加（关键）', () => {
  test('window-blur + idle 同时触发，Set 两个 reason', async () => {
    await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    timeTracker.pause('window-blur');
    timeTracker.pause('idle');
    assert.deepEqual(
      new Set(timeTracker.getPauseReasons()),
      new Set(['window-blur', 'idle']),
      'both reasons present',
    );
  });

  test('只解除 window-blur 但 idle 还在：依然暂停', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    clock.advance(200);
    timeTracker.pause('window-blur');
    timeTracker.pause('idle');
    const before = timeTracker.getTabCumulativeMs(1);
    clock.advance(1000);

    timeTracker.resume('window-blur');
    assert.ok(timeTracker.isPausedBy('idle'), 'still paused by idle');
    clock.advance(1000);
    const after = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(after, before, 10, 'no accumulation while idle still pauses');
  });

  test('两个都解除才恢复', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    timeTracker.pause('window-blur');
    timeTracker.pause('idle');
    clock.advance(2000);
    timeTracker.resume('window-blur');
    timeTracker.resume('idle');
    assert.equal(timeTracker.getPauseReasons().length, 0, 'no reasons left');
    clock.advance(500);
    const ms = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(ms, 500, 10, 'accumulates only after both released');
  });
});

suite('TimeTracker — Private Mode / blacklist 作为 pauseReason', () => {
  test('private-mode pause：期间无累加', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    clock.advance(100);
    timeTracker.pause('private-mode');
    clock.advance(5 * 60 * 1000);  // 5 min
    timeTracker.resume('private-mode');
    const ms = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(ms, 100, 10, 'only 100ms counted');
  });

  test('blacklist pause/resume', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    clock.advance(200);
    timeTracker.pause('blacklist');
    clock.advance(10_000);
    timeTracker.resume('blacklist');
    clock.advance(300);
    const ms = timeTracker.getTabCumulativeMs(1);
    assert.closeTo(ms, 500, 10, '200 + 300 accounting');
  });
});

suite('TimeTracker — SW 重启恢复（D17 模型）', () => {
  test('init 从 timeLog 重建 tabSessionMs', async () => {
    resetMockStorage();
    timeLog.__resetForTests();

    // 先造一些 timeLog 数据
    const now = 1_700_000_050_000;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const base = dayStart.getTime();

    await timeLog.appendSlice({ s: base + 1000, e: base + 5000, h: 'a.com', tid: 42 });
    await timeLog.appendSlice({ s: base + 6000, e: base + 8000, h: 'b.com', tid: 99 });
    await timeLog.flush();

    timeTracker.__testing.reset();
    await timeTracker.init({
      nowProvider: () => now,
      tabInfoProvider: () => null,
    });

    // tab 42 = 4000ms, tab 99 = 2000ms
    assert.equal(timeTracker.getTabCumulativeMs(42), 4000, 'tab 42 rebuilt from timeLog');
    assert.equal(timeTracker.getTabCumulativeMs(99), 2000, 'tab 99 rebuilt from timeLog');
  });

  test('活跃 slice 快照被重启恢复：最多补算 ALARM_PERIOD_S*2', async () => {
    resetMockStorage();
    timeLog.__resetForTests();
    const sliceStart = 1000;
    await chrome.storage.local.set({
      [STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT]: {
        tabId: 7,
        hostname: 'a.com',
        sliceStart,
      },
    });
    timeTracker.__testing.reset();

    const now = sliceStart + 20_000;  // SW 睡了 20s
    await timeTracker.init({
      nowProvider: () => now,
      tabInfoProvider: () => null,
    });
    // 应该补算 20s
    const ms = timeTracker.getTabCumulativeMs(7);
    assert.equal(ms, 20_000, 'recovered 20s');
  });

  test('snapshot 超过上限时被裁剪', async () => {
    resetMockStorage();
    timeLog.__resetForTests();
    const sliceStart = 1000;
    await chrome.storage.local.set({
      [STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT]: {
        tabId: 9,
        hostname: 'a.com',
        sliceStart,
      },
    });
    timeTracker.__testing.reset();

    // SW 睡了 10 分钟 —— 远超 ALARM_PERIOD_S(30) * 2 = 60s
    const now = sliceStart + 10 * 60 * 1000;
    await timeTracker.init({
      nowProvider: () => now,
      tabInfoProvider: () => null,
    });
    const ms = timeTracker.getTabCumulativeMs(9);
    // 上限 60s
    assert.equal(ms, 60_000, 'capped at 60s');
  });
});

suite('TimeTracker — URL 变化', () => {
  test('onUpdateUrl 改 hostname：旧 slice 按旧 hostname，新 slice 按新 hostname', async () => {
    const tabs = new Map();
    tabs.set(1, { id: 1, url: 'https://a.com/foo' });
    resetMockStorage();
    timeLog.__resetForTests();
    timeTracker.__testing.reset();
    const clock = makeClock(0);
    await timeTracker.init({
      nowProvider: () => clock.now(),
      tabInfoProvider: (id) => tabs.get(id),
    });

    timeTracker.onActivateTab(1);
    clock.advance(500);

    // URL 变成 b.com
    tabs.set(1, { id: 1, url: 'https://b.com/bar' });
    timeTracker.onUpdateUrl(1, 'https://a.com/foo', 'https://b.com/bar');
    clock.advance(300);

    // 让 timeLog flush
    timeTracker.onRemoveTab(1);
    await timeLog.flush();

    const slices = await timeLog.getRange(-1, 1e15);
    // 应该有 2 条，分别 hostname=a.com 和 b.com
    const aSlice = slices.find((s) => s.h === 'a.com');
    const bSlice = slices.find((s) => s.h === 'b.com');
    assert.ok(aSlice, 'a.com slice present');
    assert.ok(bSlice, 'b.com slice present');
    assert.closeTo(aSlice.e - aSlice.s, 500, 20, 'a.com ≈ 500ms');
    assert.closeTo(bSlice.e - bSlice.s, 300, 20, 'b.com ≈ 300ms');
  });
});

suite('TimeTracker — getTodayTotalMs（D17 同步模型）', () => {
  test('基本汇总：多 tab session + running slice', async () => {
    const { clock } = await freshTracker(0, [
      { id: 1, url: 'https://a.com' },
      { id: 2, url: 'https://b.com' },
    ]);
    timeTracker.onActivateTab(1);
    clock.advance(1000);
    timeTracker.onActivateTab(2);
    clock.advance(500);
    // tab1 = 1000 (finalized), tab2 = 500 (running)
    const total = timeTracker.getTodayTotalMs();
    assert.closeTo(total, 1500, 10, 'today = tab1 finalized + tab2 running');
  });

  test('暂停期间不算入 today', async () => {
    const { clock } = await freshTracker(0, [{ id: 1, url: 'https://a.com' }]);
    timeTracker.onActivateTab(1);
    clock.advance(200);
    timeTracker.pause('idle');
    clock.advance(5000);
    const total = timeTracker.getTodayTotalMs();
    assert.closeTo(total, 200, 10, 'only active time counts');
  });
});

suite('TimeTracker — 单调性宏观断言', () => {
  test('随机事件序列：cumulative 永远不下降', async () => {
    const tabs = new Map([
      [1, { id: 1, url: 'https://a.com' }],
      [2, { id: 2, url: 'https://b.com' }],
      [3, { id: 3, url: 'https://c.com' }],
    ]);
    resetMockStorage();
    timeLog.__resetForTests();
    timeTracker.__testing.reset();
    const clock = makeClock(0);
    await timeTracker.init({
      nowProvider: () => clock.now(),
      tabInfoProvider: (id) => tabs.get(id),
    });

    const tabIds = [1, 2, 3];
    const prev = new Map([[1, 0], [2, 0], [3, 0]]);
    const rng = mulberry32(42);

    for (let i = 0; i < 200; i++) {
      const action = Math.floor(rng() * 4);
      clock.advance(Math.floor(rng() * 100) + 10);
      if (action === 0) {
        timeTracker.onActivateTab(tabIds[Math.floor(rng() * 3)]);
      } else if (action === 1) {
        timeTracker.pause(['window-blur', 'idle', 'blacklist'][Math.floor(rng() * 3)]);
      } else if (action === 2) {
        timeTracker.resume(['window-blur', 'idle', 'blacklist'][Math.floor(rng() * 3)]);
      } else {
        timeTracker.onFocusWindow(Math.floor(rng() * 2) === 0 ? null : 1);
      }
      for (const id of tabIds) {
        const cur = timeTracker.getTabCumulativeMs(id);
        assert.ok(cur >= prev.get(id), `tab ${id} monotonic at step ${i}: ${prev.get(id)} → ${cur}`);
        prev.set(id, cur);
      }
    }
  });
});

// 纯 JS Mulberry32 PRNG，可重现
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
