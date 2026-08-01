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
import { getHostname, normalizeHostnameInput } from '../shared/hostname.js';
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
  const normalized = Array.isArray(stored)
    ? [...new Set(stored.map(normalizeHostnameInput).filter(Boolean))]
    : [];
  blockedHosts.clear();
  for (const host of normalized) blockedHosts.add(host);
  if (Array.isArray(stored) && JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await localSet(STORAGE_KEY.BLACKLIST, normalized);
  }
  log('init, blocked =', blockedHosts.size);
}

export async function add(input) {
  const hostname = normalizeHostnameInput(input);
  if (!hostname) throw new Error('invalid hostname');
  if (blockedHosts.has(hostname)) return hostname;
  const next = new Set(blockedHosts);
  next.add(hostname);
  await persist(next);
  blockedHosts.add(hostname);
  recheckActiveTab();
  log('added', hostname);
  broadcastChange();
  return hostname;
}

export async function remove(input) {
  const hostname = normalizeHostnameInput(input);
  if (!hostname || !blockedHosts.has(hostname)) return hostname || null;
  const next = new Set(blockedHosts);
  next.delete(hostname);
  await persist(next);
  blockedHosts.delete(hostname);
  recheckActiveTab();
  log('removed', hostname);
  broadcastChange();
  return hostname;
}

export function getList() {
  return Array.from(blockedHosts);
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

async function persist(hosts = blockedHosts) {
  await localSet(STORAGE_KEY.BLACKLIST, Array.from(hosts).sort());
}
