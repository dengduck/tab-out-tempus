/**
 * background/store.js
 * --------------------
 * chrome.storage.local / session 的薄封装（Promise 化 + 单一出入口）。
 *
 * 契约：
 *   - 只导出 localGet/localSet/localRemove + sessionGet/sessionSet/sessionRemove
 *   - 所有 key 必须来自 shared/constants.js 的 STORAGE_KEY（本文件不校验，依赖调用方自觉）
 *   - 读取 undefined 时返回 null（而非 undefined），避免调用方 if/else 分叉
 *   - 错误写 console.error 但不往外抛（存储挂了不能把 SW 拖死）
 *
 * 里程碑：M4（TimeTracker 之前先有它）。
 */

import { LOG_PREFIX } from '../shared/constants.js';

// ---------------- local ----------------

export async function localGet(key) {
  try {
    const obj = await chrome.storage.local.get(key);
    return obj[key] === undefined ? null : obj[key];
  } catch (err) {
    console.error(LOG_PREFIX, 'localGet failed', key, err);
    return null;
  }
}

export async function localSet(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.error(LOG_PREFIX, 'localSet failed', key, err);
  }
}

export async function localRemove(key) {
  try {
    await chrome.storage.local.remove(key);
  } catch (err) {
    console.error(LOG_PREFIX, 'localRemove failed', key, err);
  }
}

/**
 * 一次取多个 key。
 * @param {string[]} keys
 * @returns {Promise<Record<string, any>>} 缺失的 key 映射为 null（与 localGet 一致）
 */
export async function localGetMany(keys) {
  try {
    const obj = await chrome.storage.local.get(keys);
    // M10(P2-30): 统一行为——缺失的 key 映射为 null，与 localGet 一致
    const result = {};
    for (const k of keys) {
      result[k] = obj[k] === undefined ? null : obj[k];
    }
    return result;
  } catch (err) {
    console.error(LOG_PREFIX, 'localGetMany failed', keys, err);
    const result = {};
    for (const k of keys) result[k] = null;
    return result;
  }
}

// ---------------- session ----------------
// 注意：MV3 的 chrome.storage.session 在 SW 重启时被清空，不能依赖它持久化真相数据。

export async function sessionGet(key) {
  try {
    const obj = await chrome.storage.session.get(key);
    return obj[key] === undefined ? null : obj[key];
  } catch (err) {
    console.error(LOG_PREFIX, 'sessionGet failed', key, err);
    return null;
  }
}

export async function sessionSet(key, value) {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (err) {
    console.error(LOG_PREFIX, 'sessionSet failed', key, err);
  }
}

export async function sessionRemove(key) {
  try {
    await chrome.storage.session.remove(key);
  } catch (err) {
    console.error(LOG_PREFIX, 'sessionRemove failed', key, err);
  }
}
