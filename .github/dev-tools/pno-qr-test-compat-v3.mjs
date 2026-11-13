// External diagnostic adapter. Original test sources/assertions stay byte-identical.
import vm from 'node:vm';import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';import {resolve} from 'node:path';import {TextEncoder} from 'node:util';import {createHash} from 'node:crypto';
import {finalPnoContractArtifact} from './pno-final-contract-artifact-v3.mjs';
const artifact=finalPnoContractArtifact();const asset=artifact.source;const rawRun=vm.runInContext;const mode='bridge';const directory=resolve(artifact.temp,'compat-evidence');mkdirSync(directory,{recursive:true});let index=0;const contexts=new WeakSet();
function extract(name){const pre=asset.includes('async function '+name+'(')?'async function '+name+'(':'function '+name+'(';const a=asset.indexOf(pre),b=asset.indexOf('\n}\n',a)+2;if(a<0||b<=a)throw Error('COMPAT_REAL_DEPENDENCY_MISSING '+name);return asset.slice(a,b);}
const a=asset.indexOf('/* WTR009 original local-only'),b=asset.indexOf('async function pnoQrExport009(',a),c=asset.indexOf('\n}\n',b)+2;const modules=asset.slice(a,c);
function unxml(v){return v.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi,(_,x,n,k)=>x?String.fromCodePoint(parseInt(x,16)):n?String.fromCodePoint(Number(n)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k]));}
function readWorkbook(bytes){const buf=Buffer.from(bytes),files=new Map();let p=0;while(buf.readUInt32LE(p)===0x04034b50){let size=buf.readUInt32LE(p+18),method=buf.readUInt16LE(p+8),nl=buf.readUInt16LE(p+26),xl=buf.readUInt16LE(p+28),name=buf.subarray(p+30,p+30+nl).toString(),start=p+30+nl+xl;if(method!==0)throw Error('COMPAT_UNSUPPORTED_COMPRESSION');files.set(name,buf.subarray(start,start+size));p=start+size;}
 const book=files.get('xl/workbook.xml').toString();const name=unxml(book.match(/<sheet name="([^"]+)"/)[1]);const xml=files.get('xl/worksheets/sheet1.xml').toString();const rows=[];for(const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){let cells=new Map();for(const cc of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){let col=cc[1].match(/r="([A-Z]+)/)[1],is=cc[1].includes('inlineStr'),v=is?unxml(cc[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1]||''):Number(cc[2].match(/<v>(.*?)<\/v>/)?.[1]);cells.set(col,v);}rows.push(cells);}const headers=[...rows.shift().entries()].filter(([,v])=>!String(v).startsWith('QR Code ('));return {name,rows:rows.map(c=>Object.fromEntries(headers.map(([col,key])=>[key,c.get(col)??'']))),media:[...files.keys()].filter(n=>n.startsWith('xl/media/')).length};}
