import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/proof-ui-v16.js', import.meta.url), 'utf8');

test('Proof V16 quick-day navigator is compact, segmented and stays with the date input', () => {
  assert.match(source, /proof-day-row-v16/);
  assert.match(source, /dayRow\.appendChild\(dayInput\)/);
  assert.match(source, /dayRow\.appendChild\(quick\)/);
  assert.match(source, /grid-template-columns:minmax\(0,1\.08fr\) minmax\(150px,\.92fr\)/);
  assert.match(source, /proof-quick-day-v16\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:0/);
  assert.match(source, /aria-current/);
  assert.doesNotMatch(source, /proof-day-caption-v16|shortDay\s*=/);
});
