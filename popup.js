const TOKEN_STORAGE_KEY = 'transformerAuthToken';
const TOKEN_LIBRARY_STORAGE_KEY = 'transformerTokenLibrary';

const EYE_ICON_SVG = '<svg class="eye-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M1.5 8C3 5 5.3 3.5 8 3.5S13 5 14.5 8C13 11 10.7 12.5 8 12.5S3 11 1.5 8Zm6.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>';
const EYE_OFF_ICON_SVG = '<svg class="eye-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M1.5 8C3 5 5.3 3.5 8 3.5S13 5 14.5 8C13 11 10.7 12.5 8 12.5S3 11 1.5 8Zm6.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/><rect fill="currentColor" x="7.3" y="1.5" width="1.4" height="13" rx="0.7" transform="rotate(40 8 8)"/></svg>';

let transformerResult = null;
let tokenLibrary = [];

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initialize().catch((error) => {
    console.error(error);
    showStatus('Could not load transformer state.', 'error');
  });
});

function bindEvents() {
  document.getElementById('transformUrlBtn').addEventListener('click', transformUrl);
  document.getElementById('copyUrlBtn').addEventListener('click', copyTransformedUrl);
  document.getElementById('openUrlBtn').addEventListener('click', openTransformedUrl);
  document.getElementById('saveTokenBtn').addEventListener('click', saveCurrentToken);
  document.getElementById('toggleTokenVisibility').addEventListener('click', toggleTokenVisibility);

  document.getElementById('sourceUrl').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') transformUrl();
  });

  document.getElementById('authToken').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveCurrentToken();
  });

  document.getElementById('authToken').addEventListener('input', (event) => {
    const tokenValue = event.target.value;
    renderTokenLibrary(tokenLibrary, tokenValue);
    storageLocalSet({ [TOKEN_STORAGE_KEY]: tokenValue }).catch((error) => {
      console.error(error);
      showStatus('Could not save auth token.', 'error');
    });
  });
}

async function initialize() {
  const { [TOKEN_STORAGE_KEY]: authToken = '' } = await storageLocalGet({ [TOKEN_STORAGE_KEY]: '' });
  const { [TOKEN_LIBRARY_STORAGE_KEY]: libraryData = [] } = await storageLocalGet({ [TOKEN_LIBRARY_STORAGE_KEY]: [] });

  tokenLibrary = normalizeTokenLibrary(libraryData);
  document.getElementById('authToken').value = authToken;
  renderTokenLibrary(tokenLibrary, authToken);
  await fillCurrentUrl(false);
}

function normalizeTokenLibrary(records) {
  const seenTokens = new Set();

  return (Array.isArray(records) ? records : [])
    .map(normalizeTokenRecord)
    .filter((record) => {
      if (!record || seenTokens.has(record.token)) return false;
      seenTokens.add(record.token);
      return true;
    });
}

function normalizeTokenRecord(record) {
  const token = String(record?.token || '').trim();
  if (!token) return null;

  return {
    id: String(record?.id || createTokenId()),
    token,
    createdAt: Number(record?.createdAt) || Date.now()
  };
}

function createTokenRecord(token) {
  return { id: createTokenId(), token: String(token || '').trim(), createdAt: Date.now() };
}

