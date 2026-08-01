import { STORAGE_KEY } from '../shared/constants.js';
import { normalizeHostnameInput } from '../shared/hostname.js';

const THEMES = new Set(['system', 'light', 'dark']);
const GROUP_MODES = new Set(['domain', 'category', 'custom']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'work', name: '工作', emoji: '', color: '#3B82F6', builtin: true },
  { id: 'learning', name: '学习', emoji: '', color: '#10B981', builtin: true },
  { id: 'entertainment', name: '娱乐', emoji: '', color: '#F59E0B', builtin: true },
  { id: 'social', name: '社交', emoji: '', color: '#EC4899', builtin: true },
  { id: 'shopping', name: '购物', emoji: '', color: '#8B5CF6', builtin: true },
  { id: 'news', name: '资讯', emoji: '', color: '#6B7280', builtin: true },
]);

const DEFAULT_CONFIG = Object.freeze({
  theme: 'system',
  historyRetentionDays: null,
  focusAllowedHosts: [],
  groupMode: 'domain',
  categories: DEFAULT_CATEGORIES,
  domainCategories: {},
  domainBudgets: {},
  customGroups: [],
});

const defaultStorage = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

let storage = defaultStorage;
let config = clone(DEFAULT_CONFIG);
let mutationQueue = Promise.resolve();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedId(value, label = 'id') {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const id = value.trim().toLowerCase();
  if (!ID_PATTERN.test(id)) throw new RangeError(`invalid ${label}`);
  return id;
}

function normalizedText(value, label, maxLength) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new RangeError(`invalid ${label}`);
  return text;
}

function normalizedOptionalText(value, label, maxLength) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (text.length > maxLength) throw new RangeError(`invalid ${label}`);
  return text;
}

