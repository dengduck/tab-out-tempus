/**
 * background/blacklist.js
 * ------------------------
 * 域名黑名单：切到黑名单 hostname → timeTracker.pause('blacklist')。
 * 离开黑名单 hostname → timeTracker.resume('blacklist')。
 *
 * 存储：chrome.storage.local['blacklist'] = string[]  （hostname 列表）
 *
 * 使用方式：
 *   - sw.js 在 tab activate / URL change 后调 checkTab(tabId) 判断是否暂停
 *   - UI 通过 REQ_BLACKLIST_ADD / REQ_BLACKLIST_REMOVE 管理列表
 *
 * 里程碑：M8。
 */

import { STORAGE_KEY, LOG_PREFIX } from '../shared/constants.js';
import { localGet, localSet } from './store.js';
import * as timeTracker from './timeTracker.js';
import { getHostname } from '../shared/hostname.js';
import * as tabRegistry from './tabRegistry.js';

const PAUSE_REASON = 'blacklist';

/** @type {Set<string>} 内存缓存（启动时从 storage 加载） */
const blockedHosts = new Set();

let emit = null;

function log(...args) {
  console.log(LOG_PREFIX, '[bl]', ...args);
}

function broadcastChange() {
  if (typeof emit === 'function') {
    try {
      emit('BCAST_STATE_CHANGE', {
        pauseReasons: timeTracker.getPauseReasons(),
        tracking: timeTracker.getTrackingState(),
        blacklist: Array.from(blockedHosts),
      });
    } catch (_) { /* ignore */ }
  }
}

// ========== 公共 API ==========

/**
 * 初始化：从 storage 加载已有列表。
 * @param {{emit?: Function}} deps
 */
export async function init(deps = {}) {
  emit = deps.emit || null;
  const stored = await localGet(STORAGE_KEY.BLACKLIST);
  if (Array.isArray(stored)) {
    for (const h of stored) {
      if (typeof h === 'string' && h) blockedHosts.add(h);
    }
  }
  log('init, blocked =', blockedHosts.size);
}

export async function add(hostname) {
  if (typeof hostname !== 'string' || !hostname) throw new Error('invalid hostname');
  blockedHosts.add(hostname);
  await persist();
  // 如果当前 active tab 就是这个域名 → 立即暂停
  recheckActiveTab();
  log('added', hostname);
  broadcastChange();
}

export async function remove(hostname) {
  if (!blockedHosts.has(hostname)) return;
  blockedHosts.delete(hostname);
  await persist();
  // 如果之前因为这个域名暂停了，现在可能该恢复
  recheckActiveTab();
  log('removed', hostname);
  broadcastChange();
}

export function getList() {
  return Array.from(blockedHosts);
}

export function isBlocked(hostname) {
  return blockedHosts.has(hostname);
}

/**
 * 检查指定 tab 是否在黑名单。应在 tab activate / URL change 后调用。
 * @param {number} tabId
 */
export function checkTab(tabId) {
  const info = tabRegistry.get(tabId);
  if (!info) return;
  const hostname = getHostname(info.url || '');

  if (blockedHosts.has(hostname)) {
    if (!timeTracker.isPausedBy(PAUSE_REASON)) {
      timeTracker.pause(PAUSE_REASON);
    }
  } else {
    if (timeTracker.isPausedBy(PAUSE_REASON)) {
      timeTracker.resume(PAUSE_REASON);
    }
  }
}

// ========== 内部 ==========

function recheckActiveTab() {
  const state = timeTracker.getTrackingState();
  if (state.activeTabId !== null) {
    checkTab(state.activeTabId);
  }
}

async function persist() {
  await localSet(STORAGE_KEY.BLACKLIST, Array.from(blockedHosts));
}