function createTokenId() {
  return globalThis.crypto?.randomUUID?.() || `token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fillCurrentUrl(overwriteExisting = true) {
  const sourceInput = document.getElementById('sourceUrl');
  if (!overwriteExisting && sourceInput.value.trim()) return;

  try {
    const tab = await getCurrentTab();
    if (!tab?.url || !isHttpUrl(tab.url)) return;
    sourceInput.value = tab.url;
  } catch (error) {
    console.error('Could not load active tab URL.', error);
  }
}

function transformUrl() {
  const sourceValue = document.getElementById('sourceUrl').value.trim();
  const authToken = document.getElementById('authToken').value.trim();

  if (!sourceValue || !authToken) {
    showStatus('Source URL and auth token are required.', 'error');
    return;
  }

  try {
    const parsed = parseUserUrl(sourceValue);
    const redirectPath = `${parsed.url.pathname || '/'}${parsed.url.search}${parsed.url.hash}` || '/';
    const browserUrl = `${parsed.url.origin}/?auth_token=${encodeURIComponent(authToken)}&redirect=${encodeRedirectPath(redirectPath)}`;
    const displayUrl = parsed.hadProtocol ? browserUrl : browserUrl.replace(/^https?:\/\//i, '');

    transformerResult = { browserUrl, displayUrl };
    setTransformerOutput(displayUrl);
    toggleTransformerResult(true);
    toggleTransformerActions(true);
    showStatus('URL transformed.', 'success');
  } catch (error) {
    transformerResult = null;
    setTransformerOutput('');
    toggleTransformerResult(false);
    toggleTransformerActions(false);
    showStatus('Enter a valid URL or hostname/path combination.', 'error');
  }
}

async function copyTransformedUrl() {
  if (!transformerResult) return;

  try {
    await copyToClipboard(transformerResult.browserUrl);
    showStatus('Transformed URL copied.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('Clipboard access failed.', 'error');
  }
}

async function openTransformedUrl() {
  if (!transformerResult) return;

  try {
    if (!await isAllowedIncognitoAccess()) {
      showStatus('Enable Allow in Incognito for this extension to open URLs there.', 'error');
      return;
    }

    const existingIncognitoWindow = await getExistingIncognitoWindow();
    if (existingIncognitoWindow?.id) {
      await createTab({ windowId: existingIncognitoWindow.id, url: transformerResult.browserUrl, active: true });
    } else {
      await createWindow({ url: transformerResult.browserUrl, incognito: true, focused: true });
    }

    showStatus('Opened transformed URL in incognito.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('Could not open the transformed URL in incognito.', 'error');
  }
}

function renderTokenLibrary(tokens, activeToken) {
  const container = document.getElementById('tokenListContainer');
  const count = document.getElementById('tokenLibraryCount');
  const normalizedActiveToken = String(activeToken || '').trim();
  const tokenById = new Map(tokens.map((entry) => [entry.id, entry.token]));

  count.textContent = `${tokens.length} saved`;
  if (!tokens.length) {
    container.innerHTML = '<div class="token-empty">No saved tokens yet. Save one to reuse it quickly.</div>';
    return;
  }

  container.innerHTML = tokens.map((entry, index) => {
    const decoded = decodeJwtToken(entry.token);
    const isActive = entry.token === normalizedActiveToken;

    return `
      <div class="token-item${isActive ? ' is-active' : ''}">
        <label class="token-choice">
          <input class="token-radio select-token-radio" type="radio" name="selectedToken" data-id="${escapeHtml(entry.id)}"${isActive ? ' checked' : ''}>
          <span class="token-radio-mark" aria-hidden="true"></span>
          <span class="token-choice-copy">
            <span class="token-choice-title">${escapeHtml(getTokenDisplayTitle(entry.token, decoded?.payload, index))}</span>
            <span class="token-pill-row">${buildTokenStatePill(decoded?.payload)}${buildTokenDatePills(decoded?.payload)}</span>
          </span>
        </label>
        <div class="token-actions">
          <button class="small-btn token-copy-btn copy-token-btn" type="button" data-token-id="${escapeHtml(entry.id)}" aria-label="Copy token" title="Copy token"><svg class="token-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.5 2A1.5 1.5 0 0 0 4 3.5v7A1.5 1.5 0 0 0 5.5 12h5A1.5 1.5 0 0 0 12 10.5v-7A1.5 1.5 0 0 0 10.5 2h-5ZM3 3.5A2.5 2.5 0 0 1 5.5 1h5A2.5 2.5 0 0 1 13 3.5v7a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 3 10.5v-7Z"/><path fill="currentColor" d="M1 5.5A2.5 2.5 0 0 1 3.5 3H4v1h-.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h5A1.5 1.5 0 0 0 10 12.5V12h1v.5A2.5 2.5 0 0 1 8.5 15h-5A2.5 2.5 0 0 0 1 12.5v-7Z"/></svg></button>
          <button class="small-btn token-delete-btn delete-token-btn" type="button" data-id="${escapeHtml(entry.id)}" aria-label="Delete saved token" title="Delete saved token"><svg class="token-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.25 2.5h3.5l.5 1H13a.75.75 0 0 1 0 1.5h-.6l-.55 7.14A1.5 1.5 0 0 1 10.35 13.5h-4.7a1.5 1.5 0 0 1-1.5-1.36L3.6 5H3a.75.75 0 0 1 0-1.5h2.75l.5-1Zm-.46 2.5.5 6.5h3.42l.5-6.5H5.79Z"/></svg></button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.copy-token-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const tokenValue = tokenById.get(event.currentTarget.dataset.tokenId);
      if (!tokenValue) return;

      try {
        await copyToClipboard(tokenValue);
        event.currentTarget.classList.add('is-copied');
        globalThis.setTimeout(() => event.currentTarget.classList.remove('is-copied'), 1800);
        showStatus('Token copied to clipboard.', 'success');
      } catch (error) {
        console.error(error);
        showStatus('Clipboard access failed.', 'error');
      }
    });
  });

  container.querySelectorAll('.select-token-radio').forEach((input) => {
    input.addEventListener('change', (event) => selectStoredToken(event.currentTarget.dataset.id));
  });

  container.querySelectorAll('.delete-token-btn').forEach((button) => {
    button.addEventListener('click', (event) => deleteStoredToken(event.currentTarget.dataset.id));
  });
}

