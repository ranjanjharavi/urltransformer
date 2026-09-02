import { parseUserUrl } from './parameter-rules.mjs';

export const MAX_RECENT_URLS = 8;

export function getRecentParameterNames(url) {
  return [...new Set(new URL(url).searchParams.keys())];
}

export function addRecentUrl(records, { browserUrl, sourceValue }, transformedAt = Date.now()) {
  const sourceUrl = parseUserUrl(sourceValue).url;
  const label = `${sourceUrl.hostname}${sourceUrl.pathname === '/' ? '' : sourceUrl.pathname}`;
  return normalizeRecentUrls([
    { url: browserUrl, label, transformedAt },
    ...(Array.isArray(records) ? records : [])
  ]);
}

export function normalizeRecentUrls(records) {
  const seenUrls = new Set();
  return (Array.isArray(records) ? records : [])
    .map(normalizeRecentUrl)
    .filter((record) => {
      if (!record || seenUrls.has(record.url)) return false;
      seenUrls.add(record.url);
      return true;
    })
    .slice(0, MAX_RECENT_URLS);
}

function normalizeRecentUrl(record) {
  if (!record || typeof record.url !== 'string' || !Number.isFinite(record.transformedAt) || record.transformedAt <= 0) return null;

  let url;
  try {
    url = new URL(record.url);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const label = typeof record.label === 'string' ? record.label.trim().slice(0, 160) : '';
  return { url: url.href, label: label || url.hostname, transformedAt: record.transformedAt };
}