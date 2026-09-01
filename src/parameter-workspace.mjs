import {
  getRuleSourceDefinition,
  normalizeStoredParameterRules,
  removeParameterRule,
  upsertParameterRule
} from './parameter-rules.mjs';
import { icons, sourceIcons } from './icons.mjs';

export function createParameterWorkspace({ ui, state, persistWorkspace, storageKey, invalidateResult, showStatus, handlePersistenceError, escapeHtml, onEnter }) {
  let editingParameterId = null;

  function bindEvents() {
    ui.addParameterBtn.addEventListener('click', () => openEditor());
    ui.closeParameterEditorBtn.addEventListener('click', closeEditor);
    ui.cancelParameterBtn.addEventListener('click', closeEditor);
    ui.saveParameterBtn.addEventListener('click', save);
    ui.parameterListContainer.addEventListener('click', handleListClick);
    ui.parameterListContainer.addEventListener('change', handleListChange);

    document.querySelectorAll('input[name="parameterSource"]').forEach((input) => {
      input.addEventListener('change', renderEditorSource);
    });
    onEnter(ui.parameterName, save);
    onEnter(ui.parameterValue, save);
  }

  function renderList() {
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
        <div class="parameter-row${rule.enabled === false ? ' is-paused' : ''}" data-rule-id="${escapeHtml(rule.id)}">
          <span class="parameter-row-copy">
            <span class="parameter-row-name">${escapeHtml(rule.key)}</span>
            <span class="parameter-row-source">
              ${sourceIcons[rule.source]}
              <span>${escapeHtml(source.label)}</span>
              <span aria-hidden="true">·</span>
              <span class="parameter-row-value">${escapeHtml(valueLabel)}</span>
              ${rule.required ? '<span class="parameter-required">Required</span>' : ''}
              <span class="parameter-paused"${rule.enabled === false ? '' : ' hidden'}>Paused</span>
            </span>
          </span>
          <span class="parameter-row-actions">
            <label class="parameter-switch" title="Include in generated URL">
              <input type="checkbox" data-toggle-rule="${escapeHtml(rule.id)}" aria-label="Include ${escapeHtml(rule.key)} in generated URL"${rule.enabled === false ? '' : ' checked'}>
              <span class="parameter-switch-track" aria-hidden="true"></span>
            </label>
            <button class="icon-btn" type="button" data-edit-rule="${escapeHtml(rule.id)}" aria-label="Edit ${escapeHtml(rule.key)}" title="Edit parameter">${icons.edit}</button>
            ${rule.required ? '' : `<button class="icon-btn danger-icon-btn" type="button" data-delete-rule="${escapeHtml(rule.id)}" aria-label="Delete ${escapeHtml(rule.key)}" title="Delete parameter">${icons.delete}</button>`}
          </span>
        </div>
      `;
    }).join('');
  }

  function renderSummary() {
    const keys = state.parameterRules.filter((rule) => rule.enabled !== false).map((rule) => rule.key.trim()).filter(Boolean);
    const visibleKeys = keys.slice(0, 3);
    const remainingCount = keys.length - visibleKeys.length;
    const summary = visibleKeys.join(' · ') || 'No active parameters';
    ui.parameterSummary.textContent = remainingCount > 0 ? `${summary} · +${remainingCount}` : summary;
  }

  function render() {
    renderList();
    renderSummary();
  }

  async function handleListClick(event) {
    const editButton = event.target.closest('[data-edit-rule]');
    if (editButton) {
      openEditor(editButton.dataset.editRule);
      return;
    }

    const deleteButton = event.target.closest('[data-delete-rule]');
    if (deleteButton) await deleteParameter(deleteButton.dataset.deleteRule);
  }

  async function handleListChange(event) {
    const input = event.target.closest('[data-toggle-rule]');
    if (!input) return;

    const rule = state.parameterRules.find((entry) => entry.id === input.dataset.toggleRule);
    if (!rule) return;

    const enabled = input.checked;
    state.parameterRules = state.parameterRules.map((entry) => entry.id === rule.id
      ? { ...entry, enabled }
      : entry
    );
    const row = input.closest('.parameter-row');
    row.classList.toggle('is-paused', !enabled);
    row.querySelector('.parameter-paused').hidden = enabled;
    invalidateResult();
    renderSummary();

    try {
      await persist();
      showStatus(enabled ? 'Parameter enabled.' : 'Parameter paused.', 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not save parameter changes.');
    }
  }

  function openEditor(ruleId = null) {
    const rule = ruleId ? state.parameterRules.find((entry) => entry.id === ruleId) : null;
    if (ruleId && !rule) return;

    editingParameterId = rule?.id || null;
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
    renderEditorSource();
    ui.parameterName.focus({ preventScroll: true });
  }

  function closeEditor() {
    editingParameterId = null;
    ui.parameterEditor.hidden = true;
    ui.parameterListContainer.hidden = false;
    ui.addParameterBtn.hidden = false;
    ui.parameterName.value = '';
    ui.parameterValue.value = '';
  }

  function renderEditorSource() {
    const source = document.querySelector('input[name="parameterSource"]:checked')?.value || 'literal';
    const definition = getRuleSourceDefinition(source);
    const isCustom = source === 'literal';
    ui.customValueField.hidden = !isCustom;
    ui.derivedValue.hidden = isCustom;
    ui.derivedValueText.textContent = isCustom ? '' : definition.description;
  }

  async function save() {
    const draft = {
      key: ui.parameterName.value,
      source: document.querySelector('input[name="parameterSource"]:checked')?.value || 'literal',
      value: ui.parameterValue.value
    };

    try {
      state.parameterRules = upsertParameterRule(state.parameterRules, draft, editingParameterId);
    } catch (error) {
      showStatus(error.message, 'error');
      ui.parameterName.focus();
      return;
    }

    invalidateResult();
    render();
    closeEditor();
    try {
      await persist();
      showStatus('Parameter saved.', 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not save parameter changes.');
    }
  }

  async function deleteParameter(ruleId) {
    const rule = state.parameterRules.find((entry) => entry.id === ruleId);
    if (!rule || rule.required || !globalThis.confirm(`Delete “${rule.key}”?`)) return;

    state.parameterRules = removeParameterRule(state.parameterRules, ruleId);
    if (editingParameterId === ruleId) closeEditor();
    invalidateResult();
    render();
    try {
      await persist();
      showStatus('Parameter removed.', 'success');
    } catch (error) {
      handlePersistenceError(error, 'Could not save parameter changes.');
    }
  }

  function persist() {
    const rules = state.parameterRules;
    return persistWorkspace({
      domain: 'parameters',
      snapshot: { [storageKey]: rules },
      defaults: { [storageKey]: [] },
      isCurrent: () => state.parameterRules === rules,
      restore: (stored) => {
        state.parameterRules = normalizeStoredParameterRules(stored[storageKey]);
        invalidateResult();
        render();
      }
    });
  }

  return { bindEvents, render };
}