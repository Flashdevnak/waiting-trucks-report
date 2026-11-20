// Test-only full composer: real stager + Origin composer over disposable actual source copies.
import {loadSelectedIdentity,verifySource,verifyArtifacts} from './verify-wtr009-dev-identity.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));let artifact;
export function finalPnoContractArtifact(){
 if(artifact)return artifact;const identity=loadSelectedIdentity(root);verifySource(root,identity);const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wtr009-dev003-contract-'));const assets=path.join(temp,'assets'),runtime=path.join(temp,'runtime/src');fs.mkdirSync(assets,{recursive:true});fs.cpSync(path.join(root,'worker/src'),runtime,{recursive:true});
 for(const name of Object.keys(identity.assets)){const src=name==='safe-parity.html'?'.github/dev-tools/safe-parity.html':name;fs.copyFileSync(path.join(root,src),path.join(assets,name));}
 const commands=[];for(const [file,args]of[['stage-dev-runtime.mjs',[path.join(assets,'ms.js'),path.join(runtime,'index.js')]],['patch-dev-origin-manifest-session-v2.mjs',[path.join(assets,'ms.js'),path.join(runtime,'origin-manifest-v1.js')]]]){const argv=[path.join(root,'.github/dev-tools',file),...args];const out=execFileSync(process.execPath,argv,{cwd:root,encoding:'utf8',timeout:60000});commands.push({executable:process.execPath,argv,stdout:out});}
 const source=fs.readFileSync(path.join(assets,'ms.js'),'utf8');const sha=createHash('sha256').update(source).digest('hex');if(sha!==identity.assets['ms.js'].sha256)throw Error('DEV003_ACTUAL_COMPOSED_DERIVED_IDENTITY_MISMATCH');
 verifyArtifacts(assets,runtime,identity);artifact={root,temp,assets,runtime,source,sha,commands,identity};process.on('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));return artifact;
}
