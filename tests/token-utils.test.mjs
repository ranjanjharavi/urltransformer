import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenRecord,
  describeToken,
  normalizeTokenLibrary
} from '../src/token-utils.mjs';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function base64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeJwt(payload, header = { alg: 'none', typ: 'JWT' }) {
  return `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}.`;
}

const secondsFromNow = (ms) => Math.round((Date.now() + ms) / 1000);

test('normalizes duplicate tokens and describes JWT identity', () => {
  const jwt = 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImRldkBleGFtcGxlLmNvbSJ9.';
  const record = createTokenRecord(jwt);
  const library = normalizeTokenLibrary([record, { ...record, id: 'duplicate' }]);
  const description = describeToken(jwt);

  assert.equal(library.length, 1);
  assert.equal(description.title, 'dev@example.com');
  assert.equal(description.isJwt, true);
});

test('createTokenRecord trims the token and stamps id plus creation time', () => {
  const before = Date.now();
  const record = createTokenRecord('  abc.def.ghi \n');

  assert.equal(record.token, 'abc.def.ghi');
  assert.ok(record.id);
  assert.ok(record.createdAt >= before && record.createdAt <= Date.now());
  assert.notEqual(createTokenRecord('abc.def.ghi').id, record.id);
});

test('createTokenRecord tolerates empty and non-string input', () => {
  assert.equal(createTokenRecord(undefined).token, '');
  assert.equal(createTokenRecord(null).token, '');
  assert.equal(createTokenRecord(12345).token, '12345');
});

test('normalizeTokenLibrary drops blank records and non-array payloads', () => {
  assert.deepEqual(normalizeTokenLibrary(null), []);
  assert.deepEqual(normalizeTokenLibrary('tokens'), []);
  assert.deepEqual(normalizeTokenLibrary([null, {}, { token: '   ' }, 'raw']), []);
});

test('normalizeTokenLibrary keeps the first copy of a duplicate token and repairs fields', () => {
  const library = normalizeTokenLibrary([
    { id: 'first', token: 'a.b.c', createdAt: 1000 },
    { id: 'second', token: '  a.b.c  ', createdAt: 2000 },
    { token: 'd.e.f', createdAt: 'not-a-number' }
  ]);

  assert.equal(library.length, 2);
  assert.deepEqual(library[0], { id: 'first', token: 'a.b.c', createdAt: 1000 });
  assert.equal(library[1].token, 'd.e.f');
  assert.ok(library[1].id, 'a missing id is generated');
  assert.ok(Number.isFinite(library[1].createdAt), 'an invalid createdAt falls back to now');
});

test('normalizeTokenLibrary preserves entry order', () => {
  const library = normalizeTokenLibrary([
    { id: '1', token: 'one' },
    { id: '2', token: 'two' },
    { id: '3', token: 'three' }
  ]);

  assert.deepEqual(library.map((entry) => entry.token), ['one', 'two', 'three']);
});

test('describeToken prefers email, then other identity claims, then name', () => {
  assert.equal(describeToken(makeJwt({ email: 'a@example.com', name: 'Ada' })).title, 'a@example.com');
  assert.equal(describeToken(makeJwt({ upn: 'b@example.com', name: 'Ada' })).title, 'b@example.com');
  assert.equal(describeToken(makeJwt({ preferred_username: 'carol' })).title, 'carol');
  assert.equal(describeToken(makeJwt({ unique_name: 'dave' })).title, 'dave');
  assert.equal(describeToken(makeJwt({ name: '  Ada Lovelace  ' })).title, 'Ada Lovelace');
  assert.equal(describeToken(makeJwt({ email: '   ', name: 'Ada' })).title, 'Ada');
  assert.equal(describeToken(makeJwt({ email: 42, name: 'Ada' })).title, 'Ada');
});

test('describeToken falls back to an indexed fingerprint for anonymous tokens', () => {
  assert.equal(describeToken(makeJwt({ sub: '123' }), 2).title.startsWith('Token 3 '), true);
  assert.equal(describeToken('opaque-token-value', 0).title, 'Token 1 • ...en-value');
  assert.equal(describeToken('short', 0).title, 'Token 1 • short');
  assert.equal(describeToken('', 0).title, 'Token 1 • empty');
});

test('describeToken reports non-JWT values without payload metadata', () => {
  const description = describeToken('not.a.jwt');

  assert.equal(description.isJwt, false);
  assert.equal(description.payload, null);
  assert.equal(description.expired, false);
  assert.equal(description.issuedLabel, 'Unknown');
  assert.equal(description.expiryLabel, 'None');
  assert.equal(description.expiryWarning, null);
});

