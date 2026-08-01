import { STORAGE_KEY } from '../shared/constants.js';

const SESSION_KEY = STORAGE_KEY.FOCUS_GUARD_SESSION;
const INTERNAL_PROTOCOLS = new Set([
  'about:', 'chrome:', 'chrome-extension:', 'devtools:', 'edge:', 'moz-extension:',
]);

function hostnameFromValue(value) {
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
  try { return new URL(`http://${text}`).hostname.toLowerCase().replace(/\.$/, '') || null; }
  catch (_) { return null; }
}

export function normalizeHostRule(value) {
  const raw = String(value ?? '').trim();
  const wildcard = raw.startsWith('*.');
  const hostname = hostnameFromValue(wildcard ? raw.slice(2) : raw);
  return hostname ? `${wildcard ? '*.' : ''}${hostname}` : null;
}

export function normalizeAllowedHosts(values) {
  if (!Array.isArray(values)) return [];
  const rules = new Set(values.map(normalizeHostRule).filter(Boolean));
  return [...rules].sort();
}

export function isHostAllowed(hostname, rules, sessionHosts = []) {
  const host = hostnameFromValue(hostname);
  if (!host) return false;
  if (new Set(sessionHosts).has(host)) return true;
  return normalizeAllowedHosts(rules).some((rule) => (
    rule.startsWith('*.')
      ? host.endsWith(`.${rule.slice(2)}`)
      : host === rule
  ));
}

export function isInternalUrl(url) {
  try { return INTERNAL_PROTOCOLS.has(new URL(url).protocol); }
  catch (_) { return true; }
}

function defaultToken() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Dependency-injected strict-mode tab guard. Call init/sync from the service
 * worker when wiring it to focusTimer; no manifest permissions are required.
 */
