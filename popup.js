import {
  buildTransformedUrl,
  isHttpUrl,
  normalizeStoredParameterRules
} from './src/parameter-rules.mjs';
import { createParameterWorkspace } from './src/parameter-workspace.mjs';
import { normalizeTokenLibrary } from './src/token-utils.mjs';
import { createTokenWorkspace } from './src/token-workspace.mjs';
import { normalizeRecentUrls } from './src/recent-urls.mjs';
import { createRecentWorkspace } from './src/recent-workspace.mjs';
import { copyText, createChromeApi, createStoragePersistence } from './src/chrome-api.mjs';

const STORAGE_KEYS = {
  currentToken: 'transformerAuthToken',
  tokenLibrary: 'transformerTokenLibrary',
  parameterRules: 'transformerParameterRules',
  recentUrls: 'transformerRecentUrls'
};

const WORKSPACES = {
  transform: ['transformWorkspaceTab', 'transformWorkspace'],
  parameters: ['parametersWorkspaceTab', 'parametersWorkspace'],
  tokens: ['tokensWorkspaceTab', 'tokensWorkspace'],
  recent: ['recentWorkspaceTab', 'recentWorkspace']
};

const UI_IDS = [
  'transformUrlBtn', 'copyUrlBtn', 'openUrlBtn', 'manageSaveTokenBtn', 'manageTokensBtn',
  'editParametersBtn', 'addParameterBtn', 'closeParameterEditorBtn', 'cancelParameterBtn',
  'saveParameterBtn', 'parameterListContainer', 'sourceUrl', 'parameterName', 'parameterValue',
  'manageAuthToken', 'toggleManagedTokenVisibility', 'parameterSummary', 'parameterEditor', 'parameterEditorTitle',
  'customValueField', 'derivedValue', 'derivedValueText', 'selectedTokenTitle',
  'selectedTokenMeta', 'tokenListContainer', 'tokenLibraryCount', 'transformedUrl',
  'transformerResult', 'transformerStatus', 'recentListContainer', 'clearRecentBtn', 'recentSecurityNote'
];

const ui = Object.fromEntries(UI_IDS.map((id) => [id, document.getElementById(id)]));
const extensionApi = createChromeApi(chrome);
const persistWorkspace = createStoragePersistence(extensionApi.storage);
const state = {
  result: null,
  currentToken: '',
  tokenLibrary: [],
  parameterRules: [],
  recentUrls: []
};
const recentWorkspace = createRecentWorkspace({
  ui, state, extensionApi, persistWorkspace,
  storageKey: STORAGE_KEYS.recentUrls,
  showStatus, handlePersistenceError, escapeHtml
});
const tokenWorkspace = createTokenWorkspace({
  ui, state, persistWorkspace,
  storageKeys: STORAGE_KEYS,
  invalidateResult, showStatus, handlePersistenceError, escapeHtml, onEnter
});
const parameterWorkspace = createParameterWorkspace({
  ui, state, persistWorkspace,
  storageKey: STORAGE_KEYS.parameterRules,
  invalidateResult, showStatus, handlePersistenceError, escapeHtml, onEnter
});

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
  ui.manageTokensBtn.addEventListener('click', () => setWorkspace('tokens'));
  ui.editParametersBtn.addEventListener('click', () => setWorkspace('parameters'));

  Object.entries(WORKSPACES).forEach(([workspace, [tabId]]) => {
    document.getElementById(tabId).addEventListener('click', () => setWorkspace(workspace));
  });

  ui.sourceUrl.addEventListener('input', invalidateResult);
  onEnter(ui.sourceUrl, transformUrl);

  parameterWorkspace.bindEvents();
  tokenWorkspace.bindEvents();
  recentWorkspace.bindEvents();
}

async function loadState() {
  const stored = await extensionApi.storage.get({
    [STORAGE_KEYS.currentToken]: '',
    [STORAGE_KEYS.tokenLibrary]: [],
    [STORAGE_KEYS.parameterRules]: [],
    [STORAGE_KEYS.recentUrls]: []
  });

  state.currentToken = String(stored[STORAGE_KEYS.currentToken] || '').trim();
  state.tokenLibrary = normalizeTokenLibrary(stored[STORAGE_KEYS.tokenLibrary]);
  state.parameterRules = normalizeStoredParameterRules(stored[STORAGE_KEYS.parameterRules]);
  state.recentUrls = normalizeRecentUrls(stored[STORAGE_KEYS.recentUrls]);
}

function renderAll() {
  tokenWorkspace.renderSelected();
  tokenWorkspace.renderLibrary();
  parameterWorkspace.render();
  recentWorkspace.render();
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
  if (workspace !== 'tokens') tokenWorkspace.resetVisibility();
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
    recentWorkspace.addResult({
      browserUrl: state.result.browserUrl,
      sourceValue: ui.sourceUrl.value
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
