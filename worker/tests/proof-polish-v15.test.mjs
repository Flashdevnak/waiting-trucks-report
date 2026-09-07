import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { maybeHandleProofUiV15 } from '../src/proof-ui-v15.js';

const source = await fs.readFile(new URL('../src/proof-ui-v15.js', import.meta.url), 'utf8');
const baseActionsSource = await fs.readFile(new URL('../../proof-v2-actions.js', import.meta.url), 'utf8');

test('Proof V15 asset is Proof-only and serves successfully', async () => {
  const ok = await maybeHandleProofUiV15(new Request('https://dev.test/proof-v15.js'));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /PROOF_POLISH_V15/);
  const miss = await maybeHandleProofUiV15(new Request('https://dev.test/ms.html'));
  assert.equal(miss, null);
});

test('Proof V15 table keeps six operational columns and single-line desktop actions', () => {
  assert.match(source, /เส้นทาง<\/b><b>บาร์รถ<\/b><b>เวลา<\/b><b>คนขับและเบอร์โทร<\/b><b>บริษัทซัพและรถ<\/b><b>สถานะและจัดการ/);
  assert.match(source, /เปิดบาร์และปริ้น/);
  assert.match(source, /ตรวจและปริ้น/);
  assert.match(source, /white-space:nowrap!important/);
  assert.match(source, /text-overflow:ellipsis/);
  assert.match(source, /data-proof-v15-expand/);
});

test('Proof V15 print editor exposes several selectable rows instead of one cramped result', () => {
  assert.match(source, /proof-option-list\{min-height:175px!important;max-height:270px!important/);
  assert.match(source, /proof-option\{min-height:58px!important/);
  assert.match(source, /width:min\(1060px,calc\(100vw - 28px\)\)/);
  assert.match(source, /overflow-y:auto!important;overflow-x:hidden!important/);
});

test('Proof V15 removes AI-like visible separators without adding background polling', () => {
  assert.match(source, /replace\(\/\\s\*•\\s\*\/g, ' '\)/);
  assert.match(source, /replace\(\/\\s\*—\\s\*\/g, ' '\)/);
  assert.match(source, /replace\(\/\\s\*→\\s\*\/g, ' ถึง '\)/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /\/api\/proof\/plate-options[^\n]*setTimeout/);
  assert.doesNotMatch(source, /\/api\/proof\/driver-options[^\n]*setTimeout/);
});

test('Proof V15 popup text polish is event-scoped and never observes the whole DOM continuously', () => {
  assert.match(source, /PROOF_EDITOR_EVENT_POLISH_V15/);
  assert.match(source, /P\.renderEditorSearchItems = \(\.\.\.args\) =>/);
  assert.doesNotMatch(source, /new MutationObserver\s*\(/);
});

test('Proof base editor copy has no visible bullet arrow or dash placeholders', () => {
  assert.doesNotMatch(baseActionsSource, /[•→]/);
  assert.doesNotMatch(baseActionsSource, /['"]—['"]/);
  assert.doesNotMatch(baseActionsSource, />—</);
});
