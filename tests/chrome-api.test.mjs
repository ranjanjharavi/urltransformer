import test from 'node:test';
import assert from 'node:assert/strict';
import { createChromeApi, createStoragePersistence, createStorageWriter } from '../src/chrome-api.mjs';

function deferredStorage() {
  const writes = [];
  const storage = {
    set(snapshot) {
      return new Promise((resolve, reject) => writes.push({ snapshot, resolve, reject }));
    }
  };
  return { storage, writes };
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test('serializes snapshots within a domain while allowing other domains to write', async () => {
  const { storage, writes } = deferredStorage();
  const write = createStorageWriter(storage);
  const first = write('parameters', { rules: ['one'] });
  const second = write('parameters', { rules: ['one', 'two'] });
  const token = write('tokens', { token: 'selected' });

  await flushMicrotasks();
  assert.deepEqual(writes.map(({ snapshot }) => snapshot), [
    { rules: ['one'] }, { token: 'selected' }
  ]);

  writes[0].resolve();
  writes[1].resolve();
  await first;
  await token;
  await flushMicrotasks();
  assert.deepEqual(writes[2].snapshot, { rules: ['one', 'two'] });
  writes[2].resolve();
  await second;
});

test('reports a failed write but still runs the next snapshot', async () => {
  const { storage, writes } = deferredStorage();
  const write = createStorageWriter(storage);
  const first = write('tokens', { token: 'old' });
  const second = write('tokens', { token: 'new' });

  await flushMicrotasks();
  writes[0].reject(new Error('Storage unavailable'));
  await assert.rejects(first, /Storage unavailable/);
  await flushMicrotasks();
  assert.deepEqual(writes[1].snapshot, { token: 'new' });
  writes[1].resolve();
  await second;
});

test('queues Chrome storage callbacks after a reported write error', async () => {
  const callbacks = [];
  const saved = {};
  const chromeApi = {
    runtime: { lastError: null },
    storage: { local: {
      get: (defaults, done) => done({ ...defaults, ...saved }),
      set: (snapshot, done) => callbacks.push({ snapshot, done })
    } }
  };
  const storage = createChromeApi(chromeApi).storage;
  const write = createStorageWriter(storage);
  const first = write('tokens', { token: 'first' });
  const second = write('tokens', { token: 'second' });

  await flushMicrotasks();
  assert.equal(callbacks.length, 1);
  chromeApi.runtime.lastError = { message: 'Storage unavailable' };
  callbacks[0].done();
  chromeApi.runtime.lastError = null;
  await assert.rejects(first, /Storage unavailable/);

  await flushMicrotasks();
  Object.assign(saved, callbacks[1].snapshot);
  callbacks[1].done();
  await second;
  assert.deepEqual(await storage.get({ token: '' }), { token: 'second' });
});

test('restores saved state after the current snapshot fails without swallowing the write error', async () => {
  const savedRules = ['saved'];
  const storage = {
    set: async () => { throw new Error('Storage unavailable'); },
    get: async (defaults) => ({ ...defaults, rules: savedRules })
  };
  const persist = createStoragePersistence(storage);
  let restoredRules;

  await assert.rejects(persist({
    domain: 'parameters',
    snapshot: { rules: ['pending'] },
    defaults: { rules: [] },
    isCurrent: () => true,
    restore: (stored) => { restoredRules = stored.rules; }
  }), /Storage unavailable/);

  assert.deepEqual(restoredRules, savedRules);
});

test('does not roll back newer state when an older queued snapshot fails', async () => {
  const { storage, writes } = deferredStorage();
  let reads = 0;
  storage.get = async () => { reads += 1; return { rules: ['saved'] }; };
  const persist = createStoragePersistence(storage);
  const firstRules = ['one'];
  const secondRules = ['one', 'two'];
  let currentRules = firstRules;
  let restored = false;
  const first = persist({
    domain: 'parameters', snapshot: { rules: firstRules }, defaults: { rules: [] },
    isCurrent: () => currentRules === firstRules,
    restore: () => { restored = true; }
  });
  const second = persist({
    domain: 'parameters', snapshot: { rules: secondRules }, defaults: { rules: [] },
    isCurrent: () => currentRules === secondRules,
    restore: () => { restored = true; }
  });
  currentRules = secondRules;

  await flushMicrotasks();
  assert.deepEqual(writes.map(({ snapshot }) => snapshot), [{ rules: firstRules }]);
  writes[0].reject(new Error('Storage unavailable'));
  await assert.rejects(first, /Storage unavailable/);
  await flushMicrotasks();
  assert.equal(reads, 0);
  assert.equal(restored, false);
  assert.deepEqual(writes[1].snapshot, { rules: secondRules });
  writes[1].resolve();
  await second;
});

test('does not restore stale state when it changes during the storage reload', async () => {
  let finishRead;
  const storage = {
    set: async () => { throw new Error('Storage unavailable'); },
    get: () => new Promise((resolve) => { finishRead = resolve; })
  };
  const persist = createStoragePersistence(storage);
  let isCurrent = true;
  let restored = false;
  const write = persist({
    domain: 'parameters',
    snapshot: { rules: ['pending'] },
    defaults: { rules: [] },
    isCurrent: () => isCurrent,
    restore: () => { restored = true; }
  });

  await flushMicrotasks();
  assert.equal(typeof finishRead, 'function');
  isCurrent = false;
  finishRead({ rules: ['saved'] });
  await assert.rejects(write, /Storage unavailable/);
  assert.equal(restored, false);
});