import { suite, test, assert } from './testUtil.js';
import * as messaging from '../ui/messaging.js';

function makeEvent() {
  const listeners = new Set();
  return {
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    emit(...args) { for (const fn of Array.from(listeners)) fn(...args); },
  };
}

function makePort() {
  const onMessage = makeEvent();
  const onDisconnect = makeEvent();
  return {
    name: 'tempus-ui',
    onMessage,
    onDisconnect,
    posted: [],
    disconnected: false,
    postMessage(message) { this.posted.push(message); },
    disconnect() {
      this.disconnected = true;
      onDisconnect.emit();
    },
  };
}

suite('UI messaging — runtime Port', () => {
  test('disconnect triggers reconnect callback and a new Port', async () => {
    const ports = [makePort(), makePort()];
    let connectCount = 0;
    chrome.runtime = {
      connect() { return ports[connectCount++]; },
      sendMessage: async () => ({ ok: true, data: {} }),
    };
    let reconnects = 0;
    const unsubscribe = messaging.subscribeReconnect(() => { reconnects++; });
    await messaging.notifyUIReady();
    const baseline = reconnects;
    ports[0].disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(connectCount, 2, 'new Port created after disconnect');
    assert.equal(reconnects, baseline + 1, 'reconnect subscriber notified');
    unsubscribe();
    await messaging.notifyUIGone();
  });

  test('建立 Port、分发广播，并在主动断开后停止订阅', async () => {
    const port = makePort();
    let connectCount = 0;
    chrome.runtime = {
      connect(options) {
        connectCount++;
        assert.equal(options.name, 'tempus-ui');
        return port;
      },
      sendMessage: async () => ({ ok: true, data: {} }),
    };

    const payloads = [];
    const unsubscribe = messaging.subscribeTick((payload) => payloads.push(payload));
    const ready = await messaging.notifyUIReady();
    assert.equal(connectCount, 1, 'one Port connection');
    assert.equal(ready.connected, true);

    port.onMessage.emit({ type: 'BCAST_TICK', payload: { todayMs: 123 } });
    assert.deepEqual(payloads, [{ todayMs: 123 }], 'Port broadcast dispatched');

    unsubscribe();
    port.onMessage.emit({ type: 'BCAST_TICK', payload: { todayMs: 456 } });
    assert.equal(payloads.length, 1, 'unsubscribe stops callbacks');

    await messaging.notifyUIGone();
    assert.equal(port.disconnected, true, 'explicit cleanup disconnects Port');
  });
});