async function saveCurrentToken() {
  const tokenInput = document.getElementById('authToken');
  const tokenValue = String(tokenInput.value || '').trim();
  if (!tokenValue) {
    showStatus('Enter a token before saving it.', 'error');
    return;
  }

  const existingRecord = tokenLibrary.find((entry) => entry.token === tokenValue);
  if (existingRecord) {
    await selectStoredToken(existingRecord.id, 'Token already saved. Selected it.');
    return;
  }

  tokenLibrary = [createTokenRecord(tokenValue), ...tokenLibrary];
  renderTokenLibrary(tokenLibrary, tokenValue);

  try {
    await storageLocalSet({ [TOKEN_STORAGE_KEY]: tokenValue, [TOKEN_LIBRARY_STORAGE_KEY]: tokenLibrary });
    showStatus('Token saved and selected.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('Could not save the token library.', 'error');
  }
}

async function selectStoredToken(tokenId, successMessage = 'Saved token selected.') {
  const selectedRecord = tokenLibrary.find((entry) => entry.id === tokenId);
  if (!selectedRecord) return;

  document.getElementById('authToken').value = selectedRecord.token;
  renderTokenLibrary(tokenLibrary, selectedRecord.token);

  try {
    await storageLocalSet({ [TOKEN_STORAGE_KEY]: selectedRecord.token });
    showStatus(successMessage, 'success');
  } catch (error) {
    console.error(error);
    showStatus('Could not select the saved token.', 'error');
  }
}

async function deleteStoredToken(tokenId) {
  const recordToDelete = tokenLibrary.find((entry) => entry.id === tokenId);
  if (!recordToDelete) return;

  tokenLibrary = tokenLibrary.filter((entry) => entry.id !== tokenId);
  const tokenInput = document.getElementById('authToken');
  const currentToken = String(tokenInput.value || '').trim();
  const nextToken = recordToDelete.token === currentToken ? (tokenLibrary[0]?.token || '') : currentToken;

  tokenInput.value = nextToken;
  renderTokenLibrary(tokenLibrary, nextToken);

  try {
    await storageLocalSet({ [TOKEN_STORAGE_KEY]: nextToken, [TOKEN_LIBRARY_STORAGE_KEY]: tokenLibrary });
    showStatus('Saved token removed.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('Could not remove the saved token.', 'error');
  }
}

function buildTokenDatePills(payload) {
  if (!payload) return '';

  const issuedLabel = formatJwtTimeShort(payload.iat) || 'Unknown';
  const expiryLabel = formatJwtTimeShort(payload.exp) || 'None';
  return `<span class="token-date-pill"><strong>Issued</strong>${escapeHtml(issuedLabel)}</span><span class="token-date-pill${isJwtExpired(payload) ? ' expired' : ''}"><strong>Expires</strong>${escapeHtml(expiryLabel)}</span>`;
}

function buildTokenStatePill(payload) {
  if (!payload) return '<span class="token-meta-pill invalid">Not a JWT</span>';
  if (isJwtExpired(payload)) return '<span class="token-meta-pill invalid">Expired JWT</span>';

  const warning = getJwtExpiryWarning(payload);
  return warning ? `<span class="token-meta-pill warning">${escapeHtml(warning)}</span>` : '';
}

function getJwtExpiryWarning(payload) {
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp)) return null;

  const deltaMs = exp * 1000 - Date.now();
  const hourMs = 60 * 60 * 1000;
  if (deltaMs <= 0 || deltaMs > 24 * hourMs) return null;
  return deltaMs < hourMs ? `Expires in ${Math.max(1, Math.floor(deltaMs / 60000))}m` : `Expires in ${Math.floor(deltaMs / hourMs)}h`;
}

