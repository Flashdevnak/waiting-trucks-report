// WTR-011P: fail-closed H-only publisher. The trusted launcher runs this as root
// solely to create a separate ROOT-OWNED immutable snapshot and drops to UID 65534
// before invoking the actual Wrangler 4.127.1. Never bypass owner identity gates.
// Assumes a trusted GitHub-hosted runner; privileged root/sudo itself is out of scope.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
const SHA = x=>crypto.createHash("sha256").update(x).digest("hex");
function fail(x){throw Error("WTR011P_PUBLISHER_"+x)}
const repo=path.resolve(process.argv[2]||".");
const mode=process.argv[3]||"inspect";
const ownerPin=process.env.WTR_APPROVED_PUBLISHER_SCOPE_SHA256;
const scopeName=".github/dev-tools/wtr011p-h-only-candidate-scope.json";
const goldenName=".github/dev-tools/wtr009-dev-identity.json";
const goldenSha="7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30";
if(!["inspect","publish"].includes(mode))fail("INVALID_MODE");
if(!/^[a-f0-9]{64}$/.test(ownerPin||""))fail("OWNER_SCOPE_PIN_REQUIRED");
if(process.platform!=="linux" || process.getuid?.()!==0)fail("ROOT_SEALED_LAUNCHER_REQUIRED");
if(process.versions.node!=="22.16.0")fail("NODE_VERSION");

function safe(base,name) {
 if(!name || name.startsWith("/") || name.includes("\\") || name.includes(":") || name.split("/").some(x=>!x||x==="."||x===".."))fail("UNSAFE_PATH:"+name);
 let cur=base;
 for(const component of name.split("/")) {
   cur=path.join(cur,component);
   const st=fs.lstatSync(cur);
   if(st.isSymbolicLink())fail("SYMLINK:"+name);
 }
 return cur;
}
function get(base,name) {
 const file=safe(base,name);
 const st=fs.lstatSync(file);
 if(!st.isFile() || st.nlink!==1)fail("NONREGULAR_OR_HARDLINK:"+name);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
   const before=fs.fstatSync(fd);
   if(!before.isFile()||before.nlink!==1)fail("CHANGED_FILE:"+name);
   const b=fs.readFileSync(fd);
   const after=fs.fstatSync(fd);
   if(before.dev!==after.dev || before.ino!==after.ino || before.size!==after.size
     || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs
     || b.length!==before.size)fail("CHANGED_DURING_READ:"+name);
   return b;
 }finally{fs.closeSync(fd)}
}
function check(data,spec,label) {
 if(!spec || data.length!==spec.size || SHA(data)!==spec.sha256)fail("HASH:"+label);
}
function paths(base) {
 const out=[];
 function walk(rel) {
  const dir=rel?safe(base,rel):base;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
   const name=rel?rel+"/"+entry.name:entry.name;
   if(entry.isSymbolicLink())fail("SYMLINK:"+name);
   if(entry.isDirectory())walk(name);
   else if(entry.isFile())out.push(name);
   else fail("NONREGULAR:"+name);
  }
 }
 walk("");
 return out.sort();
}
const scopeRaw=get(repo,scopeName);
if(SHA(scopeRaw)!==ownerPin)fail("OWNER_SCOPE_PIN_MISMATCH");
const scope=JSON.parse(scopeRaw);
const goldenRaw=get(repo,goldenName);
if(SHA(goldenRaw)!==goldenSha || scope.goldenManifestSha256!==goldenSha)fail("GOLDEN_CHANGED");
const golden=JSON.parse(goldenRaw);
if(scope.baseCommit!=="e6fe36b01b34866f6f90294df572f0dd015913d5" ||
 scope.targetBranch!=="codex/dev-recovery-contract-v2" ||
 scope.targetWorker!=="waiting-trucks-report-api-dev" ||
 scope.releaseGates.releaseApproval!==false)fail("SCOPE");
