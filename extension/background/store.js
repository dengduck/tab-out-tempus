/**
 * background/store.js
 * --------------------
 * chrome.storage.local 的 Promise 薄封装。
 * 读取缺失值返回 null；错误记录后继续向调用方抛出，禁止误报写入成功。
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
    throw err;
  }
}

export async function localSet(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.error(LOG_PREFIX, 'localSet failed', key, err);
    throw err;
  }
}

export async function localRemove(key) {
  try {
    await chrome.storage.local.remove(key);
  } catch (err) {
    console.error(LOG_PREFIX, 'localRemove failed', key, err);
    throw err;
  }
}
