import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenWorkspace } from '../src/token-workspace.mjs';

for (const currentToken of ['first', 'second']) {
  test(`deletes a saved token directly when selected token is ${currentToken}`, async () => {
    const listeners = {};
    const control = () => ({ addEventListener() {} });
    const ui = {
      manageSaveTokenBtn: control(),
      toggleManagedTokenVisibility: control(),
      manageAuthToken: control(),
      tokenListContainer: {
        addEventListener(type, listener) { listeners[type] = listener; }
      },
      tokenLibraryCount: {},
      selectedTokenTitle: {},
      selectedTokenMeta: {}
    };
    const state = {
      currentToken,
      tokenLibrary: [{ id: 'a', token: 'first' }, { id: 'b', token: 'second' }]
    };
    const snapshots = [];
    const statuses = [];
    const workspace = createTokenWorkspace({
      ui, state,
      persistWorkspace: async ({ snapshot }) => snapshots.push(snapshot),
      storageKeys: { currentToken: 'currentToken', tokenLibrary: 'tokenLibrary' },
      invalidateResult() {},
      showStatus: (...args) => statuses.push(args),
      handlePersistenceError(error) { throw error; },
      escapeHtml: (value) => String(value),
      onEnter() {}
    });
    workspace.bindEvents();
    await listeners.click({
      target: {
        closest: (selector) => selector === '[data-delete-token]'
          ? { dataset: { deleteToken: 'a' } } : null
      }
    });
    assert.deepEqual(state.tokenLibrary, [{ id: 'b', token: 'second' }]);
    assert.equal(state.currentToken, 'second');
    assert.equal(snapshots.length, 1);
    assert.deepEqual(statuses, [['Saved token removed.', 'success']]);
  });
}
