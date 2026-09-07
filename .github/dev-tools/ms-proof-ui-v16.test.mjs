import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ui = await readFile(new URL('../../worker/src/proof-ui-v16.js', import.meta.url), 'utf8');
const loader = await readFile(new URL('../../worker/src/turso-index.js', import.meta.url), 'utf8');

test('Proof V16.06 keeps quick-day controls inside the date field', () => {
  assert.match(ui, /const VERSION = '20260907-06'/);
  assert.match(ui, /dayInput\.insertAdjacentElement\('afterend', quick\)/);
  assert.doesNotMatch(ui, /proof-quick-day-detached-v16/);
  assert.doesNotMatch(ui, /toolbar\.insertAdjacentElement\('afterend'/);
  assert.doesNotMatch(ui, /min-height:56px/);
  assert.match(ui, /#day-filter\{height:44px!important;min-height:44px!important\}/);
  assert.match(ui, /select,.proof-toolbar-v16 input\{height:44px!important;min-height:44px!important/);
  assert.match(ui, /proof-quick-day-v16 button\{[^}]*min-height:44px/);
});

test('Proof toolbar prioritizes search HUB date and stays responsive', () => {
  assert.match(ui, /proof-search-field-v16/);
  assert.match(ui, /proof-hub-field-v16/);
  assert.match(ui, /proof-day-field-v16/);
  assert.match(ui, /proof-search-field-v16\{order:1!important/);
  assert.match(ui, /proof-hub-field-v16\{order:2!important/);
  assert.match(ui, /proof-day-field-v16\{order:3!important/);
  assert.match(ui, /@media\(min-width:1321px\)/);
  assert.match(ui, /@media\(max-width:1320px\) and \(min-width:761px\)/);
  assert.match(ui, /display:block!important;color:#405563/);
});

test('Proof V16 keeps operational Hero A time labels distinct', () => {
  assert.match(ui, /PROOF_EDITOR_HERO_A_V16/);
  assert.match(ui, /proof-v16-time-item standby/);
  assert.match(ui, />Standby<\/small>/);
  assert.match(ui, /proof-v16-time-item release/);
  assert.match(ui, />ปล่อยรถ<\/small>/);
  assert.match(ui, /proof-v16-plan-source\{display:none!important\}/);
});

test('Proof V16 UI polish adds no browser network or polling loop', () => {
  assert.doesNotMatch(ui, /\bfetch\s*\(/);
  assert.doesNotMatch(ui, /XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(ui, /setInterval\s*\(/);
  assert.match(ui, /sessionStorage\.getItem\(supplierRetryKey\(\)\)/);
  assert.match(ui, /sessionStorage\.setItem\(supplierRetryKey\(\), '1'\)/);
});

test('Turso loader and served V16 asset use the same cache-buster', () => {
  assert.match(loader, /proof-v16\.js\?v=20260907-06/);
  assert.match(loader, /maybeHandleProofUiV16/);
  assert.match(loader, /databaseEnv\(env\)/);
  assert.doesNotMatch(loader, /proof-ui-v17|proof-v17\.js/);
});
