import { createTokenRecord, describeToken, normalizeTokenLibrary } from './token-utils.mjs';
import { copyText } from './chrome-api.mjs';
import { icons } from './icons.mjs';

export function createTokenWorkspace({ ui, state, persistWorkspace, storageKeys, invalidateResult, showStatus, handlePersistenceError, escapeHtml, onEnter }) {
  function bindEvents() {
    ui.manageSaveTokenBtn.addEventListener('click', save);
    ui.toggleManagedTokenVisibility.addEventListener('click', toggleVisibility);
    onEnter(ui.manageAuthToken, save);
    ui.tokenListContainer.addEventListener('click', handleListClick);
    ui.tokenListContainer.addEventListener('change', handleSelection);
  }

  function renderSelected() {
    const activeRecord = state.tokenLibrary.find((entry) => entry.token === state.currentToken);

    if (!state.currentToken) {
      ui.selectedTokenTitle.textContent = 'No token selected';
      ui.selectedTokenMeta.textContent = 'Select a token for token-based parameters.';
      return;
    }

    const index = activeRecord ? state.tokenLibrary.indexOf(activeRecord) : 0;
    const token = describeToken(state.currentToken, index);
    ui.selectedTokenTitle.textContent = token.title;

    if (!token.isJwt) {
      ui.selectedTokenMeta.textContent = activeRecord ? 'Saved token · Not a JWT' : 'Current token · Not saved';
      return;
    }

    let expiry = 'No expiration';
    if (token.expired) expiry = 'Expired';
    else if (token.expiryLabel !== 'None') expiry = `Expires ${token.expiryLabel}`;
    ui.selectedTokenMeta.textContent = activeRecord ? expiry : `${expiry} · Not saved`;
  }

  function renderLibrary() {
    ui.tokenLibraryCount.textContent = `${state.tokenLibrary.length} saved`;
    if (!state.tokenLibrary.length) {
      ui.tokenListContainer.innerHTML = '<div class="empty-state">No saved tokens yet. Add one above to select it for protected pages.</div>';
      return;
    }

    ui.tokenListContainer.innerHTML = state.tokenLibrary.map((entry, index) => {
      const token = describeToken(entry.token, index);
      const isActive = entry.token === state.currentToken;

      return `
        <div class="token-item${isActive ? ' is-active' : ''}">
          <label class="token-choice">
            <input class="token-radio" type="radio" name="selectedToken" data-select-token="${escapeHtml(entry.id)}"${isActive ? ' checked' : ''}>
            <span class="token-radio-mark" aria-hidden="true"></span>
            <span class="token-choice-copy">
              <span class="token-choice-title">${escapeHtml(token.title)}</span>
              <span class="token-pill-row">${renderTokenStatePill(token)}${renderTokenDatePills(token)}</span>
            </span>
          </label>
          <div class="token-actions">
            <button class="icon-btn token-copy-btn" type="button" data-copy-token="${escapeHtml(entry.id)}" aria-label="Copy token" title="Copy token">${icons.copy}</button>
            <button class="icon-btn danger-icon-btn" type="button" data-delete-token="${escapeHtml(entry.id)}" aria-label="Delete saved token" title="Delete saved token">${icons.delete}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderTokenDatePills(token) {
    return `<span class="token-date-pill"><strong>Issued</strong>${escapeHtml(token.issuedLabel)}</span><span class="token-date-pill${token.expired ? ' expired' : ''}"><strong>Expires</strong>${escapeHtml(token.expiryLabel)}</span>`;
  }

  function renderTokenStatePill(token) {
    if (!token.isJwt) return '<span class="token-meta-pill invalid">Not a JWT</span>';
    if (token.expired) return '<span class="token-meta-pill invalid">Expired JWT</span>';
    return token.expiryWarning
      ? `<span class="token-meta-pill warning">${escapeHtml(token.expiryWarning)}</span>`
      : '';
  }

  async function handleListClick(event) {
    const copyButton = event.target.closest('[data-copy-token]');
    if (copyButton) {
      await copySavedToken(copyButton);
      return;
    }

    const deleteButton = event.target.closest('[data-delete-token]');
    if (deleteButton) await deleteSavedToken(deleteButton.dataset.deleteToken);
  }

  function handleSelection(event) {
    const input = event.target.closest('[data-select-token]');
    if (input) void selectSavedToken(input.dataset.selectToken);
  }

  function toggleVisibility() {
    const shouldReveal = ui.manageAuthToken.type === 'password';
    ui.manageAuthToken.type = shouldReveal ? 'text' : 'password';
    ui.toggleManagedTokenVisibility.innerHTML = shouldReveal ? icons.eyeOff : icons.eye;
    ui.toggleManagedTokenVisibility.setAttribute('aria-label', shouldReveal ? 'Hide token' : 'Show token');
    ui.toggleManagedTokenVisibility.title = shouldReveal ? 'Hide token' : 'Show token';
  }

  function resetVisibility() {
    ui.manageAuthToken.type = 'password';
    ui.toggleManagedTokenVisibility.innerHTML = icons.eye;
    ui.toggleManagedTokenVisibility.setAttribute('aria-label', 'Show token');
    ui.toggleManagedTokenVisibility.title = 'Show token';
  }

  async function save() {
    const tokenValue = String(ui.manageAuthToken.value || '').trim();
    if (!tokenValue) {
      showStatus('Paste a token before saving it.', 'error');
      ui.manageAuthToken.focus();
      return;
    }

    const existingRecord = state.tokenLibrary.find((entry) => entry.token === tokenValue);
    if (existingRecord) {
      ui.manageAuthToken.value = '';
      resetVisibility();
      await selectSavedToken(existingRecord.id, 'Token already saved and selected.');
      return;
    }

    state.tokenLibrary = [createTokenRecord(tokenValue), ...state.tokenLibrary];
    state.currentToken = tokenValue;
    resetVisibility();
    invalidateResult();
    renderSelected();
    renderLibrary();

    try {
      await persist();
      if (ui.manageAuthToken.value.trim() === tokenValue) ui.manageAuthToken.value = '';
      showStatus('Token saved and selected.', 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not save the token library.');
    }
  }

  async function selectSavedToken(tokenId, successMessage = 'Token selected.') {
    const selectedRecord = state.tokenLibrary.find((entry) => entry.id === tokenId);
    if (!selectedRecord) return;

    state.currentToken = selectedRecord.token;
    invalidateResult();
    renderSelected();
    renderLibrary();

    try {
      await persist();
      showStatus(successMessage, 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not select the saved token.');
    }
  }

  async function deleteSavedToken(tokenId) {
    const record = state.tokenLibrary.find((entry) => entry.id === tokenId);
    if (!record || !globalThis.confirm('Delete this saved token?')) return;

    state.tokenLibrary = state.tokenLibrary.filter((entry) => entry.id !== tokenId);
    if (record.token === state.currentToken) state.currentToken = state.tokenLibrary[0]?.token || '';

    invalidateResult();
    renderSelected();
    renderLibrary();

    try {
      await persist();
      showStatus('Saved token removed.', 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not remove the saved token.');
    }
  }

  async function copySavedToken(button) {
    const record = state.tokenLibrary.find((entry) => entry.id === button.dataset.copyToken);
    if (!record) return;

    try {
      await copyText(record.token);
      button.classList.add('is-copied');
      globalThis.setTimeout(() => button.classList.remove('is-copied'), 1800);
      showStatus('Token copied.', 'success');
    } catch (error) {
      console.error(error);
      showStatus('Clipboard access failed.', 'error');
    }
  }

  function persist() {
    const token = state.currentToken;
    const library = state.tokenLibrary;
    return persistWorkspace({
      domain: 'tokens',
      snapshot: {
        [storageKeys.currentToken]: token,
        [storageKeys.tokenLibrary]: library
      },
      defaults: { [storageKeys.currentToken]: '', [storageKeys.tokenLibrary]: [] },
      isCurrent: () => state.currentToken === token && state.tokenLibrary === library,
      restore: (stored) => {
        state.currentToken = String(stored[storageKeys.currentToken] || '').trim();
        state.tokenLibrary = normalizeTokenLibrary(stored[storageKeys.tokenLibrary]);
        invalidateResult();
        renderSelected();
        renderLibrary();
      }
    });
  }

  return { bindEvents, renderSelected, renderLibrary, resetVisibility };
}