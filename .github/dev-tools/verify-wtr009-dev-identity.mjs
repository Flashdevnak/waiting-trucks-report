// WTR009 DEV identity guard. Owner-dispatched hash is authority; JSON PASS is never test evidence.
// File checks do not solve same-UID parent relocation (I03); not an output publication broker.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function demand(ok,why){if(!ok)throw Error('WTR009_IDENTITY_'+why);}
export function bytes(file){
 const p=path.resolve(file);for(let q=p;;q=path.dirname(q)){demand(!fs.lstatSync(q).isSymbolicLink(),'SYMLINK');if(q===path.dirname(q))break;}
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(fd);demand(before.isFile()&&before.nlink===1,'REGULAR_FILE_HARDLINK');const b=fs.readFileSync(fd),after=fs.fstatSync(fd);demand(after.nlink===1&&before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&b.length===before.size,'CHANGED_DURING_READ');return b;}finally{fs.closeSync(fd);}
}
function entries(dir,ignore=[]){const out=[];function visit(rel){for(const e of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){const n=rel?rel+'/'+e.name:e.name;if(ignore.some(x=>n===x||n.startsWith(x+'/')))continue;demand(!e.isSymbolicLink(),'SYMLINK');if(e.isDirectory())visit(n);else{demand(e.isFile(),'REGULAR_FILE');out.push(n);}}}visit('');return out.sort();}
export function inventory(root,files,ignore=[]){
 const names=Object.keys(files).sort();demand(JSON.stringify(entries(root,ignore))===JSON.stringify(names),'EXACT_FILE_SET');
 for(const n of names){demand(n&&!path.isAbsolute(n)&&!n.split('/').includes('..')&&!n.includes('\\'),'UNSAFE_PATH');const b=bytes(path.join(root,n));demand(b.length===files[n].size&&sha(b)===files[n].sha256,'CONTENT:'+n);}
 return {files:names.length,tree:sha(names.map(n=>n+'\0'+files[n].sha256+'\n').join(''))};
}
export function loadIdentity(root,pin){
 demand(typeof pin==='string'&&/^[a-f0-9]{64}$/.test(pin),'EXTERNAL_PIN_REQUIRED');const p=path.join(root,'.github/dev-tools/wtr009-dev-identity.json'),raw=bytes(p);demand(sha(raw)===pin,'DESCRIPTOR_HASH');const r=JSON.parse(raw);demand(r.version==='WTR009_DEV002_IDENTITY_V1'&&r.worker==='waiting-trucks-report-api-dev'&&r.branch==='codex/dev-recovery-contract-v2','SCOPE');return r;
}
export function verifySource(root,r){
 const ignored=['.git','worker/node_modules','worker/.dev-assets','worker/.dev-runtime',r.manifestPath];
 demand(JSON.stringify(r.sourceIgnored)===JSON.stringify(ignored),'IGNORE_POLICY');const check=inventory(root,r.source,ignored);demand(check.files+1===r.sourceCount,'SOURCE_COUNT');return check;
}
export function verifyArtifacts(assets,runtime,r){
 demand(Object.keys(r.assets).length===28&&Object.keys(r.runtime).length===27,'ARTIFACT_COUNTS');
 const a=inventory(assets,r.assets),b=inventory(runtime,r.runtime);
 demand(a.tree===r.assetTree&&b.tree===r.runtimeTree,'TREE_HASH');
 const origin=bytes(path.join(runtime,'origin-manifest-v1.js')).toString();demand(origin.includes('DEV_ORIGIN_MANIFEST_SESSION_REPLAY_V2')&&origin.includes('if (credentials.authorization) requestHeaders.Authorization = credentials.authorization;')&&origin.includes('if (credentials.cookie) requestHeaders.Cookie = credentials.cookie;'),'WORKER_SESSION_REPLAY');
 const html=bytes(path.join(assets,'ms.html')).toString(),sw=bytes(path.join(assets,'sw.js')).toString();
 const scripts=[...html.matchAll(/src=["'](ms\.js[^"']*)["']/g)].map(x=>x[1]);demand(JSON.stringify(scripts)===JSON.stringify([r.scriptUrl]),'SCRIPT_URL');demand(sw.includes('const VERSION = "'+r.cacheVersion+'";'),'SW_VERSION');return {assets:a,runtime:b};
}
export function assertDispatch(env,r){
 demand(env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REF==='refs/heads/'+r.branch,'DISPATCH_REF');demand(/^[a-f0-9]{40}$/.test(env.WTR_APPROVED_SOURCE_SHA||'')&&env.GITHUB_SHA===env.WTR_APPROVED_SOURCE_SHA,'APPROVED_COMMIT');demand(/^22\./.test(env.WTR_ACTUAL_NODE_VERSION||''),'NODE22_REQUIRED');
}
export function verifyLiveBytes(ms,html,sw,r){
 demand(sha(ms)===r.servedMs.sha256,'LIVE_MS_HASH');demand(sha(html)===r.assets['ms.html'].sha256,'LIVE_HTML_HASH');demand(sha(sw)===r.assets['sw.js'].sha256,'LIVE_SW_HASH');return true;
}
// Exact served projection from the unchanged, manifest-pinned Worker transform.
// Separate raw input identity and derived output identity; never substitute an observed Live hash.
export async function verifyServedProjection(assets,runtime,r){
 const raw=bytes(path.join(assets,'ms.js')),code=bytes(path.join(runtime,'origin-manifest-v1.js'));
 demand(sha(raw)===r.assets['ms.js'].sha256,'RAW_MS_HASH');
 demand(sha(code)===r.runtime['origin-manifest-v1.js'].sha256&&sha(code)===r.servedMs.runtimeModuleSHA256,'TRANSFORM_HASH');
 const captured=await import('data:text/javascript;base64,'+code.toString('base64'));
 const response=await captured.appendOriginManifestFrontend(new Response(raw));
 const out=Buffer.from(await response.arrayBuffer());demand(sha(out)===r.servedMs.sha256&&out.length===r.servedMs.size,'SERVED_PROJECTION');return out;
}


