import { MSG } from '../shared/messages.js';
import * as configService from './configService.js';
import * as savedStore from './savedStore.js';
import * as focusTimer from './focusTimer.js';
import { createFocusGuard } from './focusGuard.js';
import { createHistoryService } from './historyService.js';
import * as timeTracker from './timeTracker.js';
import { STORAGE_KEY } from '../shared/constants.js';
import { localGet, localSet } from './store.js';

let emit = null;
let guard = null;
let history = null;
let initialized = false;
let budgetNoticeDay = '';
const notifiedBudgets = new Set();

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function broadcastConfig(config = configService.getConfig()) {
  emit?.(MSG.BCAST_CONFIG_CHANGE, { config });
}

async function notifyFocusComplete() {
  await chrome.notifications.create(`tempus-focus-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '专注时间结束',
    message: '本次 Focus Timer 已完成。休息一下，再开始下一轮。',
  });
}

export async function init(deps = {}) {
  if (initialized) return;
  emit = deps.emit || null;
  await configService.init();
  await savedStore.init();
  history = createHistoryService({ timeTracker });
  const config = configService.getConfig();
  history.setRetention(config.historyRetentionDays);
  const today = localDayKey();
  if (await localGet(STORAGE_KEY.RETENTION_LAST_APPLIED) !== today) {
    await history.applyRetention();
    await localSet(STORAGE_KEY.RETENTION_LAST_APPLIED, today);
  }
  const noticeState = await localGet(STORAGE_KEY.BUDGET_NOTICES);
  budgetNoticeDay = noticeState?.day === today ? today : '';
  notifiedBudgets.clear();
  for (const host of noticeState?.day === today ? noticeState.hosts || [] : []) notifiedBudgets.add(host);

  const nextGuard = createFocusGuard({ attachListeners: false });
  let guardReady = false;
  try {
    await focusTimer.init({
      emit,
      notify: notifyFocusComplete,
      onStateChange: async (status) => {
        if (guardReady) await nextGuard.sync(status);
      },
    });
    await nextGuard.init(focusTimer.getStatus());
    guardReady = true;
    guard = nextGuard;
    initialized = true;
  } catch (err) {
    nextGuard.detach();
    throw err;
  }
}

export function getState() {
  return {
    config: configService.getConfig(),
    focusTimer: focusTimer.getStatus(),
  };
}

export function onTabActivated(info) { return guard?.onActivated(info); }
export function onTabUpdated(tabId, changeInfo, tab) {
  return guard?.onUpdated(tabId, changeInfo, tab);
}
export function onTabRemoved(tabId) { return guard?.onRemoved(tabId); }

export async function onTick() {
  if (!initialized) return;
  const guardState = guard?.getState();
  if (!focusTimer.getStatus() && (guardState?.active || guardState?.blocked.length)) {
    await guard.stop('recovery-retry');
  }
  const day = localDayKey();
  if (day !== budgetNoticeDay) {
    budgetNoticeDay = day;
    notifiedBudgets.clear();
    await localSet(STORAGE_KEY.BUDGET_NOTICES, { day, hosts: [] });
  }
  const config = configService.getConfig();
  const usage = timeTracker.getDomainTodayMs();
  for (const [host, budgetMs] of Object.entries(config.domainBudgets || {})) {
    if ((usage[host] || 0) < budgetMs || notifiedBudgets.has(host)) continue;
    await chrome.notifications.create(`tempus-budget-${day}-${host}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '今日时间预算已用完',
      message: `${host} 已达到今日设置的时间预算。`,
    });
    notifiedBudgets.add(host);
    await localSet(STORAGE_KEY.BUDGET_NOTICES, { day, hosts: [...notifiedBudgets] });
  }
}

async function updateConfig(operation) {
  const config = await operation();
  broadcastConfig(config);
  return { config };
}

