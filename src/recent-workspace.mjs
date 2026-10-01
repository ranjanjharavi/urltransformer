import { addRecentUrl, getRecentParameterNames, normalizeRecentUrls } from './recent-urls.mjs';
import { copyText } from './chrome-api.mjs';
import { icons } from './icons.mjs';

export function createRecentWorkspace({ ui, state, extensionApi, persistWorkspace, storageKey, showStatus, handlePersistenceError, escapeHtml }) {
  function bindEvents() {
    ui.recentListContainer.addEventListener('click', handleListClick);
    ui.clearRecentBtn.addEventListener('click', clear);
  }

  function render() {
    ui.clearRecentBtn.hidden = state.recentUrls.length === 0;
    ui.recentSecurityNote.hidden = state.recentUrls.length === 0;
    if (!state.recentUrls.length) {
      ui.recentListContainer.innerHTML = '<div class="empty-state">No recent links.</div>';
      return;
    }

    ui.recentListContainer.innerHTML = state.recentUrls.map((record, index) => {
      const parameters = getRecentParameterNames(record.url).map((name) => {
        const escapedName = escapeHtml(name);
        return `<span class="recent-param" title="${escapedName}">${escapedName}</span>`;
      }).join('') || '<span class="recent-item-no-params">No parameters</span>';

      return `
        <div class="recent-item">
          <span class="recent-item-copy">
            <span class="recent-item-title" title="${escapeHtml(record.label)}">${escapeHtml(record.label)}</span>
            <span class="recent-item-params">${parameters}</span>
            <span class="recent-item-date">${escapeHtml(new Date(record.transformedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>
          </span>
          <span class="recent-item-actions">
            <button class="icon-btn" type="button" data-recent-action="copy" data-recent-index="${index}" aria-label="Copy ${escapeHtml(record.label)}" title="Copy URL">${icons.copy}</button>
            <button class="icon-btn" type="button" data-recent-action="open" data-recent-index="${index}" aria-label="Open ${escapeHtml(record.label)} in Incognito" title="Open in Incognito">${icons.open}</button>
            <button class="icon-btn danger-icon-btn" type="button" data-recent-action="remove" data-recent-index="${index}" aria-label="Remove ${escapeHtml(record.label)}" title="Remove from Recent">${icons.delete}</button>
          </span>
        </div>
      `;
    }).join('');
  }

  function persist() {
    const recentUrls = state.recentUrls;
    return persistWorkspace({
      domain: 'recent',
      snapshot: { [storageKey]: recentUrls },
      defaults: { [storageKey]: [] },
      isCurrent: () => state.recentUrls === recentUrls,
      restore: (stored) => {
        state.recentUrls = normalizeRecentUrls(stored[storageKey]);
        render();
      }
    });
  }

  function addResult({ browserUrl, sourceValue }) {
    state.recentUrls = addRecentUrl(state.recentUrls, { browserUrl, sourceValue });
    render();
    persist().catch((error) => handlePersistenceError(error, 'URL transformed, but could not save it to Recent.'));
  }

  async function handleListClick(event) {
    const button = event.target.closest('[data-recent-action]');
    if (!button) return;

    const index = Number(button.dataset.recentIndex);
    const record = state.recentUrls[index];
    if (!record) return;

    const action = button.dataset.recentAction;
    if (action === 'remove') {
      state.recentUrls = state.recentUrls.filter((_, entryIndex) => entryIndex !== index);
      render();
      try {
        await persist();
        showStatus('Recent link removed.', 'success');
      } catch (error) {
        handlePersistenceError(error, 'Could not remove the recent link.');
      }
      return;
    }

    try {
      if (action === 'copy') {
        await copyText(record.url);
        showStatus('Recent URL copied.', 'success');
      } else if (action === 'open') {
        await extensionApi.openInIncognito(record.url);
        showStatus('Opened recent URL in Incognito.', 'success');
      }
    } catch (error) {
      console.error(error);
      showStatus(action === 'copy' ? 'Clipboard access failed.' : error?.message || 'Could not open the recent URL in Incognito.', 'error');
    }
  }

  async function clear() {
    if (!state.recentUrls.length) return;

    state.recentUrls = [];
    render();
    try {
      await persist();
      showStatus('Recent links cleared.', 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not clear recent links.');
    }
  }

  return { bindEvents, render, addResult };
}