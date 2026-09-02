import test from 'node:test';
import assert from 'node:assert/strict';
import { addRecentUrl, getRecentParameterNames, MAX_RECENT_URLS, normalizeRecentUrls } from '../src/recent-urls.mjs';

test('keeps the completed URL but labels it with the source host and path', () => {
  const url = 'https://docs.example.com/?auth_token=secret&redirect=%2Fguides%2Fprivate';
  const records = addRecentUrl([], {
    browserUrl: url,
    sourceValue: 'https://docs.example.com/guides/private?session=secret'
  }, 1000);

  assert.deepEqual(records, [{
    url,
    label: 'docs.example.com/guides/private',
    transformedAt: 1000
  }]);
});

test('lists distinct parameter names without exposing their values', () => {
  assert.deepEqual(getRecentParameterNames('https://example.com/?auth_token=secret&redirect=%2Fprivate&auth_token=another'), [
    'auth_token', 'redirect'
  ]);
  assert.deepEqual(getRecentParameterNames('https://example.com/'), []);
});

test('moves repeated completed URLs to the top without duplicates', () => {
  const firstUrl = 'https://example.com/?redirect=%2Ffirst';
  const secondUrl = 'https://example.com/?redirect=%2Fsecond';
  const first = addRecentUrl([], { browserUrl: firstUrl, sourceValue: 'example.com/first' }, 1000);
  const second = addRecentUrl(first, { browserUrl: secondUrl, sourceValue: 'example.com/second' }, 2000);
  const repeated = addRecentUrl(second, { browserUrl: firstUrl, sourceValue: 'example.com/first' }, 3000);

  assert.deepEqual(repeated.map((record) => record.url), [firstUrl, secondUrl]);
  assert.equal(repeated[0].transformedAt, 3000);
  assert.equal(first[0].transformedAt, 1000);
});

test('keeps at most eight distinct recent links', () => {
  let records = [];
  for (let index = 0; index < MAX_RECENT_URLS + 3; index += 1) {
    records = addRecentUrl(records, {
      browserUrl: `https://example.com/?id=${index}`,
      sourceValue: `example.com/page/${index}`
    }, 1000 + index);
  }

  assert.equal(MAX_RECENT_URLS, 8);
  assert.equal(records.length, 8);
  assert.equal(records[0].url, 'https://example.com/?id=10');
  assert.equal(records.at(-1).url, 'https://example.com/?id=3');
});

test('normalizes stored history and discards unsafe or duplicate entries', () => {
  assert.deepEqual(normalizeRecentUrls(null), []);
  const records = normalizeRecentUrls([
    null,
    { url: 'javascript:alert(1)', label: 'Unsafe', transformedAt: 1000 },
    { url: 'https://example.com/private', label: '  Private  ', transformedAt: 2000 },
    { url: 'https://example.com/private', label: 'Duplicate', transformedAt: 1000 },
    { url: 'https://example.org/', label: '', transformedAt: 3000 },
    { url: 'https://example.net/', label: 'Missing timestamp' }
  ]);

  assert.deepEqual(records, [
    { url: 'https://example.com/private', label: 'Private', transformedAt: 2000 },
    { url: 'https://example.org/', label: 'example.org', transformedAt: 3000 }
  ]);
});