/**
 * tests/nodeRunner.mjs — 在 Node.js 下跑浏览器测试。
 * 用法: node --experimental-vm-modules extension/tests/nodeRunner.mjs
 *
 * 原理：
 *   1. 注入最小 chrome mock 到 globalThis
 *   2. 动态 import 所有 test 文件（ES Module）
 *   3. 调用 testUtil.run() 并输出结果
 */

// ========== Step 1: 最小 chrome mock ==========

function makeStorageArea() {
  const store = new Map();
  return {
    _store: store,
    async get(keys) {
      if (keys === null || keys === undefined) {
        const out = {};
        for (const [k, v] of store) out[k] = v;
        return out;
      }
      if (typeof keys === 'string') {
        return store.has(keys) ? { [keys]: store.get(keys) } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
        return out;
      }
      return {};
    },
    async set(obj) {
      for (const k of Object.keys(obj)) store.set(k, obj[k]);
    },
    async remove(keys) {
      if (typeof keys === 'string') store.delete(keys);
      else if (Array.isArray(keys)) for (const k of keys) store.delete(k);
    },
    _reset() { store.clear(); },
  };
}

const localArea = makeStorageArea();
const sessionArea = makeStorageArea();

globalThis.chrome = {
  storage: { local: localArea, session: sessionArea },
  windows: { WINDOW_ID_NONE: -1 },
};
globalThis.__mockStorage = { local: localArea, session: sessionArea };

// Minimal document mock (testUtil.run needs optional DOM el)
globalThis.document = globalThis.document || { getElementById: () => null };

// ========== Step 2: resetMockStorage ==========

function resetMockStorage() {
  localArea._reset();
  sessionArea._reset();
}
globalThis.resetMockStorage = resetMockStorage;

// ========== Step 3: run tests ==========

const { run } = await import('./testUtil.js');

// Import test files (side effect: register suites)
await import('./timeTracker.test.js');

// Import additional test files.
await import('./formatDuration.test.js');
await import('./hostname.test.js');
await import('./privateMode.test.js');
await import('./configService.test.js');
await import('./savedStore.test.js');
await import('./historyService.test.js');
await import('./store.test.js');
await import('./focusTimer.test.js');
await import('./focusGuard.test.js');
await import('./groupingView.test.js');
await import('./messaging.test.js');
await import('./sidebar.test.js');

const { pass, fail } = await run(null);
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ ${pass} passed, ❌ ${fail} failed`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
process.exit(fail > 0 ? 1 : 0);