// WTR-011P: candidate opt-in requires an external owner pin. The Golden verifier
// keeps its original fixed path/meaning and its manifest bytes never change.
export function loadSelectedIdentity(root,env=process.env){
 const kind=env.WTR_DEV_IDENTITY_KIND||'golden';
 demand(kind==='golden'||kind==='candidate','IDENTITY_KIND');
 const goldenPin='7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30';
 const golden=loadIdentity(root,goldenPin);
 const candidatePath='.github/dev-tools/wtr011p-dev-candidate-identity.json';
 if(kind==='golden'){
  demand(!fs.existsSync(path.join(root,candidatePath)),'CANDIDATE_MODE_REQUIRED');
  return loadIdentity(root,env.WTR_APPROVED_IDENTITY_SHA256||goldenPin);
 }
 const pin=env.WTR_APPROVED_IDENTITY_SHA256;
 demand(typeof pin==='string'&&/^[a-f0-9]{64}$/.test(pin),'EXTERNAL_PIN_REQUIRED');
 const raw=bytes(path.join(root,candidatePath));
 demand(sha(raw)===pin,'DESCRIPTOR_HASH');
 const r=JSON.parse(raw);
 demand(r.version==='WTR011P_H_ONLY_DEV_CANDIDATE_V1'&&r.status==='LOCAL_SOURCE_REVIEW_ONLY_NOT_RELEASE_APPROVAL','CANDIDATE_VERSION');
 demand(r.manifestPath===candidatePath&&r.baseCommit==='e6fe36b01b34866f6f90294df572f0dd015913d5'
   &&r.worker===golden.worker&&r.branch===golden.branch&&r.goldenSha256===goldenPin,'CANDIDATE_SCOPE');
 const goldenRaw=bytes(path.join(root,'.github/dev-tools/wtr009-dev-identity.json'));
 demand(r.source['.github/dev-tools/wtr009-dev-identity.json']?.sha256===goldenPin&&r.source['.github/dev-tools/wtr009-dev-identity.json']?.size===goldenRaw.length,'CANDIDATE_GOLDEN');
 const changed=new Set([
  '.github/dev-tools/patch-ms-route-cancellation-compat.mjs',
  '.github/workflows/deploy-worker-dev.yml',
  '.github/dev-tools/verify-wtr009-dev-identity.mjs',
  '.github/dev-tools/ms-unload-completion-ui.test.mjs',
  '.github/dev-tools/pno-destination-summary-rev73.test.mjs',
  '.github/dev-tools/pno-final-contract-artifact-v3.mjs',
  '.github/dev-tools/stage-dev-runtime.test.mjs',
  '.github/dev-tools/wtr009-dev-identity.test.mjs'
 ]);
 const added=[
  '.github/dev-tools/wtr-011p-local-upload-capture.mjs',
  '.github/dev-tools/wtr011p-h-only-candidate-scope.json',
  '.github/dev-tools/wtr011p-sealed-publisher.mjs',
  '.github/dev-tools/wtr011p-dependency-trust.mjs',
  '.github/dev-tools/wtr011p-dependency-trust.test.mjs',
  '.github/workflows/wtr-011p-publisher-validation.yml',
  '.github/dev-tools/wtr009-dev-identity.json'
 ];
 const sourceSet=[...Object.keys(golden.source),...added].sort();
 demand(JSON.stringify(Object.keys(r.source).sort())===JSON.stringify(sourceSet),'CANDIDATE_SOURCE_SET');
 for(const [name,entry] of Object.entries(golden.source)){
  if(!changed.has(name))demand(JSON.stringify(r.source[name])===JSON.stringify(entry),'CANDIDATE_SOURCE:'+name);
 }
 demand(r.source['.github/dev-tools/patch-ms-route-cancellation-compat.mjs']?.sha256===
  '44c41e5b0f80bab947dec76960b36a375f95ee5e057d8f03524a0b9ba8efb338','CANDIDATE_HELPER');
 demand(JSON.stringify(r.runtime)===JSON.stringify(golden.runtime) && r.runtimeTree===golden.runtimeTree,'CANDIDATE_RUNTIME');
 demand(JSON.stringify(Object.keys(r.assets).sort())===JSON.stringify(Object.keys(golden.assets).sort()),'CANDIDATE_ASSET_SET');
 for(const [name,entry] of Object.entries(golden.assets)){
  if(name!=='ms.js')demand(JSON.stringify(r.assets[name])===JSON.stringify(entry),'CANDIDATE_ASSET:'+name);
 }
 demand(r.assets['ms.js']?.sha256==='b0351e0a2d6eb1d5392fd019ba445b65ad1aca88a5b1bf8b130818f8592faae0' &&
  r.assets['ms.js']?.size===461464 &&
  r.servedMs?.sha256==='c082cfb24d291458986d4452a9d10e63c12469dcaa681ed6656aafb24f6cae15' &&
  r.servedMs?.size===490178 &&
  r.servedMs?.transform===golden.servedMs.transform &&
  r.servedMs?.runtimeModuleSHA256===golden.servedMs.runtimeModuleSHA256,'CANDIDATE_FRONTEND');
 demand(r.scriptUrl===golden.scriptUrl && r.cacheVersion===golden.cacheVersion,'CANDIDATE_DELIVERY');
 demand(JSON.stringify(r.sourceIgnored)===JSON.stringify(['.git','worker/node_modules','worker/.dev-assets','worker/.dev-runtime',candidatePath]),'CANDIDATE_IGNORE_POLICY');
 demand(r.sourceCount===Object.keys(r.source).length+1,'CANDIDATE_COUNT');
 verifySource(root,r);
 return r;
}
