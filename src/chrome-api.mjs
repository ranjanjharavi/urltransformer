export function createChromeApi(chromeApi) {
  const invoke = (registerCallback) => new Promise((resolve, reject) => {
    registerCallback((result) => {
      const error = chromeApi.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });

  return {
    storage: {
      get: (defaults) => invoke((done) => chromeApi.storage.local.get(defaults, (result) => done(result || {}))),
      set: (value) => invoke((done) => chromeApi.storage.local.set(value, () => done()))
    },

    getCurrentTab: async () => {
      const tabs = await invoke((done) => chromeApi.tabs.query({ active: true, currentWindow: true }, done));
      return tabs?.[0] || null;
    },

    openInIncognito: async (url) => {
      const isAllowed = await invoke((done) => chromeApi.extension.isAllowedIncognitoAccess(done));
      if (!isAllowed) {
        throw new Error('Enable Allow in Incognito for this extension to open URLs there.');
      }

      const windows = await invoke((done) => chromeApi.windows.getAll({
        populate: false,
        windowTypes: ['normal']
      }, done));
      const incognitoWindow = (windows || []).find((windowInfo) => windowInfo?.incognito);

      if (incognitoWindow?.id) {
        await invoke((done) => chromeApi.tabs.create({
          windowId: incognitoWindow.id,
          url,
          active: true
        }, done));
        return;
      }

      await invoke((done) => chromeApi.windows.create({
        url,
        incognito: true,
        focused: true
      }, done));
    }
  };
}

export async function copyText(text) {
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
    if (document.execCommand('copy')) return;
  } catch (error) {
    console.warn('Legacy clipboard copy failed. Falling back to Clipboard API.', error);
  } finally {
    textarea.remove();
    selection?.removeAllRanges();
    activeElement?.focus?.({ preventScroll: true });
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  throw new Error('Clipboard access is unavailable.');
}
