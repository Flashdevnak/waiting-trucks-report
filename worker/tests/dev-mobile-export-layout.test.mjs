import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { patchMsSummaryPerformanceStyle } from '../../.github/dev-tools/patch-ms-summary-performance.mjs';

const stylePath = fileURLToPath(new URL('../../style.css', import.meta.url));
const source = readFileSync(stylePath, 'utf8');

test('mobile export controls collapse to one safe column at 520px and below', () => {
  const patched = patchMsSummaryPerformanceStyle(source);
  const marker = '/* MS mobile export single-column v2 */';
  const index = patched.lastIndexOf(marker);

  assert.ok(index >= 0, 'mobile export marker missing');
  const tail = patched.slice(index);
  assert.match(tail, /@media \(max-width:520px\)/);
  assert.match(tail, /\.ms-page \.ms-export-actions\{[^}]*display:grid!important;[^}]*grid-template-columns:minmax\(0,1fr\)!important;[^}]*width:100%!important/s);
  assert.match(tail, /\.ms-page \.ms-export-actions \.btn\{[^}]*width:100%!important;[^}]*min-width:0!important;[^}]*max-width:100%!important;[^}]*white-space:normal!important/s);
  assert.ok(index > patched.lastIndexOf('/* MS summary performance */'), 'mobile export override must be later in cascade');
  assert.equal(patchMsSummaryPerformanceStyle(patched), patched, 'mobile export style patch must remain idempotent');
});
