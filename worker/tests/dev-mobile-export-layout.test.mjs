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

test('Proof V16 mobile toolbar cannot create implicit overflow tracks', () => {
  const patched = patchMsSummaryPerformanceStyle(source);
  const marker = '/* Proof V16 mobile toolbar containment v2 */';
  const index = patched.lastIndexOf(marker);

  assert.ok(index >= 0, 'Proof mobile toolbar marker missing');
  const tail = patched.slice(index);
  assert.match(tail, /@media \(max-width:760px\)/);
  assert.match(tail, /body\.proof-page \.proof-toolbar-v16\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)!important;[^}]*grid-auto-columns:minmax\(0,1fr\)!important;[^}]*min-width:0!important;[^}]*max-width:100%!important/s);
  assert.match(tail, /body\.proof-page \.proof-toolbar-v16>label,[^\{]*#clear-filter-btn\{[^}]*min-width:0!important;[^}]*width:100%!important;[^}]*grid-column:auto!important/s);
  assert.match(tail, /body\.proof-page \.proof-toolbar-v16>\.proof-search,[^\{]*\.proof-search-field-v16\{grid-column:1\/-1!important\}/);
  assert.match(tail, /@media \(max-width:430px\)\{body\.proof-page \.proof-toolbar-v16\{[^}]*grid-template-columns:minmax\(0,1fr\)!important/s);
  assert.equal(patchMsSummaryPerformanceStyle(patched), patched, 'Proof toolbar containment patch must remain idempotent');
});

test('Proof mobile dropdown has one full-header containing block and stays viewport bounded', () => {
  const patched = patchMsSummaryPerformanceStyle(source);
  const marker = '/* Proof mobile header dropdown anchor v2 */';
  const index = patched.lastIndexOf(marker);

  assert.ok(index >= 0, 'Proof mobile header marker missing');
  const tail = patched.slice(index);
  assert.match(tail, /@media \(max-width:700px\)/);
  assert.match(tail, /body\.proof-page \.dev-unified-header\{[^}]*position:relative!important;[^}]*overflow:visible!important/s);
  assert.match(tail, /body\.proof-page \.dev-unified-header \.site-header-inner,body\.proof-page \.dev-unified-header \.dev-unified-actions,body\.proof-page \.dev-unified-header \.dev-shell-slot,body\.proof-page \.dev-unified-header \.app-nav\{position:static!important\}/);
  assert.match(tail, /body\.proof-page \.dev-unified-header \.app-nav\{[^}]*width:100%!important;[^}]*min-width:0!important/s);
  assert.match(tail, /body\.proof-page \.dev-unified-header \.app-nav-menu\{[^}]*position:absolute!important;[^}]*left:10px!important;[^}]*right:10px!important;[^}]*top:calc\(100% \+ 6px\)!important;[^}]*width:auto!important;[^}]*max-height:calc\(100dvh - 235px\)!important;[^}]*overflow-y:auto!important/s);
  assert.equal(patchMsSummaryPerformanceStyle(patched), patched, 'Proof header dropdown patch must remain idempotent');
});
