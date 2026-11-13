// WTR009 DEV identity guard. Owner-dispatched hash is authority; JSON PASS is never test evidence.
// File checks do not solve same-UID parent relocation (I03); not an output publication broker.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function demand(ok,why){if(!ok)throw Error('WTR009_IDENTITY_'+why);}
export function bytes(file){
 const p=path.resolve(file);for(let q=p;;q=path.dirname(q)){demand(!fs.lstatSync(q).isSymbolicLink(),'SYMLINK');if(q===path.dirname(q))break;}
 const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(fd);demand(before.isFile(),'REGULAR_FILE');const b=fs.readFileSync(fd),after=fs.fstatSync(fd);demand(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&b.length===before.size,'CHANGED_DURING_READ');return b;}finally{fs.closeSync(fd);}
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
