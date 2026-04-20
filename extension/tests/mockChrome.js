/**
 * tests/mockChrome.js
 * --------------------
 * 在 runTests.html 里加载前先装一套最小 mock：
 *   - chrome.storage.local / session：内存 Map 实现
 *   - chrome.windows.WINDOW_ID_NONE：常量
 *   - 其它用不到的 chrome.* 先不管，测试里不要触发
 *
 * 装法：import 副作用方式——加载即生效。必须在 timeTracker.js 之前加载。
 */

function makeStorageArea() {
  const store = new Map();
  return {
    _store: store,
    async get(keys) {
      // keys 可能是 string | string[] | null（全量）
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

// 只在尚未有真 chrome API（浏览器里打开测试页而不是扩展页）时注入
if (typeof globalThis.chrome === 'undefined' || !globalThis.chrome.storage) {
  const localArea = makeStorageArea();
  const sessionArea = makeStorageArea();
  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.storage = { local: localArea, session: sessionArea };
  globalThis.chrome.windows = globalThis.chrome.windows || { WINDOW_ID_NONE: -1 };
  globalThis.__mockStorage = { local: localArea, session: sessionArea };
}

export function resetMockStorage() {
  if (globalThis.__mockStorage) {
    globalThis.__mockStorage.local._reset();
    globalThis.__mockStorage.session._reset();
  } else if (chrome?.storage?.local?.clear) {
    // 真扩展环境：清空
    chrome.storage.local.clear();
    chrome.storage.session.clear();
  }
}
