import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath}from'node:url';
import{sha,loadIdentity,loadSelectedIdentity,verifySource,verifyArtifacts,assertDispatch,verifyLiveBytes,inventory,verifyServedProjection}from'./verify-wtr009-dev-identity.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));const manifest=path.join(root,'.github/dev-tools/wtr009-dev-identity.json'),pin=sha(fs.readFileSync(manifest)),r=loadSelectedIdentity(root);const candidate=process.env.WTR_DEV_IDENTITY_KIND==='candidate';
const assets=process.env.WTR_IDENTITY_ASSETS||path.join(root,'worker/.dev-assets'),runtime=process.env.WTR_IDENTITY_RUNTIME||path.join(root,'worker/.dev-runtime/src');
test('owner-pinned manifest and exact final source inventory',()=>{assert.equal(verifySource(root,r).files,r.sourceCount-1);assert.equal(r.status,'LOCAL_SOURCE_REVIEW_ONLY_NOT_RELEASE_APPROVAL');});
test('missing or fake descriptor pin rejects JSON claims',()=>{for(const p of ['',undefined,'0'.repeat(64)])assert.throws(()=>loadIdentity(root,p),/IDENTITY_/);});
test('actual staged28 assets/runtime27 all bytes and version match',async()=>{const x=verifyArtifacts(assets,runtime,r);assert.equal(x.assets.files,28);assert.equal(x.runtime.files,27);const served=await verifyServedProjection(assets,runtime,r);assert.equal(sha(served),r.servedMs.sha256);await assert.rejects(()=>verifyServedProjection(assets,runtime,{...r,servedMs:{...r.servedMs,sha256:"0".repeat(64)}}),/SERVED_PROJECTION/);});
test('local qualification is not Node22 authorization',()=>{const env={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/'+r.branch,GITHUB_SHA:'a'.repeat(40),WTR_APPROVED_SOURCE_SHA:'a'.repeat(40),WTR_ACTUAL_NODE_VERSION:'22.16.0'};assert.doesNotThrow(()=>assertDispatch(env,r));for(const p of [{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/main'},{WTR_APPROVED_SOURCE_SHA:''},{WTR_APPROVED_SOURCE_SHA:'b'.repeat(40)},{WTR_ACTUAL_NODE_VERSION:'24.22.1'}])assert.throws(()=>assertDispatch({...env,...p},r),/IDENTITY_/);});
test('actual ms/html/SW live-byte verifier rejects every mismatched member',async()=>{const buffers=[await verifyServedProjection(assets,runtime,r),...['ms.html','sw.js'].map(n=>fs.readFileSync(path.join(assets,n)))];assert.equal(verifyLiveBytes(...buffers,r),true);for(let i=0;i<3;i++){const b=buffers.slice();b[i]=Buffer.concat([b[i],Buffer.from('\n// wrong bytes')]);assert.throws(()=>verifyLiveBytes(...b,r),/LIVE_/);}});
test('file integrity rejects changed content, additional files, missing file and symlink input',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'wtr009-identity-negative-'));try{const p=path.join(d,'f');fs.writeFileSync(p,'verified');const m={f:{sha256:sha('verified'),size:8}};assert.equal(inventory(d,m).files,1);fs.writeFileSync(p,'forged!!');assert.throws(()=>inventory(d,m),/CONTENT/);fs.writeFileSync(p,'verified');fs.writeFileSync(path.join(d,'extra'),'x');assert.throws(()=>inventory(d,m),/EXACT_FILE_SET/);fs.unlinkSync(path.join(d,'extra'));fs.unlinkSync(p);assert.throws(()=>inventory(d,m),/EXACT_FILE_SET/);fs.symlinkSync(manifest,p);assert.throws(()=>inventory(d,m),/SYMLINK/);}finally{fs.rmSync(d,{recursive:true,force:true});}});
test('exact executable manual workflow uses source guard, full staged and live operands, preserves npm check and dispatch deployment guard',()=>{const s=fs.readFileSync(path.join(root,'.github/workflows/deploy-worker-dev.yml'),'utf8');assert.match(s,/guard\.assertDispatch\(/);assert.match(s,/guard\.verifySource\(/);assert.match(s,/verifyArtifacts\('\.dev-assets','\.dev-runtime\/src',identity\)/);assert.match(s,/identity\.servedMs\.sha256/);assert.match(s,/identity\.assets\['ms\.html'\]\.sha256/);assert.match(s,/identity\.assets\['sw\.js'\]\.sha256/);assert.match(s,/- run: npm run check/);assert.match(s,/launch_sealed_publisher publish/);assert.match(s,/wtr011p-sealed-publisher\.mjs/);assert.match(s,/Publisher launcher bytes mismatch/);assert.doesNotMatch(s,/run: npx wrangler deploy /);assert.doesNotMatch(s,/continue-on-error/);assert.doesNotMatch(s,/7866a1b31de1f6bce79e24a488a0a0fe1fc25c9efe3eb4ae9f889d37cc351ea4/);});

test('actual executable smoke selects externally pinned identity from repository root',()=>{
 const w=fs.readFileSync(path.join(root,'.github/workflows/deploy-worker-dev.yml'),'utf8');
 const begin=w.indexOf('      - name: Smoke DEV public pages and MS UI v4');
 const end=w.indexOf('      - name: Collect sanitized DEV acceptance',begin);
 assert.ok(begin>0&&end>begin);
 const step=w.slice(begin,end);
 assert.match(step,/working-directory: \.(?:\r?\n)/);
 assert.match(step,/const identity=loadSelectedIdentity\(process\.cwd\(\)\)/);
 assert.deepEqual(loadSelectedIdentity(root),r);
});
if(candidate){
 test('candidate cannot be loaded with missing, fake or wrong-mode external pin',()=>{
  for(const p of [undefined,'','0'.repeat(64)])assert.throws(()=>loadSelectedIdentity(root,{WTR_DEV_IDENTITY_KIND:'candidate',WTR_APPROVED_IDENTITY_SHA256:p}),/EXTERNAL_PIN_REQUIRED|DESCRIPTOR_HASH/);
  assert.throws(()=>loadSelectedIdentity(root,{}),/CANDIDATE_MODE_REQUIRED/);
  assert.throws(()=>loadSelectedIdentity(root,{WTR_DEV_IDENTITY_KIND:'../candidate',WTR_APPROVED_IDENTITY_SHA256:process.env.WTR_APPROVED_IDENTITY_SHA256}),/IDENTITY_KIND/);
 });
 test('candidate preserves Golden untouched and rejects Golden staged mismatch',async()=>{
  const golden=loadIdentity(root,'7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30');
  assert.equal(sha(fs.readFileSync(manifest)),'7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30');
  assert.throws(()=>verifyArtifacts(assets,runtime,golden),/IDENTITY_CONTENT:ms.js/);
  await assert.rejects(verifyServedProjection(assets,runtime,golden),/RAW_MS_HASH/);
 });
}
