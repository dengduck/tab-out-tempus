import { STORAGE_KEY, LOG_PREFIX } from '../shared/constants.js';
import { localGet, localSet, localRemove } from './store.js';
import { appendSlice } from './timeLog.js';

const pendingSlices = [];
let pendingFlush = null;
let snapshotQueue = Promise.resolve();

export function sliceId(slice) {
  return `${slice.s}:${slice.e}:${slice.tid}:${slice.h}`;
}

export function queueSlice(candidate) {
  const slice = { ...candidate, id: candidate.id || sliceId(candidate) };
  pendingSlices.push(slice);
  const flush = flushPending();
  flush.catch((err) => console.error(LOG_PREFIX, 'pending slice flush failed', err));
  return flush;
}

export function flushPending() {
  if (pendingFlush) return pendingFlush;
  pendingFlush = (async () => {
    while (pendingSlices.length > 0) {
      await appendSlice(pendingSlices[0]);
      pendingSlices.shift();
    }
  })().finally(() => { pendingFlush = null; });
  return pendingFlush;
}

async function writeSnapshot(active) {
  const pending = pendingSlices.map((slice) => ({ ...slice }));
  if (active?.tabId !== null && typeof active?.sliceStart === 'number') {
    await localSet(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT, { ...active, pending });
  } else if (pending.length > 0) {
    await localSet(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT, {
      tabId: null, hostname: '', sliceStart: null, pending,
    });
  } else {
    await localRemove(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
  }
}

export function persist(active) {
  snapshotQueue = snapshotQueue.then(() => writeSnapshot(active), () => writeSnapshot(active));
  return snapshotQueue;
}

export function loadSnapshot() {
  return localGet(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
}

export function clearSnapshot() {
  return localRemove(STORAGE_KEY.ACTIVE_SLICE_SNAPSHOT);
}

export function reset() {
  pendingSlices.length = 0;
  pendingFlush = null;
  snapshotQueue = Promise.resolve();
}
