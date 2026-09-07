import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { maybeHandleProofUiV14 } from '../src/proof-ui-v14.js';

const read = path => fs.readFile(new URL(path, import.meta.url), 'utf8');

test('Proof V14 is Proof-only, responsive, and quota-safe', async () => {
  const ui = await read('../src/proof-ui-v14.js');
  const turso = await read('../src/turso-index.js');
  assert.match(turso, /maybeHandleProofUiV14/);
  assert.match(turso, /proof-v14\.js\?v=20260907-01/);
  for (const marker of [
    'PROOF_RESPONSIVE_OPS_V14',
    'proof-v14-columns',
    'proof-v14-action-pair',
    'position:static!important',
    'grid-template-columns:repeat(2,minmax(0,1fr))',
    'ยกเลิกรถ',
    'disabled',
    'บริษัทซัพ / รถ',
  ]) assert.match(ui, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(ui, /setInterval\s*\(/);
  assert.doesNotMatch(ui, /MutationObserver/);
  assert.doesNotMatch(ui, /\/api\/proof\/history/);
  assert.doesNotMatch(ui, /plate-options/);
  const response = await maybeHandleProofUiV14(new Request('https://dev.test/proof-v14.js'));
  assert.equal(response.status, 200);
  const js = await response.text();
  assert.match(js, /PROOF_RESPONSIVE_OPS_V14/);
});

test('Proof V14 does not serve non-Proof assets', async () => {
  assert.equal(await maybeHandleProofUiV14(new Request('https://dev.test/ms.js')), null);
});
