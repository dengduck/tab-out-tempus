/**
 * background/store.js
 * --------------------
 * chrome.storage.local / session 的薄封装。
 *
 * 主要目的：
 *   - 统一异步接口（Promise）
 *   - 所有 key 必须来自 shared/constants.js 的 STORAGE_KEY（禁止硬编码字符串）
 *
 * 里程碑：M4 之前需要可用（TimeTracker 依赖它）。
 */

export async function localGet(_key) { /* stub */ }
export async function localSet(_key, _value) { /* stub */ }
export async function localRemove(_key) { /* stub */ }

export async function sessionGet(_key) { /* stub */ }
export async function sessionSet(_key, _value) { /* stub */ }
