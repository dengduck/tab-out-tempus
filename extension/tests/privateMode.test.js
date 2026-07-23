import { suite, test, assert } from './testUtil.js';
import { resetMockStorage } from './mockChrome.js';
import * as privateMode from '../background/privateMode.js';
import * as timeTracker from '../background/timeTracker.js';
import * as timeLog from '../background/timeLog.js';
import { STORAGE_KEY } from '../shared/constants.js';

function installAlarmMock() {
  const alarms = new Map();
  chrome.alarms = {
    create(name, options) { alarms.set(name, options); },
    clear(name) { return alarms.delete(name); },
  };
  return alarms;
}

suite('Private Mode — 过期恢复', () => {
  test('getStatus 发现过期时同步解除 private-mode pauseReason', async () => {
    await timeLog.flush();
    resetMockStorage();
    timeTracker.__testing.reset();
    const alarms = installAlarmMock();
    const originalNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;

    try {
      timeTracker.__testing.forceStart({ tabId: 1, hostname: 'a.com', sliceStart: now });
      await privateMode.start(1);
      assert.ok(timeTracker.isPausedBy('private-mode'), 'private mode pauses tracker');
      assert.ok(alarms.has('tempus-private-mode-end'), 'expiry alarm registered');

      now += 61_000;
      assert.equal(privateMode.getStatus(), null, 'expired status becomes null');
      assert.ok(!timeTracker.isPausedBy('private-mode'), 'expired status resumes tracker immediately');
      assert.ok(!alarms.has('tempus-private-mode-end'), 'expired alarm cleared');

      await Promise.resolve();
      const stored = await chrome.storage.local.get(STORAGE_KEY.PRIVATE_MODE);
      assert.ok(!(STORAGE_KEY.PRIVATE_MODE in stored), 'expired storage removed');
    } finally {
      Date.now = originalNow;
      await privateMode.stop();
    }
  });

  test('stop 可清理 endTime 已丢失但 pauseReason 仍残留的状态', async () => {
    timeTracker.__testing.reset();
    timeTracker.pause('private-mode');
    assert.ok(timeTracker.isPausedBy('private-mode'));

    await privateMode.stop();

    assert.ok(!timeTracker.isPausedBy('private-mode'), 'stale pauseReason removed');
  });
});
