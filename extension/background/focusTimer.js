/**
 * Persistent focus countdown with optional strict-mode host rules.
 * Storage shape remains compatible with the original focusTimer API.
 */

import { STORAGE_KEY, LOG_PREFIX } from '../shared/constants.js';
import { localGet, localSet, localRemove } from './store.js';
import * as timeTracker from './timeTracker.js';

const ALARM_NAME = 'tempus-focus-timer-end';

let state = null;
let emit = null;
let notify = null;
let onStateChange = null;
let finishPromise = null;

function log(...args) {
  console.log(LOG_PREFIX, '[ft]', ...args);
}

async function clearAlarm() {
  if (!chrome.alarms?.clear) return;
  await chrome.alarms.clear(ALARM_NAME);
}

async function createAlarm(endTime) {
  if (!chrome.alarms?.create) return;
  await chrome.alarms.create(ALARM_NAME, { when: endTime });
}

function normalizeHostname(value) {
  let text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;

  if (text.includes('://')) {
    try { text = new URL(text).hostname; }
    catch (_) { return null; }
  } else {
    text = text.split('/')[0];
    if (text.includes('@')) return null;
    text = text.replace(/:\d+$/, '');
  }

  text = text.replace(/^\.+|\.+$/g, '');
  if (!text || text === '*' || /\s/.test(text)) return null;

  try {
    const hostname = new URL(`http://${text}`).hostname.toLowerCase().replace(/\.$/, '');
    return hostname || null;
  } catch (_) {
    return null;
  }
}

export function normalizeAllowedHosts(values) {
  if (!Array.isArray(values)) return [];
  const rules = new Set();

  for (const value of values) {
    const raw = String(value ?? '').trim();
    const wildcard = raw.startsWith('*.');
    const hostname = normalizeHostname(wildcard ? raw.slice(2) : raw);
    if (hostname) rules.add(wildcard ? `*.${hostname}` : hostname);
  }

  return [...rules].sort();
}

function normalizeState(candidate) {
  if (!candidate || typeof candidate.endTime !== 'number') return null;
  const startTime = typeof candidate.startTime === 'number' ? candidate.startTime : candidate.endTime;
  const durationMs = typeof candidate.durationMs === 'number'
    ? candidate.durationMs
    : Math.max(0, candidate.endTime - startTime);
  return {
    ...candidate,
    startTime,
    endTime: candidate.endTime,
    durationMs,
    strict: candidate.strict === true,
    allowedHosts: normalizeAllowedHosts(candidate.allowedHosts),
  };
}

function statusFromState(current, now) {
  const elapsed = Math.max(0, now - current.startTime);
  return {
    active: true,
    startTime: current.startTime,
    endTime: current.endTime,
    durationMs: current.durationMs,
    remainingMs: current.endTime - now,
    strict: current.strict,
    allowedHosts: [...current.allowedHosts],
    elapsed,
    progress: current.durationMs > 0 ? Math.min(1, elapsed / current.durationMs) : 1,
  };
}

function broadcastChange() {
  if (typeof emit !== 'function') return;
  try {
    emit('BCAST_STATE_CHANGE', {
      pauseReasons: timeTracker.getPauseReasons(),
      tracking: timeTracker.getTrackingState(),
      focusTimer: getStatus(),
    });
  } catch (_) { /* broadcast failures must not affect timer state */ }
}

/**
 * Finish the current timer once. Expiry callers use reason="expired", which
 * triggers the injected notification after durable cleanup.
 */
export async function finish(reason = 'stopped') {
  if (finishPromise) return finishPromise;
  if (!state) return false;

  const finishedState = state;
  const operation = (async () => {
    await localRemove(STORAGE_KEY.FOCUS_TIMER);
    if (state === finishedState) state = null;
    const cleanupErrors = [];
    try { await clearAlarm(); } catch (err) { cleanupErrors.push(err); }
    if (typeof onStateChange === 'function') {
      try { await onStateChange(null, reason); }
      catch (err) { cleanupErrors.push(err); }
    }
    if (reason === 'expired' && typeof notify === 'function') {
      try { await notify({ reason, timer: statusFromState(finishedState, finishedState.endTime) }); }
      catch (err) { console.warn(LOG_PREFIX, '[ft] notify failed', err); }
    }
    log('finished', reason);
    broadcastChange();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'focus cleanup failed');
    return true;
  })();

  finishPromise = operation;
  try { return await operation; }
  finally { if (finishPromise === operation) finishPromise = null; }
}

/**
 * @param {number} durationMin
 * @param {{strict?: boolean, allowedHosts?: string[]}} opts
 */
export async function start(durationMin, opts = {}) {
  if (typeof durationMin !== 'number' || !Number.isFinite(durationMin) || durationMin <= 0) {
    throw new Error('invalid durationMin');
  }

  if (finishPromise) await finishPromise;
  if (state) await finish('replaced');

  const now = Date.now();
  const durationMs = durationMin * 60 * 1000;
  const nextState = {
    startTime: now,
    endTime: now + durationMs,
    durationMs,
    strict: opts.strict === true,
    allowedHosts: normalizeAllowedHosts(opts.allowedHosts),
  };

  await localSet(STORAGE_KEY.FOCUS_TIMER, nextState);
  state = nextState;
  try {
    await createAlarm(state.endTime);
    if (typeof onStateChange === 'function') await onStateChange(getStatus(), 'started');
  } catch (err) {
    const rollbackErrors = [err];
    if (typeof onStateChange === 'function') {
      try { await onStateChange(null, 'start-rollback'); }
      catch (cleanupErr) { rollbackErrors.push(cleanupErr); }
    }
    try {
      await localRemove(STORAGE_KEY.FOCUS_TIMER);
      state = null;
      try { await clearAlarm(); } catch (alarmErr) { rollbackErrors.push(alarmErr); }
    } catch (removeErr) {
      rollbackErrors.push(removeErr);
      if (typeof onStateChange === 'function') {
        try { await onStateChange(getStatus(), 'rollback-restore'); }
        catch (restoreErr) { rollbackErrors.push(restoreErr); }
      }
    }
    throw new AggregateError(rollbackErrors, 'focus start failed');
  }
  log('started', durationMin, 'min, strict =', state.strict);
  broadcastChange();
  return getStatus();
}

export async function stop() {
  await finish('stopped');
}

export function getStatus() {
  if (!state) return null;
  const now = Date.now();
  if (state.endTime <= now) {
    void finish('expired');
    return null;
  }
  return statusFromState(state, now);
}

/**
 * Restore state when the service worker starts.
 * @param {{emit?: Function, notify?: Function, onStateChange?: Function}} deps
 */
export async function init(deps = {}) {
  emit = deps.emit || null;
  notify = deps.notify || null;
  onStateChange = deps.onStateChange || null;
  if (finishPromise) await finishPromise;

  const stored = normalizeState(await localGet(STORAGE_KEY.FOCUS_TIMER));
  if (!stored) {
    state = null;
    return;
  }

  state = stored;
  if (state.endTime <= Date.now()) {
    await finish('expired');
    log('init: expired, cleaned up');
    return;
  }

  await localSet(STORAGE_KEY.FOCUS_TIMER, state);
  await createAlarm(state.endTime);
  if (typeof onStateChange === 'function') await onStateChange(getStatus(), 'restored');
  log('init: restored, remaining =', Math.round((state.endTime - Date.now()) / 1000), 's');
}

export async function onAlarm(alarmName) {
  if (alarmName !== ALARM_NAME) return;
  await finish('expired');
}
