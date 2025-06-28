import {
  buildTransformedUrl,
  getRuleSourceDefinition,
  isHttpUrl,
  normalizeStoredParameterRules,
  removeParameterRule,
  upsertParameterRule
} from './src/parameter-rules.mjs';
import {
  createTokenRecord,
  describeToken,
  normalizeTokenLibrary
} from './src/token-utils.mjs';
import { copyText, createChromeApi } from './src/chrome-api.mjs';
import { icons, sourceIcons } from './src/icons.mjs';

const STORAGE_KEYS = {
  currentToken: 'transformerAuthToken',
  tokenLibrary: 'transformerTokenLibrary',
  parameterRules: 'transformerParameterRules'
};

const WORKSPACES = {
  transform: ['transformWorkspaceTab', 'transformWorkspace'],
  parameters: ['parametersWorkspaceTab', 'parametersWorkspace'],
  tokens: ['tokensWorkspaceTab', 'tokensWorkspace']
};

const UI_IDS = [
  'transformUrlBtn', 'copyUrlBtn', 'openUrlBtn', 'manageSaveTokenBtn', 'manageTokensBtn',
  'editParametersBtn', 'addParameterBtn', 'closeParameterEditorBtn', 'cancelParameterBtn',
  'saveParameterBtn', 'parameterListContainer', 'sourceUrl', 'parameterName', 'parameterValue',
  'manageAuthToken', 'toggleManagedTokenVisibility', 'parameterSummary', 'parameterEditor', 'parameterEditorTitle',
  'customValueField', 'derivedValue', 'derivedValueText', 'selectedTokenTitle',
  'selectedTokenMeta', 'tokenListContainer', 'tokenLibraryCount', 'transformedUrl',
  'transformerResult', 'transformerStatus'
];

const ui = Object.fromEntries(UI_IDS.map((id) => [id, document.getElementById(id)]));
const extensionApi = createChromeApi(chrome);
const state = {
  result: null,
  currentToken: '',
  tokenLibrary: [],
  parameterRules: [],
  editingParameterId: null
};

start().catch((error) => {
  console.error(error);
  showStatus('Could not load transformer state.', 'error');
});

async function start() {
  bindEvents();
  await loadState();
  renderAll();
  await fillCurrentUrl();
}

function bindEvents() {
  ui.transformUrlBtn.addEventListener('click', transformUrl);
  ui.copyUrlBtn.addEventListener('click', copyTransformedUrl);
  ui.openUrlBtn.addEventListener('click', openTransformedUrl);
  ui.manageSaveTokenBtn.addEventListener('click', saveToken);
  ui.toggleManagedTokenVisibility.addEventListener('click', toggleTokenVisibility);
  ui.manageTokensBtn.addEventListener('click', () => setWorkspace('tokens'));
  ui.editParametersBtn.addEventListener('click', () => setWorkspace('parameters'));

  Object.entries(WORKSPACES).forEach(([workspace, [tabId]]) => {
    document.getElementById(tabId).addEventListener('click', () => setWorkspace(workspace));
  });

  ui.addParameterBtn.addEventListener('click', () => openParameterEditor());
  ui.closeParameterEditorBtn.addEventListener('click', closeParameterEditor);
  ui.cancelParameterBtn.addEventListener('click', closeParameterEditor);
  ui.saveParameterBtn.addEventListener('click', saveParameter);
  ui.parameterListContainer.addEventListener('click', handleParameterListClick);

  document.querySelectorAll('input[name="parameterSource"]').forEach((input) => {
    input.addEventListener('change', renderParameterEditorSource);
  });

  ui.sourceUrl.addEventListener('input', invalidateResult);
  onEnter(ui.sourceUrl, transformUrl);
  onEnter(ui.parameterName, saveParameter);
  onEnter(ui.parameterValue, saveParameter);
  onEnter(ui.manageAuthToken, saveToken);

  ui.tokenListContainer.addEventListener('click', handleTokenListClick);
  ui.tokenListContainer.addEventListener('change', handleTokenSelection);
}

