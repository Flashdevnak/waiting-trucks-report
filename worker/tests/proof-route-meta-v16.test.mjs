import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { applyMetaV16, metaCandidatesV16 } from '../src/proof-route-meta-v16.js';

const source = await fs.readFile(new URL('../src/proof-route-meta-v16.js', import.meta.url), 'utf8');

test('Proof V16 supplier prewarm is shared, daily cached, leased, and background bounded', () => {
  assert.match(source, /META_TTL_MS = 24 \* 60 \* 60_000/);
  assert.match(source, /META_SYNC_BATCH = 12/);
  assert.match(source, /META_BACKGROUND_BATCH = 240/);
  assert.match(source, /META_CONCURRENCY = 6/);
  assert.match(source, /META_LEASE_MS = 120_000/);
  assert.match(source, /ctx\?\.waitUntil/);
  assert.match(source, /ms_proof_meta_lease_v15/);
  assert.match(source, /\/gw\/nws\/staff\/ms\/fleet\/van\/proof\/popup/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('Proof V16 hydrates only active printable routes and keeps cache for one business day', () => {
  const now = Date.now();
  const rows = [
    { lineId:'A', proofState:1 },
    { lineId:'B', proofState:2 },
    { lineId:'C', proofState:7 },
    { lineId:'D', proofState:3 },
  ];
  assert.deepEqual(metaCandidatesV16(rows, new Map(), now).map(row => row.lineId), ['A','B','C']);
  const fresh = new Map([['A',{fleetName:'2KL',checkedAt:new Date(now - 23 * 60 * 60_000).toISOString()}]]);
  assert.equal(metaCandidatesV16([{lineId:'A',proofState:1}], fresh, now).length, 0);
  const stale = new Map([['A',{fleetName:'2KL',checkedAt:new Date(now - 25 * 60 * 60_000).toISOString()}]]);
  assert.equal(metaCandidatesV16([{lineId:'A',proofState:1}], stale, now).length, 1);
});

test('Proof V16 applies supplier cache without erasing list values with blanks', () => {
  const rows = [{ lineId:'A', proofState:1, fleetName:'เดิม' }, { lineId:'B', proofState:1 }];
  const cache = new Map([
    ['A',{fleetId:'',fleetName:'',checkedAt:'2026-09-07T00:00:00.000Z'}],
    ['B',{fleetId:'37',fleetName:'AMR (AMARA)',checkedAt:'2026-09-07T00:00:00.000Z'}],
  ]);
  applyMetaV16(rows, cache);
  assert.equal(rows[0].fleetName, 'เดิม');
  assert.equal(rows[1].fleetId, '37');
  assert.equal(rows[1].fleetName, 'AMR (AMARA)');
});

test('Proof V16 captures editor supplier metadata into the same shared cache', () => {
  assert.match(source, /captureProofEditorMetaV16/);
  assert.match(source, /url\.pathname !== '\/api\/proof\/editor'/);
  assert.match(source, /upsertMeta\(env, hub, day/);
});
