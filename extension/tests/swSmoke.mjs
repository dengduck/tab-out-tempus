function event() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    emit(...args) { for (const fn of [...listeners]) fn(...args); },
    listeners,
  };
}

let releaseStorage;
const storageGate = new Promise((resolve) => { releaseStorage = resolve; });
const data = new Map([['__activeSliceSnapshot', {
  tabId: 1, hostname: 'example.com', sliceStart: 1000, pending: [],
}]]);
let gateEnabled = true;
const removed = [];
const area = {
  async get(keys) {
    if (gateEnabled) await storageGate;
    if (keys == null) return Object.fromEntries(data);
    if (typeof keys === 'string') return data.has(keys) ? { [keys]: data.get(keys) } : {};
    return Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)]));
  },
  async set(object) { for (const [key, value] of Object.entries(object)) data.set(key, value); },
  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) { removed.push(key); data.delete(key); }
  },
};

const alarmEvent = event();
globalThis.chrome = {
  storage: { local: area },
  runtime: {
    onInstalled: event(), onStartup: event(), onConnect: event(), onMessage: event(),
    getManifest: () => ({ version: 'smoke' }),
    getURL: (path) => `chrome-extension://test/${path}`,
  },
  tabs: {
    onActivated: event(), onRemoved: event(), onUpdated: event(), onCreated: event(), onAttached: event(),
    async query() { return []; }, async get(id) { return { id, active: true, url: 'https://example.com' }; },
    async update() {}, async remove() {},
  },
  windows: {
    WINDOW_ID_NONE: -1, onFocusChanged: event(),
    async getLastFocused() { return { id: 1, focused: false }; },
  },
  idle: { onStateChanged: event(), setDetectionInterval() {}, queryState(_s, cb) { cb('active'); } },
  alarms: { onAlarm: alarmEvent, async create() {}, async clear() {} },
  notifications: { async create() {} },
};

await import('../background/sw.js');
alarmEvent.emit({ name: 'tempus-tick' });
await Promise.resolve();
if (removed.includes('__activeSliceSnapshot')) throw new Error('alarm touched snapshot before bootstrap');
gateEnabled = false;
releaseStorage();
await new Promise((resolve) => setTimeout(resolve, 50));
if (alarmEvent.listeners.length !== 1) throw new Error('alarm listener registered more than once');
console.log('service worker cold-alarm smoke passed');
