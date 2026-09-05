import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Proof V10 command center is Proof-only and keeps polling unchanged', async () => {
  const html = await read('proof.html');
  const ui = await read('worker/src/proof-ui-v10.js');
  const control = await read('worker/src/proof-control.js');
  assert.match(html, /\/proof-v10\.js\?v=20260906-01/);
  assert.match(ui, /PROOF_COMMAND_CENTER_V10/);
  assert.match(ui, /รถไม่เข้า/);
  assert.match(ui, /releaseTimestamp/);
  assert.match(ui, /barcodeEnabled/);
  assert.match(ui, /เปิดใช้บาร์รถแล้ว/);
  assert.match(ui, /proof-alert-dock-v10/);
  assert.match(ui, /proof-command-center-v10/);
  assert.match(ui, /proof-history-dialog-v10/);
  assert.match(ui, /\/api\/proof\/history/);
  assert.doesNotMatch(ui, /setInterval\s*\(/);
  assert.match(control, /const PROOF_REFRESH_MS = 60_000/);
});

test('Proof history is on-demand read-only and reuses existing logs', async () => {
  const history = await read('worker/src/proof-history-v10.js');
  assert.match(history, /ms_proof_print_log/);
  assert.match(history, /ms_proof_events/);
  assert.match(history, /historyWrites: 0/);
  assert.match(history, /pollingAdded: false/);
  assert.doesNotMatch(history, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('Proof plate recovery stays explicit and no release-passed create is allowed', async () => {
  const plate = await read('worker/src/proof-plate-search-v5.js');
  const editor = await read('worker/src/proof-editor.js');
  const control = await read('worker/src/proof-control.js');
  assert.match(plate, /PROOF_PLATE_SEARCH_RECOVERY_V10/);
  assert.match(plate, /plateNumber:''/);
  assert.match(plate, /pageSize:'100'/);
  assert.match(editor, /MS_PROOF_RELEASE_PASSED/);
  assert.match(editor, /PROOF_RELEASE_GUARD_V10/);
  assert.match(control, /MS_PROOF_RELEASE_PASSED/);
  assert.doesNotMatch(editor, /cancel_car/);
});
