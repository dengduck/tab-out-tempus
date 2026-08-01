import { suite, test, assert } from './testUtil.js';
import * as savedStore from '../background/savedStore.js';

function makeStorage(initial = [], writeHook = null) {
  let stored = initial.map((entry) => ({ ...entry }));
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let writeCount = 0;

  return {
    async localGet(key) {
      assert.equal(key, 'saved');
      return stored.map((entry) => ({ ...entry }));
    },
    async localSet(key, value) {
      assert.equal(key, 'saved');
      activeWrites++;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      writeCount++;
      try {
        if (writeHook) await writeHook(value, writeCount);
        stored = value.map((entry) => ({ ...entry }));
      } finally {
        activeWrites--;
      }
    },
    snapshot: () => stored.map((entry) => ({ ...entry })),
    maxActiveWrites: () => maxActiveWrites,
    writeCount: () => writeCount,
  };
}

function entry(id, url, savedAt, title = id) {
  return { id, url, title, favIconUrl: '', savedAt };
}

async function expectRejected(promise, message) {
  let rejected = false;
  try {
    await promise;
  } catch {
    rejected = true;
  }
  assert.ok(rejected, message);
}

suite('Saved store', () => {
  test('init and list return detached entries newest first', async () => {
    const storage = makeStorage([
      entry('old', 'https://example.com/old', 10),
      entry('new', 'https://example.com/new', 20),
    ]);

    await savedStore.init(storage);
    const listed = savedStore.list();
    assert.deepEqual(listed.map((item) => item.id), ['new', 'old']);

    listed[0].title = 'changed outside';
    assert.equal(savedStore.list()[0].title, 'new');
  });

  test('init removes legacy duplicate URLs and keeps newest entry', async () => {
    const storage = makeStorage([
      entry('old', 'https://www.example.com/page/', 10),
      entry('new', 'https://example.com/page', 20),
    ]);
    await savedStore.init(storage);
    assert.deepEqual(savedStore.list().map((item) => item.id), ['new']);
    assert.deepEqual(storage.snapshot().map((item) => item.id), ['new']);
  });

  test('serializes concurrent saves and deduplicates normalized URLs', async () => {
    const storage = makeStorage([], async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await savedStore.init(storage);

    const [first, duplicate, other] = await Promise.all([
      savedStore.save({ id: 1, url: 'https://www.example.com/page/?b=2&a=1#top', title: 'First' }),
      savedStore.save({ id: 2, url: 'https://example.com/page?a=1&b=2', title: 'Duplicate' }),
      savedStore.save({ id: 3, url: 'https://example.com/other', title: 'Other' }),
    ]);

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.entry.id, first.entry.id);
    assert.equal(other.created, true);
    assert.equal(storage.writeCount(), 2, 'duplicate save should not write');
    assert.equal(storage.maxActiveWrites(), 1, 'writes must be serialized');
    assert.equal(savedStore.list().length, 2);
    assert.equal(storage.snapshot().length, 2);
    assert.equal(savedStore.isSavedUrl('https://example.com/page/?a=1&b=2#later'), true);
    assert.equal(savedStore.isSavedUrl('chrome://extensions'), false);
  });

  test('failed save does not change memory and later mutations still run', async () => {
    const storage = makeStorage([], async (_value, writeCount) => {
      if (writeCount === 1) throw new Error('disk full');
    });
    await savedStore.init(storage);

    await expectRejected(
      savedStore.save({ id: 1, url: 'https://example.com/failed', title: 'Failed' }),
      'failed write should reject',
    );
    assert.deepEqual(savedStore.list(), []);

    const result = await savedStore.save({ id: 2, url: 'https://example.com/ok', title: 'OK' });
    assert.equal(result.created, true);
    assert.equal(savedStore.list().length, 1, 'queue should recover after rejection');
  });

  test('failed remove keeps the entry in memory', async () => {
    const original = entry('keep', 'https://example.com/keep', 30, 'Keep');
    const storage = makeStorage([original], async () => {
      throw new Error('write failed');
    });
    await savedStore.init(storage);

    await expectRejected(savedStore.remove('keep'), 'failed remove should reject');
    assert.deepEqual(savedStore.list(), [original]);
    assert.equal(savedStore.isSavedUrl(original.url), true);
  });
});
