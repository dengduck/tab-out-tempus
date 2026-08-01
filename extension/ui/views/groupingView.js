import { normalizeHostnameInput } from '../../shared/hostname.js';

const GROUP_MODES = new Set(['domain', 'category', 'custom']);
const WARNING_RATIO = 0.8;

function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  const raw = host.trim();
  if (raw.startsWith('*.')) {
    const base = normalizeHostnameInput(raw.slice(2));
    return base ? `*.${base}` : '';
  }
  return normalizeHostnameInput(raw);
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([id, item]) => {
    if (Array.isArray(item)) return { id, name: id, domains: item };
    return { id, ...item };
  });
}

function matchesHost(candidate, host) {
  const pattern = normalizeHost(candidate);
  if (!pattern) return false;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return pattern === host;
}

function findCustomGroup(host, config) {
  return asList(config?.customGroups).find((group) => {
    const domains = group?.domains ?? group?.hosts ?? [];
    return Array.isArray(domains) && domains.some((domain) => matchesHost(domain, host));
  }) ?? null;
}

function categoryIdForHost(host, config) {
  const assignments = config?.domainCategories ?? {};
  if (Object.prototype.hasOwnProperty.call(assignments, host)) return assignments[host];

  for (const [domain, categoryId] of Object.entries(assignments)) {
    if (matchesHost(domain, host)) return categoryId;
  }
  return null;
}

function findCategory(host, config) {
  const categoryId = categoryIdForHost(host, config);
  if (categoryId === null || categoryId === undefined) return null;
  return asList(config?.categories).find((category) => category?.id === categoryId) ?? null;
}

function descriptor(type, item, fallbackName) {
  const id = String(item?.id ?? fallbackName);
  return {
    id,
    name: String(item?.name ?? fallbackName ?? id),
    type,
  };
}

function uncategorized(config) {
  return {
    id: 'uncategorized',
    name: String(config?.uncategorizedName ?? 'Uncategorized'),
    type: 'uncategorized',
  };
}

/**
 * Resolves the presentation group for one hostname.
 * Custom mode falls back from custom groups to categories, then Uncategorized.
 *
 * @param {string} host
 * @param {{groupMode?:'domain'|'category'|'custom'}} config
 * @returns {{id:string,name:string,type:'domain'|'category'|'custom'|'uncategorized'}}
 */
export function resolveGroupForHost(host, config = {}) {
  const hostname = normalizeHost(host);
  const mode = GROUP_MODES.has(config.groupMode) ? config.groupMode : 'domain';

  if (mode === 'domain' && hostname) {
    return { id: hostname, name: hostname, type: 'domain' };
  }

  if (mode === 'custom') {
    const customGroup = findCustomGroup(hostname, config);
    if (customGroup) return descriptor('custom', customGroup, customGroup.id);
  }

  const category = findCategory(hostname, config);
  if (category) return descriptor('category', category, category.id);
  return uncategorized(config);
}

/**
 * Regroups existing `{ hostname, tabs }` domain groups without mutating them.
 * Output order follows the first domain encountered for each resolved group.
 *
 * @param {Array<{hostname:string,tabs?:Array}>|{groups?:Array}} domainGroups
 * @param {object} config
 * @returns {Array<{id:string,name:string,type:string,domains:Array,tabs:Array}>}
 */
export function groupDomains(domainGroups, config = {}) {
  const source = Array.isArray(domainGroups) ? domainGroups : domainGroups?.groups ?? [];
  const buckets = new Map();

  for (const domainGroup of source) {
    if (!domainGroup || typeof domainGroup !== 'object') continue;
    const host = domainGroup.hostname ?? domainGroup.host ?? domainGroup.domain ?? '';
    const group = resolveGroupForHost(host, config);
    const key = `${group.type}:${group.id}`;

    if (!buckets.has(key)) {
      buckets.set(key, { ...group, domains: [], tabs: [] });
    }

    const bucket = buckets.get(key);
    bucket.domains.push(domainGroup);
    if (Array.isArray(domainGroup.tabs)) bucket.tabs.push(...domainGroup.tabs);
  }

  return Array.from(buckets.values());
}

function numericBudget(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function budgetFrom(map, key) {
  if (!map || key === null || key === undefined) return null;
  return numericBudget(map[key]);
}

/** Return the exact-domain daily budget in milliseconds. */
export function resolveBudget(host, config = {}) {
  const hostname = normalizeHost(host);
  return hostname ? budgetFrom(config.domainBudgets, hostname) : null;
}

/**
 * @param {number} used
 * @param {number|null|undefined} budget
 * @returns {'none'|'ok'|'warning'|'exceeded'}
 */
export function budgetStatus(used, budget) {
  const limit = numericBudget(budget);
  if (limit === null) return 'none';

  const consumed = typeof used === 'number' && Number.isFinite(used) ? Math.max(0, used) : 0;
  if (consumed >= limit) return 'exceeded';
  if (consumed >= limit * WARNING_RATIO) return 'warning';
  return 'ok';
}