const mandatory=['pnoAsyncCancelWaitingPages','pnoAsyncReleasePageSlot','pnoAsyncAcquirePageSlot','pnoTruckQrClearV1','pnoTruckQrRenderV1','pnoAsyncContext','pnoAsyncCapture','pnoAsyncOwn','pnoAsyncCancelled','pnoAsyncInvalidate','pnoAsyncBeginOpen','pnoAsyncBeginView','pnoAsyncHoldNoPrefetch','pnoAsyncActionSignature','pnoAsyncPage','pnoV18RenderUnionDiagnostic'];
vm.runInContext=function(code,ctx,options){
 if(ctx?.pnoV18State && String(code).includes('/* WTR009 original local-only')){const result=rawRun(code,ctx,options);contexts.add(ctx);return result;}
 if(ctx?.pnoV18State && /(?:function pnoV18|function pnoInbound|PNO_DESTINATION)/.test(String(code))){
  if(!contexts.has(ctx)){
   contexts.add(ctx);const supplied=[];ctx.TextEncoder??=TextEncoder;ctx.MessageChannel??=MessageChannel;ctx.btoa??=btoa;ctx.Blob??=Blob;ctx.URL??=URL;
   // The old fixtures did not supply a DOM to code that now has a lazy UI hook.
   ctx.document??={};ctx.document.querySelectorAll??=undefined;
   if(!ctx.state){ctx.state={branch:ctx.pnoV18State.sourceRow?.hub||'SYNTHETIC-HUB'};supplied.push('synthetic selected HUB boundary');}
   if(true){ // Explicit complete synthetic Worker envelopes; domain expected values unchanged.
    const fillScope=()=>{const r=typeof ctx.pnoV18SourceRow==='function'?ctx.pnoV18SourceRow():ctx.pnoV18State.sourceRow;if(r&&r.proofId){const defaults={pnoSourceDay:'2026-11-11',pnoLineId:'SYNTHETIC-LINE',pnoStoreId:'SYNTHETIC-SOURCE',pnoNextStoreId:'SYNTHETIC-TARGET'};const added=[];for(const [k,v]of Object.entries(defaults))if(!Object.hasOwn(r,k)){r[k]=v;added.push(k);}if(added.length)appendFileSync(resolve(directory,'events-'+process.pid+'.jsonl'),JSON.stringify({kind:'EXPLICIT_SYNTHETIC_FIXTURE_LOCATOR_COMPLETION',added})+'\n');}};
    ctx.__compatFillScope=fillScope;fillScope();let fn=ctx.browserPnoPage;
    const wrap=f=>typeof f!=='function'?f:async function(row,type,page,force){const value=await f(row,type,page,force);if(!value||typeof value!=='object')return value;const defaults={hub:String(ctx.state.branch||row.hub||'').trim().toUpperCase(),proofId:String(row.proofId||'').trim().toUpperCase().replace(/\s+/g,''),day:row.pnoSourceDay,lineId:row.pnoLineId||row.pnoVanLineId,sourceStoreId:row.pnoStoreId,targetStoreId:row.pnoNextStoreId,type,page,sourceValid:true};const added=Object.keys(defaults).filter(k=>!Object.hasOwn(value,k));appendFileSync(resolve(directory,'events-'+process.pid+'.jsonl'),JSON.stringify({kind:'EXPLICIT_SYNTHETIC_WORKER_ENVELOPE_ADAPTER',added,type,page})+'\n');return {...defaults,...value};};
    fn=wrap(fn);Object.defineProperty(ctx,'browserPnoPage',{configurable:true,enumerable:true,get:()=>fn,set:v=>{fn=wrap(v);}});
   }
   // Legacy sliced fixtures do not model header DOM; expose an absent header, never a fake image.
   ctx.el??=()=>null;const legacyEl=ctx.el;if(typeof legacyEl==='function')ctx.el=function(id){const n=legacyEl(id);if(id==='pending-parcels-dialog'&&n&&!n.__headerBoundary){const query=n.querySelector;n.querySelector=function(selector){if(selector==='.pno-v18-head')return null;return query?.call(this,selector);};n.__headerBoundary=true;}return n;};
   rawRun(modules,ctx);if(asset.includes('function pnoQrNormalizeProof009R('))rawRun(extract('pnoQrNormalizeProof009R'),ctx);for(const n of mandatory)if(typeof ctx[n]!=='function'){rawRun(extract(n),ctx);supplied.push(n);}
   if(typeof ctx.pnoV18SourceRow!=='function'){ctx.pnoV18SourceRow=()=>ctx.pnoV18State.sourceRow||null;supplied.push('synthetic sourceRow boundary');}
   if(typeof ctx.pnoV18LocatorKey!=='function'){rawRun(extract('pnoV18LocatorKey'),ctx);supplied.push('pnoV18LocatorKey');}
   ctx.__compatDownload=(bytes,filename)=>{const parsed=readWorkbook(bytes);const file=process.pid+'-'+(++index)+'.xlsx';writeFileSync(resolve(directory,file),Buffer.from(bytes));appendFileSync(resolve(directory,'events-'+process.pid+'.jsonl'),JSON.stringify({kind:'REAL_OOXML_DOWNLOAD_BRIDGE',file,rows:parsed.rows.length,name:parsed.name,media:parsed.media,sha256:createHash('sha256').update(bytes).digest('hex')})+'\n');if(mode==='bridge'){const sheet=ctx.XLSX.utils.json_to_sheet(parsed.rows),book=ctx.XLSX.utils.book_new();ctx.XLSX.utils.book_append_sheet(book,sheet,parsed.name);return ctx.XLSX.writeFile?.(book,filename);}};
   rawRun('pnoQrDownload009=(bytes,filename)=>__compatDownload(bytes,filename);',ctx);
   appendFileSync(resolve(directory,'events-'+process.pid+'.jsonl'),JSON.stringify({kind:'INJECT_REAL_DEPENDENCIES',dependencies:supplied,stagedSHA256:createHash('sha256').update(asset).digest('hex')})+'\n');
  }
 }
 ctx?.__compatFillScope?.();
 const result=rawRun(code,ctx,options);
 if(ctx?.pnoV18State && contexts.has(ctx)){
  // Only old fixtures which begin already inside an opened view need a real
  // lifecycle initialized. Existing real lifecycle/open/close is never replaced.
  const st=ctx.pnoV18State;if(!st.asyncLifecycle && st.sourceRow && typeof ctx.pnoAsyncContext==='function'){rawRun('pnoAsyncBeginOpen();pnoV18State.asyncLifecycle.opening=false;',ctx);}
 }
 return result;
};
const rawNew=vm.runInNewContext;vm.runInNewContext=function(code,ctx={},options){vm.createContext(ctx);return vm.runInContext(code,ctx,options);};
const RealFunction=globalThis.Function;
function pureRendererArgs(args){if(typeof args.at(-1)!=='string'||!/(?:function pnoInboundRender\(|function pnoV18RenderRows\()/.test(args.at(-1))||args.at(-1).includes('WTR009_PNO_QR_EXCEL_LOCAL_V1'))return args;
 const pre=(/\b(?:const|let|var)[^;\n]*pnoV18State/.test(args.at(-1))?'':'const pnoV18State={};')+'const state={branch:""};\n'+modules+'\n'+mandatory.filter(n=>n.startsWith('pnoAsync')).map(extract).join('\n')+'\n';
 appendFileSync(resolve(directory,'events-'+process.pid+'.jsonl'),JSON.stringify({kind:'PURE_FUNCTION_REAL_QR_DEPENDENCIES_UNOWNED',bodySHA256:createHash('sha256').update(args.at(-1)).digest('hex')})+'\n');return [...args.slice(0,-1),pre+args.at(-1)];}
globalThis.Function=new Proxy(RealFunction,{apply(target,self,args){return Reflect.apply(target,self,pureRendererArgs(args));},construct(target,args){return Reflect.construct(target,pureRendererArgs(args));}});
