import { createId } from './id.mjs';

export function normalizeTokenLibrary(records) {
  const seenTokens = new Set();

  return (Array.isArray(records) ? records : [])
    .map(normalizeTokenRecord)
    .filter((record) => {
      if (!record || seenTokens.has(record.token)) return false;
      seenTokens.add(record.token);
      return true;
    });
}

export function createTokenRecord(token) {
  return {
    id: createId('token'),
    token: String(token || '').trim(),
    createdAt: Date.now()
  };
}

export function describeToken(tokenValue, index = 0) {
  const decoded = decodeJwtToken(tokenValue);
  const payload = decoded?.payload || null;

  return {
    payload,
    title: getTokenDisplayTitle(tokenValue, payload, index),
    isJwt: Boolean(payload),
    expired: isJwtExpired(payload),
    issuedLabel: formatJwtTime(payload?.iat) || 'Unknown',
    expiryLabel: formatJwtTime(payload?.exp) || 'None',
    expiryWarning: getJwtExpiryWarning(payload)
  };
}

function normalizeTokenRecord(record) {
  const token = String(record?.token || '').trim();
  if (!token) return null;

  return {
    id: String(record?.id || createId('token')),
    token,
    createdAt: Number(record?.createdAt) || Date.now()
  };
}

function decodeJwtToken(tokenValue) {
  const parts = String(tokenValue || '').split('.');
  if (parts.length < 2) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return isObject(header) && isObject(payload) ? { header, payload } : null;
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
  const identity = [payload?.email, payload?.upn, payload?.preferred_username, payload?.unique_name]
    .find((value) => typeof value === 'string' && value.trim());
  if (identity) return identity;

  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  return name || `Token ${index + 1} \u2022 ${getTokenFingerprint(tokenValue)}`;
}

function getTokenFingerprint(tokenValue) {
  const normalized = String(tokenValue || '').trim();
  if (!normalized) return 'empty';
  return normalized.length <= 8 ? normalized : `...${normalized.slice(-8)}`;
}

function toNumericDate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;

  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

function formatJwtTime(value) {
  const seconds = toNumericDate(value);
  if (seconds === null) return '';

  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function isJwtExpired(payload) {
  const exp = toNumericDate(payload?.exp);
  return exp !== null && exp * 1000 <= Date.now();
}

function getJwtExpiryWarning(payload) {
  const exp = toNumericDate(payload?.exp);
  if (exp === null) return null;

  const deltaMs = exp * 1000 - Date.now();
  const hourMs = 60 * 60 * 1000;
  if (deltaMs <= 0 || deltaMs > 24 * hourMs) return null;
  return deltaMs < hourMs
    ? `Expires in ${Math.max(1, Math.floor(deltaMs / 60000))}m`
    : `Expires in ${Math.floor(deltaMs / hourMs)}h`;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}