function normalizedHost(value) {
  if (typeof value !== 'string') throw new TypeError('host must be a string');
  const raw = value.trim();
  if (!raw || /[\/@?#]/.test(raw) || raw.includes('://')) throw new RangeError('invalid host');
  const host = normalizeHostnameInput(raw);
  if (!host) throw new RangeError('invalid host');
  return host;
}

function normalizedHostRule(value) {
  if (typeof value !== 'string') throw new TypeError('host must be a string');
  const raw = value.trim();
  const wildcard = raw.startsWith('*.');
  const candidate = wildcard ? raw.slice(2) : raw;
  if (!candidate || /[\s/@?#]/.test(candidate)) throw new RangeError('invalid host rule');
  let host;
  try { host = new URL(`http://${candidate}`).hostname.toLowerCase().replace(/\.$/, ''); }
  catch (_) { throw new RangeError('invalid host rule'); }
  if (!host) throw new RangeError('invalid host rule');
  return wildcard ? `*.${host}` : host;
}

function normalizedHosts(value) {
  if (!Array.isArray(value)) throw new TypeError('hosts must be an array');
  return [...new Set(value.map(normalizedHostRule))];
}

function normalizedRetention(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('historyRetentionDays must be null or a positive integer');
  }
  return value;
}

function normalizedBudget(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('budget must be a positive integer');
  }
  return value;
}

function normalizedCategory(value, existing = null) {
  if (!isObject(value)) throw new TypeError('category must be an object');
  const category = {
    id: normalizedId(value.id, 'category id'),
    name: normalizedText(value.name, 'category name', 80),
    emoji: value.emoji === undefined
      ? (existing?.emoji ?? '')
      : normalizedOptionalText(value.emoji, 'category emoji', 16),
    color: value.color === undefined
      ? (existing?.color ?? '#6B7280')
      : String(value.color).trim().toUpperCase(),
    builtin: value.builtin === undefined ? (existing?.builtin ?? false) : value.builtin,
  };
  if (!COLOR_PATTERN.test(category.color)) throw new RangeError('invalid category color');
  if (typeof category.builtin !== 'boolean') throw new TypeError('category builtin must be boolean');
  return category;
}

function normalizedCustomGroup(value) {
  if (!isObject(value)) throw new TypeError('custom group must be an object');
  return {
    id: normalizedId(value.id, 'custom group id'),
    name: normalizedText(value.name, 'custom group name', 80),
    hosts: normalizedHosts(value.hosts),
  };
}

function safelyNormalize(value, fallback) {
  try {
    return value === undefined ? fallback : value();
  } catch (_) {
    return fallback;
  }
}

function normalizeStored(stored) {
  if (!isObject(stored)) return clone(DEFAULT_CONFIG);

  const categories = safelyNormalize(() => {
    if (!Array.isArray(stored.categories)) throw new TypeError();
    const result = [];
    const ids = new Set();
    for (const item of stored.categories) {
      try {
        const category = normalizedCategory(item);
        if (!ids.has(category.id)) {
          ids.add(category.id);
          result.push(category);
        }
      } catch (_) { /* discard corrupt entries */ }
    }
    return result;
  }, clone(DEFAULT_CATEGORIES));
  const categoryIds = new Set(categories.map(({ id }) => id));

  const result = {
    theme: THEMES.has(stored.theme) ? stored.theme : DEFAULT_CONFIG.theme,
    historyRetentionDays: safelyNormalize(
      () => normalizedRetention(stored.historyRetentionDays),
      DEFAULT_CONFIG.historyRetentionDays,
    ),
    focusAllowedHosts: safelyNormalize(
      () => normalizedHosts(stored.focusAllowedHosts),
      [],
    ),
    groupMode: GROUP_MODES.has(stored.groupMode) ? stored.groupMode : DEFAULT_CONFIG.groupMode,
    categories,
    domainCategories: {},
    domainBudgets: {},
    customGroups: [],
  };

  if (isObject(stored.domainCategories)) {
    for (const [rawHost, rawCategoryId] of Object.entries(stored.domainCategories)) {
      try {
        const host = normalizedHost(rawHost);
        const categoryId = normalizedId(rawCategoryId, 'category id');
        if (categoryIds.has(categoryId)) result.domainCategories[host] = categoryId;
      } catch (_) { /* discard corrupt mappings */ }
    }
  }
  if (isObject(stored.domainBudgets)) {
    for (const [rawHost, rawBudget] of Object.entries(stored.domainBudgets)) {
      try {
        result.domainBudgets[normalizedHost(rawHost)] = normalizedBudget(rawBudget);
      } catch (_) { /* discard corrupt budgets */ }
    }
  }
  if (Array.isArray(stored.customGroups)) {
    const ids = new Set();
    for (const item of stored.customGroups) {
      try {
        const group = normalizedCustomGroup(item);
        if (!ids.has(group.id)) {
          ids.add(group.id);
          result.customGroups.push(group);
        }
      } catch (_) { /* discard corrupt groups */ }
    }
  }
  return result;
}

function commit(change) {
  const operation = mutationQueue.then(async () => {
    const next = clone(config);
    change(next);
    await storage.set(STORAGE_KEY.CONFIG, clone(next));
    config = next;
    return getConfig();
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

export async function init(deps = {}) {
  const candidate = deps.storage ?? ((deps.get || deps.set) ? deps : defaultStorage);
  if (!candidate || typeof candidate.get !== 'function' || typeof candidate.set !== 'function') {
    throw new TypeError('storage must provide get and set functions');
  }
  const previousStorage = storage;
  const previousConfig = config;
  try {
    const stored = await candidate.get(STORAGE_KEY.CONFIG);
    storage = candidate;
    config = normalizeStored(stored);
  } catch (error) {
    storage = previousStorage;
    config = previousConfig;
    throw error;
  }
  return getConfig();
}

export function getConfig() {
  return clone(config);
}

export function updateTheme(theme) {
  if (!THEMES.has(theme)) throw new RangeError('invalid theme');
  return commit((next) => { next.theme = theme; });
}

export function updateRetention(days) {
  const retention = normalizedRetention(days);
  return commit((next) => { next.historyRetentionDays = retention; });
}

export function updateFocusAllowedHosts(hosts) {
  const normalized = normalizedHosts(hosts);
  return commit((next) => { next.focusAllowedHosts = normalized; });
}

export function updateGroupMode(mode) {
  if (!GROUP_MODES.has(mode)) throw new RangeError('invalid group mode');
  return commit((next) => { next.groupMode = mode; });
}

export function upsertCategory(category) {
  const id = normalizedId(category?.id, 'category id');
  const existing = config.categories.find((item) => item.id === id) ?? null;
  const normalized = normalizedCategory({ ...category, id }, existing);
  return commit((next) => {
    const index = next.categories.findIndex((item) => item.id === id);
    if (index === -1) next.categories.push(normalized);
    else next.categories[index] = normalized;
  });
}

export function removeCategory(categoryId) {
  const id = normalizedId(categoryId, 'category id');
  if (!config.categories.some((item) => item.id === id)) return Promise.resolve(getConfig());
  return commit((next) => {
    next.categories = next.categories.filter((item) => item.id !== id);
    for (const [host, mappedId] of Object.entries(next.domainCategories)) {
      if (mappedId === id) delete next.domainCategories[host];
    }
  });
}

export function setDomainCategory(host, categoryId) {
  const normalized = normalizedHost(host);
  if (categoryId === null) {
    return commit((next) => { delete next.domainCategories[normalized]; });
  }
  const id = normalizedId(categoryId, 'category id');
  if (!config.categories.some((item) => item.id === id)) {
    throw new RangeError('unknown category');
  }
  return commit((next) => { next.domainCategories[normalized] = id; });
}

export function setDomainBudget(host, budget) {
  const normalized = normalizedHost(host);
  if (budget === null) return commit((next) => { delete next.domainBudgets[normalized]; });
  const value = normalizedBudget(budget);
  return commit((next) => { next.domainBudgets[normalized] = value; });
}

export function setDomainRule(host, categoryId, budget) {
  const normalized = normalizedHost(host);
  const id = categoryId === null ? null : normalizedId(categoryId, 'category id');
  if (id && !config.categories.some((item) => item.id === id)) throw new RangeError('unknown category');
  const value = budget === null ? null : normalizedBudget(budget);
  return commit((next) => {
    if (id === null) delete next.domainCategories[normalized];
    else next.domainCategories[normalized] = id;
    if (value === null) delete next.domainBudgets[normalized];
    else next.domainBudgets[normalized] = value;
  });
}

export function upsertCustomGroup(group) {
  const normalized = normalizedCustomGroup(group);
  return commit((next) => {
    const index = next.customGroups.findIndex((item) => item.id === normalized.id);
    if (index === -1) next.customGroups.push(normalized);
    else next.customGroups[index] = normalized;
  });
}

export function removeCustomGroup(groupId) {
  const id = normalizedId(groupId, 'custom group id');
  if (!config.customGroups.some((item) => item.id === id)) return Promise.resolve(getConfig());
  return commit((next) => {
    next.customGroups = next.customGroups.filter((item) => item.id !== id);
  });
}
