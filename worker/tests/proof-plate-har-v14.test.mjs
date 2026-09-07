import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/proof-plate-search-v5.js', import.meta.url), 'utf8');

test('plate search starts with the exact MS HAR car/info contract', () => {
  assert.match(source, /PROOF_PLATE_HAR_EXACT_V14/);
  assert.match(source, /fetchPlateSearch\(credentials,primary,\{fleetId,plateNumber:variant,pageSize:'20',pageNum:'1',plateType:requiredType\}\)/);
});

test('plate search remains explicit-search only and has no background timer', () => {
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.match(source, /if \(q\.length < 2\)/);
});