async function stopFocus() {
  let timerError = null;
  try { await focusTimer.stop(); } catch (err) { timerError = err; }
  let guardError = null;
  try { await guard.stop('manual'); } catch (err) { guardError = err; }
  if (timerError || guardError) throw timerError || guardError;
  return { stopped: true };
}

export async function handleRequest(message, tabRegistry) {
  switch (message.type) {
    case MSG.REQ_SAVE_FOR_LATER: {
      const tab = tabRegistry.get(message.tabId);
      if (!tab) throw new Error('tab not found');
      const result = await savedStore.save(tab);
      emit?.(MSG.BCAST_SAVED_CHANGE, { saved: savedStore.list() });
      return result;
    }
    case MSG.REQ_GET_SAVED:
      return { saved: savedStore.list() };
    case MSG.REQ_REMOVE_SAVED: {
      if (!message.id) throw new Error('invalid id');
      const removed = await savedStore.remove(message.id);
      emit?.(MSG.BCAST_SAVED_CHANGE, { saved: savedStore.list() });
      return { removed, id: message.id };
    }
    case MSG.REQ_GET_CONFIG:
      return { config: configService.getConfig() };
    case MSG.REQ_SET_THEME:
      return updateConfig(() => configService.updateTheme(message.theme));
    case MSG.REQ_SET_FOCUS_HOSTS:
      return updateConfig(() => configService.updateFocusAllowedHosts(message.hosts));
    case MSG.REQ_SET_GROUP_MODE:
      return updateConfig(() => configService.updateGroupMode(message.mode));
    case MSG.REQ_UPSERT_CATEGORY:
      return updateConfig(() => configService.upsertCategory(message.category));
    case MSG.REQ_REMOVE_CATEGORY:
      return updateConfig(() => configService.removeCategory(message.categoryId));
    case MSG.REQ_SET_DOMAIN_CATEGORY:
      return updateConfig(() => configService.setDomainCategory(message.hostname, message.categoryId));
    case MSG.REQ_SET_DOMAIN_BUDGET:
      return updateConfig(() => configService.setDomainBudget(message.hostname, message.budgetMs));
    case MSG.REQ_SET_DOMAIN_RULE:
      return updateConfig(() => configService.setDomainRule(
        message.hostname, message.categoryId, message.budgetMs,
      ));
    case MSG.REQ_UPSERT_CUSTOM_GROUP:
      return updateConfig(() => configService.upsertCustomGroup(message.group));
    case MSG.REQ_REMOVE_CUSTOM_GROUP:
      return updateConfig(() => configService.removeCustomGroup(message.groupId));
    case MSG.REQ_SET_RETENTION: {
      const result = await updateConfig(() => configService.updateRetention(message.days));
      history.setRetention(result.config.historyRetentionDays);
      result.prunedSlices = await history.applyRetention();
      return result;
    }
    case MSG.REQ_EXPORT_HISTORY: {
      const format = message.format === 'csv' ? 'csv' : 'json';
      return {
        text: await history.exportData(format),
        mime: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        filename: `tabpus-history-${new Date().toISOString().slice(0, 10)}.${format}`,
      };
    }
    case MSG.REQ_CLEAR_HISTORY:
      return { clearedShards: await history.clearHistory() };
    case MSG.REQ_START_FOCUS_TIMER: {
      const config = configService.getConfig();
      const opts = {
        strict: message.strict === true,
        allowedHosts: Array.isArray(message.allowedHosts)
          ? message.allowedHosts
          : config.focusAllowedHosts,
      };
      return focusTimer.start(message.durationMin, opts);
    }
    case MSG.REQ_STOP_FOCUS_TIMER:
      return stopFocus();
    case MSG.REQ_FOCUS_GUARD_RETURN:
      return { handled: await guard.returnToken(message.token) };
    case MSG.REQ_FOCUS_GUARD_ALLOW:
      return { handled: await guard.allowTokenHost(message.token) };
    case MSG.REQ_FOCUS_GUARD_STOP:
      await stopFocus();
      return { handled: true };
    default:
      return null;
  }
}