function decodeJwtToken(tokenValue) {
  const parts = String(tokenValue || '').split('.');
  if (parts.length < 2) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return header && typeof header === 'object' && payload && typeof payload === 'object' ? { header, payload } : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) || 0);
  return typeof TextDecoder === 'function' ? new TextDecoder().decode(bytes) : binary;
}

function getTokenDisplayTitle(tokenValue, payload, index) {
  const email = [payload?.email, payload?.upn, payload?.preferred_username, payload?.unique_name]
    .find((value) => typeof value === 'string' && value.trim());
  if (email) return email;

  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  return name || `Token ${index + 1} \u2022 ${getTokenFingerprint(tokenValue)}`;
}

function getTokenFingerprint(tokenValue) {
  const normalized = String(tokenValue || '').trim();
  return !normalized ? 'empty' : (normalized.length <= 8 ? normalized : `...${normalized.slice(-8)}`);
}

function formatJwtTimeShort(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '';

  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function isJwtExpired(payload) {
  const exp = Number(payload?.exp);
  return Number.isFinite(exp) && exp * 1000 <= Date.now();
}

function setTransformerOutput(value) {
  document.getElementById('transformedUrl').value = value;
}

function toggleTransformerActions(enabled) {
  document.getElementById('copyUrlBtn').disabled = !enabled;
  document.getElementById('openUrlBtn').disabled = !enabled;
}

function toggleTransformerResult(visible) {
  document.getElementById('transformerResult').classList.toggle('visible', visible);
}

function toggleTokenVisibility() {
  const input = document.getElementById('authToken');
  const button = document.getElementById('toggleTokenVisibility');
  const willReveal = input.type === 'password';

  input.type = willReveal ? 'text' : 'password';
  button.setAttribute('aria-label', willReveal ? 'Hide token' : 'Show token');
  button.setAttribute('title', willReveal ? 'Hide token' : 'Show token');
  button.innerHTML = willReveal ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
}

function parseUserUrl(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Missing URL');

  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  if (hasExplicitScheme && !isHttpUrl(input)) throw new Error('Unsupported URL scheme');

  const hadProtocol = /^https?:\/\//i.test(input);
  const candidate = hadProtocol ? input : `https://${input.replace(/^\/+/, '')}`;
  if (!URL.canParse(candidate)) throw new Error('Unsupported URL');

  const url = new URL(candidate);
  if (!url.hostname || !isHttpUrl(url.href)) throw new Error('Unsupported URL');
  return { url, hadProtocol };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function encodeRedirectPath(value) {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

function showStatus(message, type) {
  const element = document.getElementById('transformerStatus');
  element.textContent = message;
  element.className = `status-msg visible ${type}`;
  globalThis.clearTimeout(element._statusTimer);
  element._statusTimer = globalThis.setTimeout(() => { element.className = 'status-msg'; }, 2800);
}

async function copyToClipboard(text) {
  const value = String(text);
  const selection = globalThis.getSelection?.();
  const activeElement = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange?.(0, value.length);

    if (document.execCommand('copy')) {
      return;
    }
  } catch (error) {
    console.warn('document.execCommand("copy") failed. Falling back to Clipboard API.', error);
  } finally {
    textarea.remove();
    selection?.removeAllRanges();
    activeElement?.focus?.({ preventScroll: true });
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      console.error('navigator.clipboard.writeText failed.', error);
    }
  }

  throw new Error('No clipboard method succeeded.');
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function storageLocalGet(query) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(query, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function storageLocalSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function getCurrentTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs?.[0] || null);
    });
  });
}

function isAllowedIncognitoAccess() {
  return new Promise((resolve, reject) => {
    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Boolean(isAllowed));
    });
  });
}

function getExistingIncognitoWindow() {
  return new Promise((resolve, reject) => {
    chrome.windows.getAll({ populate: false, windowTypes: ['normal'] }, (windows) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve((windows || []).find((windowInfo) => windowInfo?.incognito) || null);
    });
  });
}

function createTab(details) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(details, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab || null);
    });
  });
}

function createWindow(details) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(details, (windowInfo) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(windowInfo || null);
    });
  });
}