const helper=get(repo,scope.cardHelper.path);
if(SHA(helper)!==scope.cardHelper.sha256)fail("HELPER_CHANGED");
const worker=path.join(repo,"worker");
const verifiedInputs=new Map();
for(const name of ["wrangler.dev.jsonc","package-lock.json","package.json"]) {
 const data=get(worker,name);
 check(data,golden.source["worker/"+name],"SOURCE_"+name);
 verifiedInputs.set(name,data);
}
const config=JSON.parse(verifiedInputs.get("wrangler.dev.jsonc").toString("utf8"));
if(config.name!=="waiting-trucks-report-api-dev" ||
 config.main!=="src/turso-index.js" || config.assets?.directory!=="./.dev-assets" ||
 config.vars?.DB_BACKEND!=="turso" || config.d1_databases)fail("CONFIG_TARGET");
const lock=JSON.parse(verifiedInputs.get("package-lock.json").toString("utf8"));
const wrangler=JSON.parse(get(worker,"node_modules/wrangler/package.json"));
if(lock.packages?.["node_modules/wrangler"]?.version!=="4.127.1"||wrangler.version!=="4.127.1")fail("WRANGLER_VERSION");
const groups=[[".dev-assets",golden.assets],[".dev-runtime/src",golden.runtime]];
for(const [dir,expected] of groups) {
 const found=paths(path.join(worker,dir));
 if(JSON.stringify(found)!==JSON.stringify(Object.keys(expected).sort()))fail("FILESET:"+dir);
 for(const name of found) {
  const b=get(worker,dir+"/"+name);
  const pin=(dir===".dev-assets" && name==="ms.js")?{
    size:scope.stagedFrontend.size,sha256:scope.stagedFrontend.sha256
  }:expected[name];
  check(b,pin,dir+"/"+name);
  verifiedInputs.set(dir+"/"+name,b);
 }
}
console.log("WTR011P_VERIFIED_28_ASSETS_27_RUNTIME=PASS");
// Create private copy inaccessible for writing to the normal runner UID.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"wtr011p-sealed-"));
fs.chmodSync(root,0o700);
const destination=path.join(root,"worker");
fs.mkdirSync(destination,{mode:0o700});
// Publish the exact Buffers that passed verification, never a second workspace read.
const snapshot=new Map(verifiedInputs);
if(snapshot.size!==58)fail("VERIFIED_INPUT_SET_INCOMPLETE");
function write(name,b) {
 const target=path.join(destination,name),parent=path.dirname(target);
 fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const fd=fs.openSync(target,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o444);
 try{fs.writeFileSync(fd,b)}finally{fs.closeSync(fd)}
}
for(const [n,b] of snapshot)write(n,b);
// Installed npm dependencies are copied from the locked npm-ci installation.
// Symlinks may exist for npm CLI bins: resolve them and reject any escape.
const modules=path.join(worker,"node_modules");
function rejectOutsideLinks(dir) {
 const realRoot=fs.realpathSync(modules)+path.sep;
 function walk(d){
  for(const name of fs.readdirSync(d)){
   const file=path.join(d,name),st=fs.lstatSync(file);
   if(st.isSymbolicLink()){
     const real=fs.realpathSync(file);
     if(!real.startsWith(realRoot))fail("DEPENDENCY_LINK_ESCAPE");
   }else if(st.isDirectory())walk(file);
   else if(st.isFile()){if(st.nlink!==1)fail("DEPENDENCY_HARDLINK");}
   else fail("DEPENDENCY_NONREGULAR");
  }
 }
 walk(dir);
}
rejectOutsideLinks(modules);
fs.cpSync(modules,path.join(destination,"node_modules"),{recursive:true,dereference:true});
const rootPath=fs.realpathSync(root);
for(const [n,b] of snapshot)if(!get(destination,n).equals(b))fail("SNAPSHOT_CHANGED:"+n);
function makeReadOnly(dir){
 for(const name of fs.readdirSync(dir)){
  const p=path.join(dir,name),st=fs.lstatSync(p);
  if(st.isDirectory()){makeReadOnly(p);fs.chmodSync(p,0o555)}
  else if(st.isFile())fs.chmodSync(p,st.mode & ~0o222);
  else fail("SNAPSHOT_NONREGULAR");
 }
}
makeReadOnly(destination);
fs.chmodSync(destination,0o555);
fs.chmodSync(root,0o555);
for(const [n,b] of snapshot)if(!get(destination,n).equals(b))fail("SNAPSHOT_SEAL_HASH:"+n);
console.log("WTR011P_ROOT_OWNED_READONLY_PUBLISHER_SNAPSHOT=PASS");
// Probe the exact non-root UID used for the eventual upload process.
// Every path must deny write-open without modifying a single input byte.
const denyPaths=["wrangler.dev.jsonc",".dev-runtime/src/turso-index.js",".dev-assets/ms.js","package-lock.json"];
const writeProbe=[
 "const fs=require('node:fs');",
 "for(const p of process.argv.slice(1)){",
 "try{const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW);fs.closeSync(fd);process.exit(41);}",
 "catch(e){if(e.code!=='EACCES'&&e.code!=='EROFS')throw e;}",
 "}",
 "console.log('WRITE_OPEN_DENIED_FOR_ALL='+process.argv.slice(1).length);"
].join("");
const denied=spawnSync("setpriv",["--reuid=65534","--regid=65534","--clear-groups",process.execPath,"-e",writeProbe,...denyPaths],{
 cwd:destination,env:{PATH:process.env.PATH||"/usr/bin:/bin"},encoding:"utf8",timeout:15000
});
if(denied.error||denied.status!==0||!denied.stdout.includes("WRITE_OPEN_DENIED_FOR_ALL=4"))
 fail("SAME_UID_WRITE_DENIAL_FAILED");
