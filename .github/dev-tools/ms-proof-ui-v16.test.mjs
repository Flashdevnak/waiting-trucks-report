import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ui = await readFile(new URL('../../worker/src/proof-ui-v16.js', import.meta.url), 'utf8');
const loader = await readFile(new URL('../../worker/src/turso-index.js', import.meta.url), 'utf8');
const responsiveWorkflow = await readFile(new URL('../workflows/proof-v16-responsive-dev.yml', import.meta.url), 'utf8');
const postCutoverWorkflow = await readFile(new URL('../workflows/post-cutover-regression.yml', import.meta.url), 'utf8');
const responsiveSmoke = await readFile(new URL('./proof-v16-live-responsive-smoke.mjs', import.meta.url), 'utf8');

test('Proof V16 current release keeps quick-day controls inside the date field', () => {
  assert.match(ui, /const VERSION = '20260908-02'/);
  assert.match(ui, /dayRow\.className = 'proof-day-row-v16'/);
  assert.match(ui, /dayInput\.insertAdjacentElement\('beforebegin', dayRow\)/);
  assert.match(ui, /dayRow\.appendChild\(dayInput\)/);
  assert.match(ui, /dayRow\.appendChild\(quick\)/);
  assert.match(ui, /proof-quick-day-v16\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:0/);
  assert.match(ui, /button\.setAttribute\('aria-current', 'date'\)/);
  assert.doesNotMatch(ui, /dayInput\.insertAdjacentElement\('afterend', quick\)/);
  assert.doesNotMatch(ui, /proof-quick-day-detached-v16/);
  assert.doesNotMatch(ui, /toolbar\.insertAdjacentElement\('afterend'/);
  assert.doesNotMatch(ui, /proof-day-caption-v16|shortDay\s*=/);
  assert.doesNotMatch(ui, /min-height:56px/);
  assert.match(ui, /#day-filter\{height:44px!important;min-height:44px!important/);
  assert.match(ui, /select,.proof-toolbar-v16 input\{height:44px!important;min-height:44px!important/);
  assert.match(ui, /proof-quick-day-v16 button\{[^}]*min-height:44px/);
  assert.match(ui, /@media\(max-width:430px\)\{[\s\S]*proof-day-row-v16\{grid-template-columns:minmax\(0,1fr\) 216px\}/);
});

test('Proof V16 command cards map departed and extra to their counted row predicates', () => {
  assert.match(ui, /__PROOF_V16_COMMAND_FILTER_FIX__/);
  assert.match(ui, /departedCardV16\.dataset\.proofV10Filter = 'departed'/);
  assert.match(ui, /extraCardV16\.dataset\.proofV10Filter = 'extra'/);
  assert.match(ui, /ensureStateOptionV16\('departed', 'ออกแล้ว'\)/);
  assert.match(ui, /ensureStateOptionV16\('extra', 'รถเสริม'\)/);
  assert.match(ui, /P\.proofDepartedVehicle\(row\)/);
  assert.match(ui, /Number\(row\?\.lineMode\) === 2/);
});

test('Proof toolbar prioritizes search HUB date and stays responsive', () => {
  assert.match(ui, /proof-search-field-v16/);assert.match(ui, /proof-hub-field-v16/);assert.match(ui, /proof-day-field-v16/);assert.match(ui, /proof-search-field-v16\{order:1!important/);assert.match(ui, /proof-hub-field-v16\{order:2!important/);assert.match(ui, /proof-day-field-v16\{order:3!important/);assert.match(ui, /@media\(min-width:1321px\)/);assert.match(ui, /@media\(max-width:1320px\) and \(min-width:761px\)/);assert.match(ui, /display:block!important;color:#405563/);
});

test('Proof V16 keeps operational Hero A time labels distinct', () => {
  assert.match(ui, /proof-v16-time-item standby/);assert.match(ui, />Standby<\/small>/);assert.match(ui, /proof-v16-time-item release/);assert.match(ui, />ปล่อยรถ<\/small>/);assert.match(ui, /proof-v16-plan-source\{display:none!important\}/);
});

test('Proof V16 UI polish adds no browser network or polling loop', () => {
  assert.doesNotMatch(ui, /\bfetch\s*\(/);assert.doesNotMatch(ui, /XMLHttpRequest|WebSocket|EventSource/);assert.doesNotMatch(ui, /setInterval\s*\(/);assert.match(ui, /sessionStorage\.getItem\(supplierRetryKey\(\)\)/);assert.match(ui, /sessionStorage\.setItem\(supplierRetryKey\(\), '1'\)/);
});

test('Turso loader and served V16 asset use the same cache-buster', () => {
  assert.match(loader, /proof-v16\.js\?v=20260908-02/);assert.match(loader, /maybeHandleProofUiV16/);assert.match(loader, /databaseEnv\(env\)/);assert.doesNotMatch(loader, /proof-ui-v17|proof-v17\.js/);
});

test('permanent responsive and post-cutover gates track the current V16 release', () => {
  assert.match(responsiveWorkflow, /PROOF_V16_ASSET: proof-v16\.js\?v=20260908-02/);
  assert.match(responsiveSmoke, /EXPECTED_ASSET = process\.env\.PROOF_V16_ASSET \|\| 'proof-v16\.js\?v=20260908-02'/);
  assert.match(responsiveSmoke, /SMOKE_VERSION = '20260908-03'/);
  assert.match(responsiveSmoke, /commandFilterFlag/);assert.match(responsiveSmoke, /departedFilter/);assert.match(responsiveSmoke, /extraFilter/);assert.match(responsiveSmoke, /PROOF_V16_COMMAND_FILTERS=PASS/);assert.match(responsiveSmoke, /BROWSER_MUTATION_METHODS=0/);
  assert.match(postCutoverWorkflow, /- worker\/tests\/\*\*/);assert.doesNotMatch(postCutoverWorkflow, /- worker\/test\/\*\*/);assert.match(postCutoverWorkflow, /- \.github\/dev-tools\/proof-v16-live-responsive-smoke\.mjs/);assert.match(postCutoverWorkflow, /- \.github\/workflows\/proof-v16-responsive-dev\.yml/);
});
