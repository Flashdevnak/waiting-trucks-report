import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchDevRealtimeWorker } from '../../.github/dev-tools/patch-ms-realtime-recovery.mjs';
import { stageFrontend } from '../../.github/dev-tools/stage-dev-runtime.mjs';
const ui = fs.readFileSync(new URL('../../ms.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const tbr = fs.readFileSync(new URL('../../cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs', import.meta.url), 'utf8');
test('freshness truth uses transport health, not source timestamp age', () => {
  const block = ui.slice(ui.indexOf('// MS_FRESHNESS_TRUTH_V1'), ui.indexOf('function connection('));
  assert.ok(block.includes('state.transportLastOkAt'));
  assert.ok(block.includes('status === "synced"'));
  assert.equal(block.includes('เซสชันยังไม่อัปเดต'), false);
});
test('frontend staging is idempotent', () => {
  const staged = stageFrontend(ui);
  assert.equal((staged.match(/MS_FRESHNESS_TRUTH_V1/g) || []).length, 1);
  assert.equal(staged.includes('เซสชันยังไม่อัปเดต'), false);
});
test('recovery fallback keeps accepted timestamp and real session message', () => {
  const staged = patchDevRealtimeWorker(worker);
  assert.ok(staged.includes('const transient ='));
  assert.ok(staged.includes('syncedAt: fallback.syncedAt || ""'));
  assert.ok(staged.includes('error?.code === "MS_SESSION_EXPIRED"'));
  assert.ok(staged.includes('เซสชัน MS ต้องอัปเดต · ระบบยังแสดงข้อมูลล่าสุด'));
});
test('downstream TBR stage composes with recovery stage', () => {
  assert.ok(tbr.includes('error?.code === \\"MS_SESSION_EXPIRED\\" ||'));
  assert.ok(tbr.includes('syncedAt: fallback.syncedAt || \\"\\"'));
  assert.ok(tbr.includes('errorCode: error?.code || \\"MS_NETWORK_ERROR\\"'));
});
test('realtime cadence remains 4000ms', () => {
  assert.ok(ui.includes('pollMs: 4000'));
  assert.ok(ui.includes('setInterval(realtimeTick, CONFIG.pollMs)'));
});
