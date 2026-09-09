import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchDevMsMobileStyle } from '../../worker/scripts/patch-dev-ms-archive.mjs';

const read = path => readFileSync(path, 'utf8');

function tailFrom(text, marker) {
  const index = text.lastIndexOf(marker);
  assert.ok(index >= 0, `missing marker ${marker}`);
  return text.slice(index);
}

test('shared DEV mobile shell v7 fixes dropdown anchoring, contrast and utility wrapping', () => {
  const source = read('style.css');
  const patched = patchDevMsMobileStyle(source);
  const shell = tailFrom(patched, '/* DEV mobile unified shell v7 */');

  assert.match(shell, /\.dev-unified-header \.app-nav \{ position:static !important;/);
  assert.match(shell, /\.dev-unified-header \.app-nav-menu \{ position:absolute !important;/);
  assert.match(shell, /top:calc\(100% \+ 6px\) !important/);
  assert.doesNotMatch(shell, /position:fixed/);
  assert.match(shell, /\.app-nav-menu a>b \{ color:#fff !important; opacity:1 !important;/);
  assert.match(shell, /\.app-nav-menu a>small \{ color:#d9dde0 !important; opacity:1 !important;/);
  assert.match(shell, /max-height:calc\(100dvh - 235px\) !important/);
  assert.match(shell, /\.dev-shell-status>\.badge \{[^}]*min-height:44px !important;[^}]*white-space:nowrap !important;/s);
  assert.match(shell, /\.dev-shell-refresh>\.btn \{[^}]*min-width:104px !important;[^}]*min-height:44px !important;[^}]*white-space:nowrap !important;/s);
  assert.equal(patchDevMsMobileStyle(patched), patched, 'mobile style staging must stay idempotent');
});

test('central admin management entry exists on every user page and stays role-gated', () => {
  const ms = read('ms.js');
  const waiting = read('main.js');
  const proof = read('proof-v2-core.js');
  const report = read('ms-report.js');

  assert.ok(ms.includes('central-settings-btn'));
  assert.ok(ms.includes('state.auth?.role !== "admin"'));
  assert.ok(waiting.includes('settings-btn'));
  assert.ok(waiting.includes('state.auth?.role !== "admin"'));

  const proofAdmin = tailFrom(proof, ";(()=>{const KEY='bnak_operator_auth_v2'");
  assert.ok(proofAdmin.includes("link.href='waiting.html#settings'"));
  assert.ok(proofAdmin.includes("read()?.role!=='admin'"));
  assert.doesNotMatch(proofAdmin, /\bfetch\b|\bsetInterval\b|\bsetTimeout\b/);

  const reportAdmin = tailFrom(report, ";(()=>{const read=()=>");
  assert.ok(reportAdmin.includes("link.href='waiting.html#settings'"));
  assert.ok(reportAdmin.includes("read()?.role!=='admin'"));
  assert.doesNotMatch(reportAdmin, /\bfetch\b|\bsetInterval\b|\bsetTimeout\b/);
});

test('admin entry additions preserve shared auth and do not add MS mutations', () => {
  const proof = read('proof-v2-core.js');
  const report = read('ms-report.js');
  assert.ok(proof.includes("P.AUTH_KEY='bnak_operator_auth_v2'"));
  assert.ok(report.includes('AUTH_KEY="bnak_operator_auth_v2"'));
  assert.ok(proof.includes("P.CONFIG={apiBase:"));
  assert.ok(report.includes('async function api(action,params={})'));
  for (const text of [tailFrom(proof, ";(()=>{const KEY='bnak_operator_auth_v2'"), tailFrom(report, ";(()=>{const read=()=>")]) {
    assert.doesNotMatch(text, /method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/i);
    assert.doesNotMatch(text, /cancel_car|proof\/print|proof\/ack/i);
  }
});

test('live smoke discovers an ephemeral CDP endpoint and always cleans failed launches', () => {
  const smoke = read('.github/dev-tools/ms-mobile-shell-live-smoke.mjs');
  assert.match(smoke, /'--remote-debugging-port=0'/);
  assert.ok(smoke.includes('DevTools listening on (ws:\\/\\/\\S+)'));
  assert.match(smoke, /child\.kill\('SIGTERM'\)/);
  assert.match(smoke, /await rm\(profile,\{recursive:true,force:true\}\)/);
  assert.doesNotMatch(smoke, /const port=9343/);
});