export function createFocusGuard(deps = {}) {
  const tabs = deps.tabs || globalThis.chrome?.tabs;
  const runtime = deps.runtime || globalThis.chrome?.runtime;
  const storageDependency = deps.storage || globalThis.chrome?.storage;
  const storage = storageDependency?.local || storageDependency;
  const now = deps.now || (() => Date.now());
  const createToken = deps.createToken || defaultToken;
  const attachListeners = deps.attachListeners !== false;
  if (!tabs || !runtime || !storage) throw new Error('focusGuard requires tabs, runtime, and storage');

  let active = false;
  let strict = false;
  let startTime = null;
  let endTime = null;
  let allowedRules = [];
  let attached = false;
  const sessionAllowedHosts = new Set();
  const blockedByToken = new Map();
  const tokenByTab = new Map();
  const blockedPageUrl = runtime.getURL('blocked.html');

  const sessionId = () => `${startTime ?? ''}:${endTime ?? ''}`;

  function snapshot() {
    return {
      active,
      strict,
      startTime,
      endTime,
      allowedHosts: [...allowedRules],
      sessionAllowedHosts: [...sessionAllowedHosts],
      blocked: [...blockedByToken.values()],
    };
  }

  async function persist() {
    if (!active && blockedByToken.size === 0) {
      await storage.remove(SESSION_KEY);
      return;
    }
    await storage.set({ [SESSION_KEY]: snapshot() });
  }

  async function load() {
    const data = (await storage.get(SESSION_KEY))[SESSION_KEY];
    if (!data || typeof data !== 'object') return;
    active = data.active === true;
    strict = data.strict === true;
    startTime = typeof data.startTime === 'number' ? data.startTime : null;
    endTime = typeof data.endTime === 'number' ? data.endTime : null;
    allowedRules = normalizeAllowedHosts(data.allowedHosts);
    sessionAllowedHosts.clear();
    for (const host of data.sessionAllowedHosts || []) {
      const normalized = hostnameFromValue(host);
      if (normalized) sessionAllowedHosts.add(normalized);
    }
    blockedByToken.clear();
    tokenByTab.clear();
    for (const entry of data.blocked || []) {
      if (!entry?.token || typeof entry.tabId !== 'number' || !entry.url) continue;
      blockedByToken.set(entry.token, entry);
      tokenByTab.set(entry.tabId, entry.token);
    }
  }

  function isBlockedPage(url) {
    return typeof url === 'string' && (url === blockedPageUrl || url.startsWith(`${blockedPageUrl}?`));
  }

  async function restoreBlockedTabs() {
    let restored = 0;
    const failures = [];
    for (const entry of [...blockedByToken.values()]) {
      try {
        await tabs.update(entry.tabId, { url: entry.url });
        blockedByToken.delete(entry.token);
        tokenByTab.delete(entry.tabId);
        restored++;
      } catch (err) {
        // 已关闭的 tab 视为完成；其他失败保留恢复记录供下次重试。
        if (/No tab|not found|closed/i.test(String(err?.message || err))) {
          blockedByToken.delete(entry.token);
          tokenByTab.delete(entry.tabId);
        } else failures.push(err);
      }
    }
    await persist();
    if (failures.length) throw new AggregateError(failures, 'failed to restore blocked tabs');
    return restored;
  }

  async function stop(reason = 'stopped') {
    active = false;
    strict = false;
    const restored = await restoreBlockedTabs();
    startTime = null;
    endTime = null;
    allowedRules = [];
    sessionAllowedHosts.clear();
    await persist();
    return { reason, restored };
  }

  async function checkExpiry() {
    if (active && typeof endTime === 'number' && endTime <= now()) {
      await stop('expired');
      return true;
    }
    return false;
  }

  async function enforceTab(tab) {
    if (await checkExpiry()) return { action: 'expired' };
    if (!active || !strict || !tab || tab.active === false || typeof tab.id !== 'number') {
      return { action: 'ignored' };
    }
    if (!tab.url || isBlockedPage(tab.url) || isInternalUrl(tab.url)) return { action: 'allowed' };

    let parsed;
    try { parsed = new URL(tab.url); }
    catch (_) { return { action: 'allowed' }; }
    if (isHostAllowed(parsed.hostname, allowedRules, sessionAllowedHosts)) return { action: 'allowed' };

    const existingToken = tokenByTab.get(tab.id);
    if (existingToken) {
      const blockedUrl = `${blockedPageUrl}?token=${encodeURIComponent(existingToken)}`;
      if (tab.url !== blockedUrl) await tabs.update(tab.id, { url: blockedUrl });
      return { action: 'blocked', token: existingToken };
    }

    const token = String(createToken());
    const entry = { token, tabId: tab.id, url: tab.url, hostname: parsed.hostname.toLowerCase() };
    blockedByToken.set(token, entry);
    tokenByTab.set(tab.id, token);
    await persist();
    try {
      await tabs.update(tab.id, { url: `${blockedPageUrl}?token=${encodeURIComponent(token)}` });
    } catch (err) {
      blockedByToken.delete(token);
      tokenByTab.delete(tab.id);
      await persist();
      throw err;
    }
    return { action: 'blocked', token };
  }

  async function enforceActiveTabs() {
    if (await checkExpiry() || !active || !strict) return [];
    const activeTabs = await tabs.query({ active: true });
    const results = [];
    for (const tab of activeTabs) results.push(await enforceTab(tab));
    return results;
  }

  async function sync(timerStatus) {
    if (!timerStatus?.active || timerStatus.strict !== true) return stop('inactive');
    if (typeof timerStatus.endTime === 'number' && timerStatus.endTime <= now()) return stop('expired');

    const nextId = `${timerStatus.startTime ?? ''}:${timerStatus.endTime ?? ''}`;
    if (active && sessionId() !== nextId) await stop('replaced');
    active = true;
    strict = true;
    startTime = typeof timerStatus.startTime === 'number' ? timerStatus.startTime : null;
    endTime = typeof timerStatus.endTime === 'number' ? timerStatus.endTime : null;
    allowedRules = normalizeAllowedHosts(timerStatus.allowedHosts);
    await persist();
    return enforceActiveTabs();
  }

  async function allowTokenHost(token) {
    const entry = blockedByToken.get(token);
    if (!entry) return false;
    const hostname = hostnameFromValue(entry.hostname || entry.url);
    if (hostname) sessionAllowedHosts.add(hostname);
    try { await tabs.update(entry.tabId, { url: entry.url }); }
    catch (err) {
      if (hostname) sessionAllowedHosts.delete(hostname);
      throw err;
    }
    blockedByToken.delete(token);
    tokenByTab.delete(entry.tabId);
    await persist();
    return true;
  }

  async function returnToken(token) {
    const entry = blockedByToken.get(token);
    if (!entry) return false;
    if (typeof tabs.goBack === 'function') await tabs.goBack(entry.tabId);
    else await tabs.update(entry.tabId, { url: entry.url });
    blockedByToken.delete(token);
    tokenByTab.delete(entry.tabId);
    await persist();
    return true;
  }

  async function onActivated(info) {
    if (!info || typeof info.tabId !== 'number') return { action: 'ignored' };
    return enforceTab(await tabs.get(info.tabId));
  }

  async function onUpdated(_tabId, changeInfo, tab) {
    if (!changeInfo?.url && changeInfo?.status !== 'complete') return { action: 'ignored' };
    return enforceTab(tab);
  }

  async function onRemoved(tabId) {
    const token = tokenByTab.get(tabId);
    if (!token) return;
    tokenByTab.delete(tabId);
    blockedByToken.delete(token);
    await persist();
  }

  function attach() {
    if (attached) return;
    tabs.onActivated?.addListener(onActivated);
    tabs.onUpdated?.addListener(onUpdated);
    tabs.onRemoved?.addListener(onRemoved);
    attached = true;
  }

  function detach() {
    if (!attached) return;
    tabs.onActivated?.removeListener(onActivated);
    tabs.onUpdated?.removeListener(onUpdated);
    tabs.onRemoved?.removeListener(onRemoved);
    attached = false;
  }

  async function init(timerStatus) {
    await load();
    if (attachListeners) attach();
    return sync(timerStatus);
  }

  return {
    init, sync, stop, expire: () => stop('expired'), checkExpiry, enforceTab, enforceActiveTabs,
    restoreBlockedTabs, allowTokenHost, returnToken, onActivated, onUpdated,
    onRemoved, attach, detach,
    getBlocked(token) { return blockedByToken.get(token) || null; },
    getState() { return snapshot(); },
  };
}
