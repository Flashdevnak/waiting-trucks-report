import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  applyDevProofServiceDate,
  normalizeProofServiceDate,
  patchDevProofCoreServiceDate,
  patchDevProofHtmlServiceDate,
} from '../src/proof-service-date-dev.js';

const proofHtml = await fs.readFile(new URL('../../proof.html', import.meta.url), 'utf8');
const proofCore = await fs.readFile(new URL('../../proof-v2-core.js', import.meta.url), 'utf8');
const proofLive = await fs.readFile(new URL('../src/proof-live-v2.js', import.meta.url), 'utf8');
const proofControl = await fs.readFile(new URL('../src/proof-control.js', import.meta.url), 'utf8');

test('DEV Proof service date validates exact calendar days without rewriting valid prior days', () => {
  assert.equal(normalizeProofServiceDate('2026-09-07'), '2026-09-07');
  assert.equal(normalizeProofServiceDate('2026-09-06'), '2026-09-06');
  assert.equal(normalizeProofServiceDate(' 2026-09-06 '), '2026-09-06');
  assert.equal(normalizeProofServiceDate('2026-02-30'), '');
  assert.equal(normalizeProofServiceDate('2026-13-01'), '');
  assert.equal(normalizeProofServiceDate('09/06/2026'), '');
});

test('DEV Proof HTML preserves ?date= so the initial request cannot silently fall back to today', () => {
  const staged = patchDevProofHtmlServiceDate(proofHtml);
  assert.match(staged, /DEV_PROOF_SERVICE_DATE_HTML_V1/);
  assert.doesNotMatch(staged, /if\(location\.search\)history\.replaceState/);
  assert.equal(patchDevProofHtmlServiceDate(staged), staged);
});

test('DEV Proof core consumes explicit ?date= before bootstrap and does not add a second live refresh', () => {
  const staged = patchDevProofCoreServiceDate(proofCore);
  assert.match(staged, /DEV_PROOF_SERVICE_DATE_CORE_V1/);
  assert.match(staged, /new URLSearchParams\(location\.search\)\.get\('date'\)/);
  assert.match(staged, /P\.state\.day=P\.requestedServiceDay\(\)\|\|P\.thaiDay\(\)/);
  assert.doesNotMatch(staged, /P\.state\.day=P\.thaiDay\(\);/);
  assert.match(staged, /\/api\/proof\/routes-v2',\{token:s\.auth\.token,branch:s\.branch,day:s\.day\}/);
  assert.equal((staged.match(/P\.loadAll\(false\)/g) || []).length, (proofCore.match(/P\.loadAll\(false\)/g) || []).length);
  assert.equal(patchDevProofCoreServiceDate(staged), staged);
});

test('DEV response transform is scoped to Proof HTML/core GET assets only', async () => {
  const htmlRequest = new Request('https://dev.test/proof.html?date=2026-09-06');
  const htmlResponse = await applyDevProofServiceDate(
    htmlRequest,
    new Response(proofHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  );
  assert.match(await htmlResponse.text(), /DEV_PROOF_SERVICE_DATE_HTML_V1/);
  assert.equal(htmlResponse.headers.get('cache-control'), 'no-store');

  const coreRequest = new Request('https://dev.test/proof-v2-core.js');
  const coreResponse = await applyDevProofServiceDate(
    coreRequest,
    new Response(proofCore, { status: 200, headers: { 'Content-Type': 'application/javascript' } }),
  );
  assert.match(await coreResponse.text(), /DEV_PROOF_SERVICE_DATE_CORE_V1/);

  const untouched = new Response('ok', { status: 200 });
  assert.equal(await applyDevProofServiceDate(new Request('https://dev.test/ms.html'), untouched), untouched);
});

test('Proof date stays exact through V2, legacy control and the MS startDate query', () => {
  assert.match(proofLive, /const day=cleanDay\(url\.searchParams\.get\('day'\)\)\|\|thaiDay\(\)/);
  assert.match(proofLive, /legacyUrl\.searchParams\.set\('day',day\)/);
  assert.match(proofControl, /const day = cleanDay\(url\.searchParams\.get\('day'\)\) \|\| thaiDay\(\)/);
  assert.match(proofControl, /await syncProofDay\(env, branch, day, false\)/);
  assert.match(proofControl, /const upstream = await readProofTasks\(credentials, day\)/);
  assert.match(proofControl, /startDate: day/);
});