for(const [n,b] of snapshot)if(!get(destination,n).equals(b))fail("AFTER_WRITE_PROBE_CHANGED:"+n);
console.log("WTR011P_UNPRIVILEGED_PUBLISHER_WRITE_DENIAL_4_OF_4=PASS");
if(mode==="inspect"){
 console.log("WTR011P_PUBLISH=NOT_INVOKED");
 process.exit(0);
}
if(!process.env.WTR_APPROVED_SOURCE_SHA || process.env.WTR_APPROVED_SOURCE_SHA!==process.env.GITHUB_SHA)fail("APPROVED_SOURCE_SHA");
if(process.env.WTR_DEV_IDENTITY_KIND!=="candidate" || !/^[a-f0-9]{64}$/.test(process.env.WTR_APPROVED_IDENTITY_SHA256||""))fail("CANDIDATE_DESCRIPTOR_PIN_REQUIRED");
const mock=process.env.WTR_TEST_LOOPBACK_ONLY==="1";
if(mock){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.CLOUDFLARE_API_BASE_URL||"") ||
 process.env.CLOUDFLARE_ACCOUNT_ID!=="00000000000000000000000000000000" ||
 !process.env.CLOUDFLARE_API_TOKEN?.startsWith("wtr011p-local-fake-token"))fail("MOCK_SCOPE");
}else if(!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN ||
 process.env.CLOUDFLARE_API_BASE_URL)fail("REAL_PROVIDER_GUARD");
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"wtr011p-publisher-tmp-"));
fs.chownSync(scratch,65534,65534);
fs.chmodSync(scratch,0o700);
// Wrangler requires a writable .wrangler/tmp for transient build output.
// This symlink is created by the trusted root launcher AFTER sealing all
// verified inputs. Its only target is a fresh isolated non-source scratch.
const transient=path.join(scratch,"wrangler-work");
fs.mkdirSync(transient,{mode:0o700});
fs.chownSync(transient,65534,65534);
fs.symlinkSync(transient,path.join(destination,".wrangler"));
for(const [n,b] of snapshot)if(!get(destination,n).equals(b))fail("POST_SCRATCH_SEAL_CHANGED:"+n);
console.log("WTR011P_WRANGLER_SCRATCH_SEPARATE_FROM_VERIFIED_INPUTS=PASS");
const env={...process.env,HOME:scratch,TMPDIR:scratch,XDG_CONFIG_HOME:scratch,
 WRANGLER_SEND_METRICS:"false",WRANGLER_SEND_ERROR_REPORTS:"false"};
const args=["--reuid=65534","--regid=65534","--clear-groups",
 process.execPath,"node_modules/wrangler/bin/wrangler.js","deploy",
 ".dev-runtime/src/turso-index.js","--config","wrangler.dev.jsonc"];
if(mock) args.push("--name","wtr011p-mock-only");
const run=spawnSync("setpriv",args,{cwd:destination,env,stdio:"inherit",timeout:120000});
if(run.error)fail("WRANGLER_SPAWN:"+run.error.message);
if(run.status!==0)fail("WRANGLER_EXIT:"+run.status);
console.log("WTR011P_WRANGLER_DEPLOY_EXIT=PASS");
