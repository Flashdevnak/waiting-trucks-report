import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proofMsBrowserHeaders } from '../src/proof-control.js';

const consumers = [
  'proof-control.js', 'proof-editor.js', 'proof-plate-search-v5.js', 'proof-preview.js',
  'proof-history-v10.js', 'proof-route-meta-v15.js', 'proof-route-meta-v16.js', 'proof-live-v2.js',
];

test('every Proof MS credential consumer uses the shared header builder', () => {
  for (const file of consumers) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /SELECT session_cipher,device_cipher FROM ms_connections/);
    assert.match(source, /function msHeaders\([^)]*\)\s*\{\s*return proofMsBrowserHeaders\(/);
    if (file !== 'proof-control.js') assert.match(source, /import \{ proofMsBrowserHeaders \} from '.\/proof-control.js'/);
  }
});

test('v2 envelope unwraps the device ID and forwards only allowed browser context', () => {
  const credentials = { sessionId: 'fake-session', deviceId: JSON.stringify({
    v: 2, deviceId: 'fake-device', browserContext: {
      'User-Agent': 'Fake browser', 'Accept-Language': 'th-TH', Cookie: 'fake-cookie',
      'sec-ch-ua': 'Fake brand', 'X-FH-MS-EQUIPMENT-TYPE': '9', Authorization: 'forbidden',
    },
  }) };
  const headers = proofMsBrowserHeaders(credentials);
  assert.equal(headers['X-DEVICE-ID'], 'fake-device');
  assert.equal(headers['X-FLE-SESSION-ID'], 'fake-session');
  assert.equal(headers['User-Agent'], 'Fake browser');
  assert.equal(headers['Accept-Language'], 'th-TH');
  assert.equal(headers.cookie, 'fake-cookie');
  assert.equal(headers['sec-ch-ua'], 'Fake brand');
  assert.equal(headers['X-FH-MS-EQUIPMENT-TYPE'], '9');
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.Authorization, undefined);
});

test('plaintext and environment fallback credentials keep their original header defaults', () => {
  const headers = proofMsBrowserHeaders({ sessionId: 'env-session', deviceId: 'legacy-device' });
  assert.equal(headers['X-DEVICE-ID'], 'legacy-device');
  assert.equal(headers['X-FLE-SESSION-ID'], 'env-session');
  assert.equal(headers['User-Agent'], 'Mozilla/5.0');
  assert.equal(headers.cookie, undefined);
});

test('invalid or unsupported envelopes are not silently treated as valid v2', () => {
  for (const deviceId of ['{bad', JSON.stringify({ v: 3, deviceId: 'other' }), JSON.stringify({ v: 2, deviceId: '' })]) {
    assert.equal(proofMsBrowserHeaders({ sessionId: 's', deviceId })['X-DEVICE-ID'], deviceId);
  }
});
