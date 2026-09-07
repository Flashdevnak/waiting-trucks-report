import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/turso-index.js', import.meta.url), 'utf8');

test('DEV tablet shell keeps export controls and shared dropdowns inside 701-900px viewport', () => {
  assert.match(source, /DEV_TABLET_SHELL_CONTAINMENT_V1/);
  assert.match(source, /@media \(min-width:701px\) and \(max-width:900px\)/);
  assert.match(source, /ms-export-actions[^`]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(source, /ms-export-actions \.btn[^`]*min-width:0[^`]*white-space:normal/s);
  assert.match(source, /dev-unified-header \.app-nav-menu[^`]*left:12px[^`]*right:12px/s);
  assert.match(source, /url\.pathname === '\/style\.css'/);
  assert.match(source, /Cache-Control', 'no-store'/);
});

test('DEV tablet shell patch stays frontend-only and V17 remains absent', () => {
  assert.doesNotMatch(source, /d1_databases|proof-v17|maybeHandleProofUiV17/i);
  assert.doesNotMatch(source, /cancel_car|DELETE\b/);
});
