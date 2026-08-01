import { normalizeUrl } from '../shared/hostname.js';
import { STORAGE_KEY } from '../shared/constants.js';
import { localGet as defaultLocalGet, localSet as defaultLocalSet } from './store.js';

let deps = {
  localGet: defaultLocalGet,
  localSet: defaultLocalSet,
};
let entries = [];
let mutationQueue = Promise.resolve();
let idSequence = 0;

function newestFirst(a, b) {
  return Number(b.savedAt || 0) - Number(a.savedAt || 0);
}

function copyEntry(entry) {
  return { ...entry };
}

function enqueueMutation(operation) {
  const result = mutationQueue.then(operation);
  mutationQueue = result.catch(() => {});
  return result;
}

/** Load saved entries and optionally replace storage dependencies for testing. */
export function init(overrides = {}) {
  return enqueueMutation(async () => {
    deps = {
      localGet: overrides.localGet || defaultLocalGet,
      localSet: overrides.localSet || defaultLocalSet,
    };

    const loaded = await deps.localGet(STORAGE_KEY.SAVED);
    const stored = Array.isArray(loaded) ? loaded : [];
    const candidates = stored
      .filter((entry) => entry && typeof entry === 'object' && normalizeUrl(entry.url))
      .map(copyEntry)
      .sort(newestFirst);
    const seen = new Set();
    const next = candidates.filter((entry) => {
      const normalized = normalizeUrl(entry.url);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    if (next.length !== stored.length) {
      await deps.localSet(STORAGE_KEY.SAVED, next.map(copyEntry));
    }
    entries = next;
    return list();
  });
}

/** Return a detached, newest-first snapshot. */
export function list() {
  return entries.map(copyEntry).sort(newestFirst);
}

/** Save a tab once per normalized URL. */
export function save(tab) {
  return enqueueMutation(async () => {
    const normalized = normalizeUrl(tab?.url);
    const existing = normalized
      ? entries.find((entry) => normalizeUrl(entry.url) === normalized)
      : null;

    if (existing) {
      return { entry: copyEntry(existing), created: false };
    }

    const savedAt = Date.now();
    const sequence = ++idSequence;
    const entry = {
      id: `saved-${savedAt}-${tab?.id ?? sequence}-${sequence}`,
      url: typeof tab?.url === 'string' ? tab.url : '',
      title: tab?.title || tab?.url || '',
      favIconUrl: tab?.favIconUrl || '',
      savedAt,
    };
    const next = [entry, ...entries].sort(newestFirst);

    await deps.localSet(STORAGE_KEY.SAVED, next.map(copyEntry));
    entries = next;
    return { entry: copyEntry(entry), created: true };
  });
}

/** Remove an entry by id. Returns true when an entry was removed. */
export function remove(id) {
  return enqueueMutation(async () => {
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return false;

    await deps.localSet(STORAGE_KEY.SAVED, next.map(copyEntry));
    entries = next;
    return true;
  });
}

/** Test whether a normalized URL is already saved. */
export function isSavedUrl(url) {
  const normalized = normalizeUrl(url);
  return Boolean(normalized) && entries.some((entry) => normalizeUrl(entry.url) === normalized);
}