test('describeToken rejects malformed or non-object JWT segments', () => {
  assert.equal(describeToken('onlyonesegment').isJwt, false);
  assert.equal(describeToken(`${base64Url('{"alg":"none"}')}.${base64Url('"a string"')}.`).isJwt, false);
  assert.equal(describeToken(`${base64Url('"a string"')}.${base64Url('{"email":"a@b.c"}')}.`).isJwt, false);
  assert.equal(describeToken(`${base64Url('{"alg":"none"}')}.not-base64-json.`).isJwt, false);
});

test('describeToken decodes non-ASCII payload claims', () => {
  assert.equal(describeToken(makeJwt({ name: 'Zoë Ünicode' })).title, 'Zoë Ünicode');
});

test('describeToken flags expired tokens', () => {
  const expired = describeToken(makeJwt({ exp: secondsFromNow(-HOUR) }));
  const active = describeToken(makeJwt({ exp: secondsFromNow(48 * HOUR) }));

  assert.equal(expired.expired, true);
  assert.equal(expired.expiryWarning, null, 'an already-expired token gets no countdown');
  assert.equal(active.expired, false);
});

test('describeToken warns only inside the 24 hour expiry window', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });

  assert.equal(describeToken(makeJwt({ exp: secondsFromNow(30 * MINUTE) })).expiryWarning, 'Expires in 30m');
  assert.equal(describeToken(makeJwt({ exp: secondsFromNow(3 * HOUR) })).expiryWarning, 'Expires in 3h');
  assert.equal(describeToken(makeJwt({ exp: secondsFromNow(23 * HOUR) })).expiryWarning, 'Expires in 23h');
  assert.equal(describeToken(makeJwt({ exp: secondsFromNow(24 * HOUR) })).expiryWarning, 'Expires in 24h', 'exactly 24h is the inclusive upper bound');
  assert.equal(describeToken(makeJwt({ exp: secondsFromNow(25 * HOUR) })).expiryWarning, null);
  assert.equal(describeToken(makeJwt({ exp: secondsFromNow(20 * SECOND) })).expiryWarning, 'Expires in 1m', 'sub-minute expiry rounds up to 1m');
});

test('describeToken ignores unparseable exp and iat claims', () => {
  const description = describeToken(makeJwt({ exp: 'soon', iat: 'earlier' }));

  assert.equal(description.expired, false);
  assert.equal(description.expiryLabel, 'None');
  assert.equal(description.issuedLabel, 'Unknown');
  assert.equal(description.expiryWarning, null);
});

test('describeToken treats non-numeric exp and iat claims as absent, not as the epoch', () => {
  // Number(null), Number(false), Number('') and Number([]) are all 0, so these
  // claims must be rejected by type rather than by Number.isFinite alone —
  // otherwise a null exp would mark an otherwise valid token expired in 1970.
  for (const claim of [null, false, true, '', '   ', [], {}]) {
    const description = describeToken(makeJwt({ exp: claim, iat: claim }));

    assert.equal(description.expired, false, `exp ${JSON.stringify(claim)} must not read as expired`);
    assert.equal(description.expiryLabel, 'None', `exp ${JSON.stringify(claim)} must have no expiry label`);
    assert.equal(description.issuedLabel, 'Unknown', `iat ${JSON.stringify(claim)} must have no issued label`);
    assert.equal(description.expiryWarning, null);
  }
});

test('describeToken still accepts timestamps encoded as numeric strings', () => {
  const expired = describeToken(makeJwt({ exp: String(secondsFromNow(-HOUR)) }));
  const active = describeToken(makeJwt({ exp: ` ${secondsFromNow(48 * HOUR)} ` }));

  assert.equal(expired.expired, true);
  assert.notEqual(expired.expiryLabel, 'None');
  assert.equal(active.expired, false);
  assert.notEqual(active.expiryLabel, 'None');
});

test('describeToken honours an explicit zero exp claim', () => {
  const description = describeToken(makeJwt({ exp: 0 }));

  assert.equal(description.expired, true);
  assert.notEqual(description.expiryLabel, 'None');
});

test('describeToken formats issued and expiry timestamps when present', () => {
  const description = describeToken(makeJwt({
    iat: secondsFromNow(-2 * HOUR),
    exp: secondsFromNow(48 * HOUR)
  }));

  assert.notEqual(description.issuedLabel, 'Unknown');
  assert.notEqual(description.expiryLabel, 'None');
});