async function loadState() {
  const stored = await extensionApi.storage.get({
    [STORAGE_KEYS.currentToken]: '',
    [STORAGE_KEYS.tokenLibrary]: [],
    [STORAGE_KEYS.parameterRules]: []
  });

  state.currentToken = String(stored[STORAGE_KEYS.currentToken] || '').trim();
  state.tokenLibrary = normalizeTokenLibrary(stored[STORAGE_KEYS.tokenLibrary]);
  state.parameterRules = normalizeStoredParameterRules(stored[STORAGE_KEYS.parameterRules]);
}

function renderAll() {
  renderSelectedToken();
  renderTokenLibrary();
  renderParameterList();
  renderParameterSummary();
}

function setWorkspace(workspace) {
  Object.entries(WORKSPACES).forEach(([name, [tabId, panelId]]) => {
    const isActive = name === workspace;
    const tab = document.getElementById(tabId);
    document.getElementById(panelId).hidden = !isActive;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  document.getElementById(WORKSPACES[workspace][1]).scrollTop = 0;
  if (workspace !== 'tokens') resetTokenVisibility();
}

function renderParameterList() {
  if (!state.parameterRules.length) {
    ui.parameterListContainer.innerHTML = '<div class="empty-state">No parameters configured. Add one to build the generated URL.</div>';
    return;
  }

  ui.parameterListContainer.innerHTML = state.parameterRules.map((rule) => {
    const source = getRuleSourceDefinition(rule.source);
    const valueLabel = rule.source === 'literal'
      ? (rule.value || 'Empty values are omitted')
      : source.derivedLabel;

    return `
      <div class="parameter-row" data-rule-id="${escapeHtml(rule.id)}">
        <span class="parameter-row-copy">
          <span class="parameter-row-name">${escapeHtml(rule.key)}</span>
          <span class="parameter-row-source">
            ${sourceIcons[rule.source]}
            <span>${escapeHtml(source.label)}</span>
            <span aria-hidden="true">·</span>
            <span class="parameter-row-value">${escapeHtml(valueLabel)}</span>
            ${rule.required ? '<span class="parameter-required">Required</span>' : ''}
          </span>
        </span>
        <span class="parameter-row-actions">
          <button class="icon-btn" type="button" data-edit-rule="${escapeHtml(rule.id)}" aria-label="Edit ${escapeHtml(rule.key)}" title="Edit parameter">${icons.edit}</button>
          ${rule.required ? '' : `<button class="icon-btn danger-icon-btn" type="button" data-delete-rule="${escapeHtml(rule.id)}" aria-label="Delete ${escapeHtml(rule.key)}" title="Delete parameter">${icons.delete}</button>`}
        </span>
      </div>
    `;
  }).join('');
}

function renderParameterSummary() {
  const keys = state.parameterRules.map((rule) => rule.key.trim()).filter(Boolean);
  const visibleKeys = keys.slice(0, 3);
  const remainingCount = keys.length - visibleKeys.length;
  ui.parameterSummary.textContent = `${visibleKeys.join(' · ') || 'No parameters'}${remainingCount > 0 ? ` · +${remainingCount}` : ''}`;
}

function handleParameterListClick(event) {
  const editButton = event.target.closest('[data-edit-rule]');
  if (editButton) {
    openParameterEditor(editButton.dataset.editRule);
    return;
  }

  const deleteButton = event.target.closest('[data-delete-rule]');
  if (deleteButton) deleteParameter(deleteButton.dataset.deleteRule);
}

function openParameterEditor(ruleId = null) {
  const rule = ruleId ? state.parameterRules.find((entry) => entry.id === ruleId) : null;
  if (ruleId && !rule) return;

  state.editingParameterId = rule?.id || null;
  ui.parameterEditorTitle.textContent = rule ? 'Edit parameter' : 'Add parameter';
  ui.parameterName.value = rule?.key || '';
  ui.parameterValue.value = rule?.value || '';

  const source = rule?.source || 'literal';
  document.querySelectorAll('input[name="parameterSource"]').forEach((input) => {
    input.checked = input.value === source;
  });

  ui.parameterListContainer.hidden = true;
  ui.addParameterBtn.hidden = true;
  ui.parameterEditor.hidden = false;
  renderParameterEditorSource();
  ui.parameterName.focus({ preventScroll: true });
}

function closeParameterEditor() {
  state.editingParameterId = null;
  ui.parameterEditor.hidden = true;
  ui.parameterListContainer.hidden = false;
  ui.addParameterBtn.hidden = false;
  ui.parameterName.value = '';
  ui.parameterValue.value = '';
}

function renderParameterEditorSource() {
  const source = getSelectedEditorSource();
  const definition = getRuleSourceDefinition(source);
  const isCustom = source === 'literal';
  ui.customValueField.hidden = !isCustom;
  ui.derivedValue.hidden = isCustom;
  ui.derivedValueText.textContent = isCustom ? '' : definition.description;
}

function getSelectedEditorSource() {
  return document.querySelector('input[name="parameterSource"]:checked')?.value || 'literal';
}

async function saveParameter() {
  const draft = {
    key: ui.parameterName.value,
    source: getSelectedEditorSource(),
    value: ui.parameterValue.value
  };

  try {
    state.parameterRules = upsertParameterRule(
      state.parameterRules,
      draft,
      state.editingParameterId
    );
  } catch (error) {
    showStatus(error.message, 'error');
    ui.parameterName.focus();
    return;
  }

  invalidateResult();
  renderParameterList();
  renderParameterSummary();
  closeParameterEditor();
  try {
    await persistParameterRules();
    showStatus('Parameter saved.', 'success');
  } catch (error) {
    handlePersistenceError(error, 'Could not save parameter changes.');
  }
}

async function deleteParameter(ruleId) {
  const rule = state.parameterRules.find((entry) => entry.id === ruleId);
  if (!rule || rule.required || !globalThis.confirm(`Delete “${rule.key}”?`)) return;

  state.parameterRules = removeParameterRule(state.parameterRules, ruleId);
  if (state.editingParameterId === ruleId) closeParameterEditor();
  invalidateResult();
  renderParameterList();
  renderParameterSummary();
  try {
    await persistParameterRules();
    showStatus('Parameter removed.', 'success');
  } catch (error) {
    handlePersistenceError(error, 'Could not save parameter changes.');
  }
}

function persistParameterRules() {
  return extensionApi.storage.set({
    [STORAGE_KEYS.parameterRules]: state.parameterRules
  });
}

async function fillCurrentUrl(overwriteExisting = false) {
  if (!overwriteExisting && ui.sourceUrl.value.trim()) return;

  try {
    const tab = await extensionApi.getCurrentTab();
    if (tab?.url && isHttpUrl(tab.url)) ui.sourceUrl.value = tab.url;
  } catch (error) {
    console.error('Could not load active tab URL.', error);
  }
}

function transformUrl() {
  try {
    state.result = buildTransformedUrl({
      sourceValue: ui.sourceUrl.value,
      token: state.currentToken,
      rules: state.parameterRules
    });
    renderResult();
    showStatus('URL transformed.', 'success');
  } catch (error) {
    console.error(error);
    invalidateResult();
    showStatus(error?.message || 'Could not transform this URL.', 'error');
  }
}

function renderResult() {
  ui.transformedUrl.value = state.result?.displayUrl || '';
  ui.transformerResult.classList.toggle('visible', Boolean(state.result));
  ui.copyUrlBtn.disabled = !state.result;
  ui.openUrlBtn.disabled = !state.result;
}

function invalidateResult() {
  state.result = null;
  renderResult();
}

async function copyTransformedUrl() {
  if (!state.result) return;

  try {
    await copyText(state.result.browserUrl);
    showStatus('Generated URL copied.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('Clipboard access failed.', 'error');
  }
}

async function openTransformedUrl() {
  if (!state.result) return;

  try {
    await extensionApi.openInIncognito(state.result.browserUrl);
    showStatus('Opened generated URL in Incognito.', 'success');
  } catch (error) {
    console.error(error);
    showStatus(error?.message || 'Could not open the generated URL in Incognito.', 'error');
  }
}

function renderSelectedToken() {
  const activeRecord = state.tokenLibrary.find((entry) => entry.token === state.currentToken);

  if (!state.currentToken) {
    ui.selectedTokenTitle.textContent = 'No token selected';
    ui.selectedTokenMeta.textContent = 'Choose a token before transforming.';
    return;
  }

  const index = activeRecord ? state.tokenLibrary.indexOf(activeRecord) : 0;
  const token = describeToken(state.currentToken, index);
  ui.selectedTokenTitle.textContent = token.title;

  if (!token.isJwt) {
    ui.selectedTokenMeta.textContent = activeRecord ? 'Saved token · Not a JWT' : 'Current token · Not saved';
    return;
  }

  const expiry = token.expired ? 'Expired' : (token.expiryLabel !== 'None' ? `Expires ${token.expiryLabel}` : 'No expiration');
  ui.selectedTokenMeta.textContent = activeRecord ? expiry : `${expiry} · Not saved`;
}

function renderTokenLibrary() {
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

async function handleTokenListClick(event) {
  const copyButton = event.target.closest('[data-copy-token]');
  if (copyButton) {
    await copySavedToken(copyButton);
    return;
  }

  const deleteButton = event.target.closest('[data-delete-token]');
  if (deleteButton) await deleteSavedToken(deleteButton.dataset.deleteToken);
}

function handleTokenSelection(event) {
  const input = event.target.closest('[data-select-token]');
  if (input) selectSavedToken(input.dataset.selectToken);
}

function toggleTokenVisibility() {
  const shouldReveal = ui.manageAuthToken.type === 'password';
  ui.manageAuthToken.type = shouldReveal ? 'text' : 'password';
  ui.toggleManagedTokenVisibility.innerHTML = shouldReveal ? icons.eyeOff : icons.eye;
  ui.toggleManagedTokenVisibility.setAttribute('aria-label', shouldReveal ? 'Hide token' : 'Show token');
  ui.toggleManagedTokenVisibility.title = shouldReveal ? 'Hide token' : 'Show token';
}

function resetTokenVisibility() {
  ui.manageAuthToken.type = 'password';
  ui.toggleManagedTokenVisibility.innerHTML = icons.eye;
  ui.toggleManagedTokenVisibility.setAttribute('aria-label', 'Show token');
  ui.toggleManagedTokenVisibility.title = 'Show token';
}

async function saveToken() {
  const tokenValue = String(ui.manageAuthToken.value || '').trim();
  if (!tokenValue) {
    showStatus('Paste a token before saving it.', 'error');
    ui.manageAuthToken.focus();
    return;
  }

  const existingRecord = state.tokenLibrary.find((entry) => entry.token === tokenValue);
  if (existingRecord) {
    ui.manageAuthToken.value = '';
    resetTokenVisibility();
    await selectSavedToken(existingRecord.id, 'Token already saved and selected.');
    return;
  }

  state.tokenLibrary = [createTokenRecord(tokenValue), ...state.tokenLibrary];
  state.currentToken = tokenValue;
  ui.manageAuthToken.value = '';
  resetTokenVisibility();
  invalidateResult();
  renderSelectedToken();
  renderTokenLibrary();

  try {
    await persistTokenState();
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
  renderSelectedToken();
  renderTokenLibrary();

  try {
    await extensionApi.storage.set({ [STORAGE_KEYS.currentToken]: state.currentToken });
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
  renderSelectedToken();
  renderTokenLibrary();

  try {
    await persistTokenState();
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

function persistTokenState() {
  return extensionApi.storage.set({
    [STORAGE_KEYS.currentToken]: state.currentToken,
    [STORAGE_KEYS.tokenLibrary]: state.tokenLibrary
  });
}

function handlePersistenceError(error, message) {
  console.error(error);
  showStatus(message, 'error');
}

function showStatus(message, type) {
  ui.transformerStatus.textContent = message;
  ui.transformerStatus.className = `status-msg visible ${type}`;
  globalThis.clearTimeout(ui.transformerStatus._statusTimer);
  ui.transformerStatus._statusTimer = globalThis.setTimeout(() => {
    ui.transformerStatus.className = 'status-msg';
  }, 2800);
}

function onEnter(element, action) {
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') action();
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
