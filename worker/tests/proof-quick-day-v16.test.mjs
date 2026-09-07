import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { maybeHandleProofUiV16 } from '../src/proof-ui-v16.js';

const source = await fs.readFile(new URL('../src/proof-ui-v16.js', import.meta.url), 'utf8');

test('Proof V16 asset serves only the quick-day Proof enhancement', async () => {
  const ok = await maybeHandleProofUiV16(new Request('https://dev.test/proof-v16.js'));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /PROOF_QUICK_DAY_V16/);
  assert.equal(await maybeHandleProofUiV16(new Request('https://dev.test/ms.html')), null);
});

test('Proof V16 provides yesterday today tomorrow and preserves manual date selection', () => {
  assert.match(source, /\[-1,'เมื่อวาน'\]/);
  assert.match(source, /\[0,'วันนี้'\]/);
  assert.match(source, /\[1,'พรุ่งนี้'\]/);
  assert.match(source, /dayInput\.addEventListener\('change', syncQuickDays\)/);
  assert.match(source, /P\.state\.day = value/);
  assert.match(source, /await P\.loadRoutes\(false\)/);
});

test('Proof V16 supplier completion does only one session-scoped refresh and no polling', () => {
  assert.match(source, /sessionStorage\.getItem\(supplierRetryKey\(\)\)/);
  assert.match(source, /sessionStorage\.setItem\(supplierRetryKey\(\), '1'\)/);
  assert.match(source, /6500/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('Proof V16 quick date buttons are mobile-safe', () => {
  assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(source, /proof-quick-day-v16 button\{[^}]*min-height:44px/);
  assert.match(source, /@media\(max-width:430px\)/);
});
