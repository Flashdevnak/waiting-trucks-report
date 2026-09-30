import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchDevRealtimeWorker } from '../../.github/dev-tools/patch-ms-realtime-recovery.mjs';
import { stageFrontend, stageWorker } from '../../.github/dev-tools/stage-dev-runtime.mjs';
const ui = fs.readFileSync(new URL('../../ms.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
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
  assert.ok(staged.includes('errorCode: errorCode || "MS_NETWORK_ERROR"'));
  assert.ok(staged.includes('MS ตอบช้าชั่วคราว ระบบแสดงข้อมูลล่าสุดและจะลองใหม่อัตโนมัติ'));
});
test('downstream TBR stage composes with recovery stage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ms-session-stage-'));
  const target = join(dir, 'index.js');
  try {
    await writeFile(target, stageWorker(worker));
    for (const patch of ['patch-dev-tbr-shadow-readonly.mjs', 'patch-dev-tbr-shadow-split-v2.mjs']) {
      execFileSync(process.execPath, [fileURLToPath(new URL(`../../cloudflare-browser-test/scripts/${patch}`, import.meta.url)), target]);
    }
    const staged = await readFile(target, 'utf8');
    assert.ok(staged.includes('errorCode === "MS_SESSION_EXPIRED"'));
    assert.ok(staged.includes('return { code: "MS_SESSION_HTTP_401"'));
    assert.ok(staged.includes('syncedAt: fallback.syncedAt || ""'));
    assert.ok(staged.includes('errorCode: errorCode || "MS_NETWORK_ERROR"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('realtime cadence remains 4000ms', () => {
  assert.ok(ui.includes('pollMs: 4000'));
  assert.ok(ui.includes('setInterval(realtimeTick, CONFIG.pollMs)'));
});
