import { createId } from './id.mjs';

const RULE_SOURCE_DEFINITIONS = {
  selectedToken: {
    label: 'Token',
    derivedLabel: 'Selected JWT',
    description: 'Uses the JWT selected in the Tokens workspace. The value is managed automatically.',
    resolve: ({ token }) => token || undefined
  },
  sourcePath: {
    label: 'Page path',
    derivedLabel: 'Path + query + hash',
    description: 'Uses the source URL pathname, query string, and hash. The value is generated automatically.',
    resolve: ({ source }) => `${source.url.pathname || '/'}${source.url.search}${source.url.hash}` || '/'
  },
  literal: {
    label: 'Custom',
    derivedLabel: '',
    description: '',
    resolve: (_context, rule) => rule.value
  }
};

const RULE_SOURCES = new Set(Object.keys(RULE_SOURCE_DEFINITIONS));

const DEFAULT_PARAMETER_RULES = [
  {
    id: 'protected-page-token',
    key: 'auth_token',
    source: 'selectedToken',
    value: '',
    required: true,
    enabled: true
  },
  {
    id: 'protected-page-path',
    key: 'redirect',
    source: 'sourcePath',
    value: '',
    required: true,
    enabled: true
  }
];

export function normalizeStoredParameterRules(records) {
  const normalized = (Array.isArray(records) ? records : [])
    .map(normalizeParameterRule)
    .filter(Boolean);

  if (normalized.some((rule) => rule.required)) return deduplicateById(normalized);

  const defaultNames = new Set(DEFAULT_PARAMETER_RULES.map((rule) => normalizeName(rule.key)));
  const legacyAdditionalRules = normalized.filter((rule) => !defaultNames.has(normalizeName(rule.key)));
  return deduplicateById([...createDefaultParameterRules(), ...legacyAdditionalRules]);
}

export function validateParameterDraft(rules, draft, editingId = null) {
  const key = validateParameterName(draft.key);
  const duplicate = rules.some((rule) =>
    rule.id !== editingId && normalizeName(rule.key) === normalizeName(key)
  );

  if (duplicate) throw new Error(`Parameter “${key}” already exists.`);

  const source = RULE_SOURCES.has(draft.source) ? draft.source : 'literal';
  return {
    key,
    source,
    value: source === 'literal' ? String(draft.value ?? '') : ''
  };
}

export function upsertParameterRule(rules, draft, editingId = null) {
  const validated = validateParameterDraft(rules, draft, editingId);

  if (!editingId) {
    return [...rules, {
      id: createId('rule'),
      ...validated,
      required: false,
      enabled: true
    }];
  }

  return rules.map((rule) => rule.id === editingId
    ? { ...rule, ...validated }
    : rule
  );
}

export function removeParameterRule(rules, ruleId) {
  const rule = rules.find((entry) => entry.id === ruleId);
  if (!rule || rule.required) return rules;
  return rules.filter((entry) => entry.id !== ruleId);
}

export function buildTransformedUrl({ sourceValue, token, rules }) {
  const source = parseUserUrl(sourceValue);
  const targetUrl = new URL(`${source.url.origin}/`);
  const parameterNames = new Set();
  const context = { source, token };

  rules.forEach((rule) => {
    if (rule.enabled === false) return;

    const key = validateParameterName(rule.key);
    const normalizedKey = normalizeName(key);
    if (parameterNames.has(normalizedKey)) {
      throw new Error(`Parameter “${key}” is configured more than once.`);
    }
    parameterNames.add(normalizedKey);

    const sourceDefinition = getRuleSourceDefinition(rule.source);
    const value = sourceDefinition.resolve(context, rule);
    if (value === undefined || value === null || value === '') {
      if (rule.required) throw new Error(getRequiredRuleError(rule));
      return;
    }
    targetUrl.searchParams.set(key, value);
  });

  const browserUrl = targetUrl.toString();
  return {
    browserUrl,
    displayUrl: source.hadProtocol ? browserUrl : browserUrl.replace(/^https?:\/\//i, '')
  };
}

export function getRuleSourceDefinition(source) {
  return RULE_SOURCE_DEFINITIONS[source] || RULE_SOURCE_DEFINITIONS.literal;
}

export function parseUserUrl(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Enter a source URL.');

  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  if (hasExplicitScheme && !isHttpUrl(input)) {
    throw new Error('Only HTTP and HTTPS source URLs are supported.');
  }

  const hadProtocol = /^https?:\/\//i.test(input);
  const candidate = hadProtocol ? input : `https://${input.replace(/^\/+/, '')}`;
  if (!URL.canParse(candidate)) throw new Error('Enter a valid source URL or hostname/path.');

  const url = new URL(candidate);
  if (!url.hostname || !isHttpUrl(url.href)) {
    throw new Error('Enter a valid source URL or hostname/path.');
  }

  return { url, hadProtocol };
}

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function normalizeParameterRule(record) {
  if (!record || typeof record !== 'object') return null;
  const key = String(record.key || '').trim();
  if (!key) return null;

  const source = RULE_SOURCES.has(record.source) ? record.source : 'literal';
  return {
    id: String(record.id || createId('rule')),
    key,
    source,
    value: source === 'literal' ? String(record.value ?? '') : '',
    required: Boolean(record.required),
    enabled: record.enabled !== false
  };
}

function createDefaultParameterRules() {
  return DEFAULT_PARAMETER_RULES.map((rule) => ({ ...rule }));
}

function deduplicateById(rules) {
  const seenIds = new Set();
  return rules.filter((rule) => {
    if (seenIds.has(rule.id)) return false;
    seenIds.add(rule.id);
    return true;
  });
}

function validateParameterName(value) {
  const key = String(value || '').trim();
  if (!key) throw new Error('Enter a parameter name.');
  if (/\s|[\u0000-\u001F\u007F]/.test(key)) {
    throw new Error(`“${key}” is not a valid parameter name.`);
  }
  return key;
}

function getRequiredRuleError(rule) {
  if (rule.source === 'selectedToken') return `Select a JWT token for “${rule.key}”.`;
  if (rule.source === 'sourcePath') return `Enter a source URL for “${rule.key}”.`;
  return `Enter a custom value for “${rule.key}”.`;
}

function normalizeName(value) {
  return String(value).toLowerCase();
}
