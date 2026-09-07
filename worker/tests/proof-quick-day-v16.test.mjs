import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { maybeHandleProofUiV16 } from '../src/proof-ui-v16.js';

const source = await fs.readFile(new URL('../src/proof-ui-v16.js', import.meta.url), 'utf8');
const tursoSource = await fs.readFile(new URL('../src/turso-index.js', import.meta.url), 'utf8');
const devConfigSource = await fs.readFile(new URL('../wrangler.dev.jsonc', import.meta.url), 'utf8');

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

test('Proof V16 command cards filter departed and extra rows instead of falling back to all', () => {
  assert.match(source, /PROOF_COMMAND_FILTER_FIX_V16/);
  assert.match(source, /departedCardV16\.dataset\.proofV10Filter = 'departed'/);
  assert.match(source, /extraCardV16\.dataset\.proofV10Filter = 'extra'/);
  assert.match(source, /ensureStateOptionV16\('departed', 'ออกแล้ว'\)/);
  assert.match(source, /ensureStateOptionV16\('extra', 'รถเสริม'\)/);
  assert.match(source, /filter !== 'departed' && filter !== 'extra'/);
  assert.match(source, /P\.proofDepartedVehicle\(row\)/);
  assert.match(source, /Number\(row\?\.lineMode\) === 2/);
  assert.doesNotMatch(source, /departedCardV16\.dataset\.proofV10Filter = 'all'/);
  assert.doesNotMatch(source, /extraCardV16\.dataset\.proofV10Filter = 'all'/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
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

test('Proof V16 owns deterministic header dropdown switching and V17 stays absent', () => {
  assert.match(tursoSource, /__PROOF_V16_DROPDOWN_SWITCH_FIX__/);
  assert.match(tursoSource, /__PROOF_V16_DROPDOWN_SWITCH_LAST__/);
  assert.match(tursoSource, /event\.preventDefault\(\)/);
  assert.match(tursoSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(tursoSource, /const shouldOpen=!owner\.open/);
  assert.match(tursoSource, /queueMicrotask\(\(\)=>apply\('microtask'\)\)/);
  assert.match(tursoSource, /setTimeout\(\(\)=>apply\('timeout0'\),0\)/);
  assert.match(tursoSource, /setTimeout\(\(\)=>apply\('timeout32'\),32\)/);
  assert.match(tursoSource, /if\(token!==sequence\)return/);
  assert.match(tursoSource, /proof-v16\.js\?v=20260908-01/);
  assert.doesNotMatch(tursoSource, /proof-v17|maybeHandleProofUiV17/i);
});

test('DEV closure contract stays Turso-only with no D1 binding and V16 as the final Proof asset', () => {
  assert.match(devConfigSource, /"main"\s*:\s*"src\/turso-index\.js"/);
  assert.match(devConfigSource, /"DB_BACKEND"\s*:\s*"turso"/);
  assert.doesNotMatch(devConfigSource, /"d1_databases"\s*:/);
  assert.doesNotMatch(devConfigSource, /"binding"\s*:\s*"DB"/);
  assert.match(tursoSource, /proof-v16\.js\?v=20260908-01/);
  assert.doesNotMatch(tursoSource, /proof-v17|maybeHandleProofUiV17/i);
});
