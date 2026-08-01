import { suite, test, assert } from './testUtil.js';
import { localGet, localSet, localRemove } from '../background/store.js';

async function expectSameRejection(promise, expected) {
  let received = null;
  try { await promise; } catch (err) { received = err; }
  assert.equal(received, expected, 'storage error propagates unchanged');
}

suite('Storage error propagation', () => {
  test('get/set/remove reject instead of reporting false success', async () => {
    const area = chrome.storage.local;
    const original = { get: area.get, set: area.set, remove: area.remove };
    const failure = new Error('quota/storage unavailable');
    try {
      area.get = async () => { throw failure; };
      await expectSameRejection(localGet('x'), failure);
      area.set = async () => { throw failure; };
      await expectSameRejection(localSet('x', 1), failure);
      area.remove = async () => { throw failure; };
      await expectSameRejection(localRemove('x'), failure);
    } finally {
      area.get = original.get;
      area.set = original.set;
      area.remove = original.remove;
    }
  });
});
