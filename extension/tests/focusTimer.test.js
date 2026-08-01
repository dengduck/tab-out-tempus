import { suite, test, assert } from './testUtil.js';
import { resetMockStorage } from './mockChrome.js';
import * as focusTimer from '../background/focusTimer.js';
import { STORAGE_KEY } from '../shared/constants.js';

function installAlarmMock() {
  const alarms = new Map();
  chrome.alarms = {
    create(name, options) { alarms.set(name, options); },
    clear(name) { return alarms.delete(name); },
  };
  return alarms;
}

async function resetTimer(notify = null) {
  await focusTimer.stop();
  resetMockStorage();
  const alarms = installAlarmMock();
  await focusTimer.init({ notify });
  return alarms;
}

suite('FocusTimer — persistence and completion', () => {
  test('strict and allowedHosts are normalized before persistence', async () => {
    await resetTimer();
    const status = await focusTimer.start(5, {
      strict: true,
      allowedHosts: [
        ' Example.COM. ', '*.Docs.Example.COM', 'example.com',
        'https://FOO.example/path', '', null,
      ],
    });

    assert.equal(status.strict, true, 'strict is retained');
    assert.deepEqual(status.allowedHosts, [
      '*.docs.example.com', 'example.com', 'foo.example',
    ], 'rules are canonical and deduplicated');

    const stored = (await chrome.storage.local.get(STORAGE_KEY.FOCUS_TIMER))[STORAGE_KEY.FOCUS_TIMER];
    assert.deepEqual(stored.allowedHosts, status.allowedHosts, 'normalized rules are persisted');
    await focusTimer.stop();
  });

  test('failed strict guard startup rolls back timer and invokes cleanup', async () => {
    await focusTimer.stop();
    resetMockStorage();
    installAlarmMock();
    const transitions = [];
    await focusTimer.init({
      onStateChange: async (status, reason) => {
        transitions.push(reason);
        if (status) throw new Error('guard startup failed');
      },
    });
    let rejected = false;
    try { await focusTimer.start(5, { strict: true }); } catch (_) { rejected = true; }
    assert.ok(rejected, 'start rejects');
    assert.deepEqual(transitions, ['started', 'start-rollback']);
    assert.equal(focusTimer.getStatus(), null, 'timer rolled back');
    const stored = await chrome.storage.local.get(STORAGE_KEY.FOCUS_TIMER);
    assert.ok(!(STORAGE_KEY.FOCUS_TIMER in stored), 'timer storage rolled back');
  });

  test('finish is idempotent and expiry notifies exactly once', async () => {
    let notifications = 0;
    await resetTimer(() => { notifications += 1; });
    await focusTimer.start(5);

    const results = await Promise.all([
      focusTimer.finish('expired'),
      focusTimer.finish('expired'),
      focusTimer.finish('expired'),
    ]);

    assert.equal(notifications, 1, 'only the first expiry notifies');
    assert.equal(results.every(Boolean), true, 'concurrent callers share completion');
    assert.equal(focusTimer.getStatus(), null, 'timer is inactive');
  });

  test('alarm expiry notifies once even when delivered twice', async () => {
    let notifications = 0;
    await resetTimer(() => { notifications += 1; });
    await focusTimer.start(5);

    await Promise.all([
      focusTimer.onAlarm('tempus-focus-timer-end'),
      focusTimer.onAlarm('tempus-focus-timer-end'),
    ]);

    assert.equal(notifications, 1, 'duplicate alarm is idempotent');
  });

  test('init cleans an expired timer and notifies once', async () => {
    await focusTimer.stop();
    resetMockStorage();
    installAlarmMock();
    const originalNow = Date.now;
    Date.now = () => 10_000;
    let notifications = 0;

    try {
      await chrome.storage.local.set({
        [STORAGE_KEY.FOCUS_TIMER]: {
          startTime: 1_000,
          endTime: 9_000,
          durationMs: 8_000,
          strict: true,
          allowedHosts: [' Example.COM '],
        },
      });
      await focusTimer.init({ notify: () => { notifications += 1; } });
      await focusTimer.onAlarm('tempus-focus-timer-end');

      assert.equal(notifications, 1, 'init expiry notifies once');
      assert.equal(focusTimer.getStatus(), null, 'expired state is cleared');
      const stored = await chrome.storage.local.get(STORAGE_KEY.FOCUS_TIMER);
      assert.ok(!(STORAGE_KEY.FOCUS_TIMER in stored), 'expired storage is removed');
    } finally {
      Date.now = originalNow;
    }
  });

  test('getStatus lazy expiry notifies once', async () => {
    const originalNow = Date.now;
    let now = 20_000;
    Date.now = () => now;
    let notifications = 0;

    try {
      await resetTimer(() => { notifications += 1; });
      await focusTimer.start(1);
      now += 60_001;
      assert.equal(focusTimer.getStatus(), null, 'lazy expiry returns null immediately');
      await focusTimer.finish('expired');
      assert.equal(notifications, 1, 'lazy expiry completion notifies once');
    } finally {
      Date.now = originalNow;
      await focusTimer.stop();
    }
  });
});
