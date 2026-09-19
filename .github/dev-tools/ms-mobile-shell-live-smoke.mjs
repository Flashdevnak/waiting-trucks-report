import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '20260907-mobile-shell-v7-diag3';
const ORIGIN = process.env.MOBILE_SHELL_DEV_ORIGIN || 'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev';
const PAGES = ['ms.html','proof.html','ms-report.html'];
const VIEWPORTS = [
  ['mobile360',360,800,true],
  ['mobile390',390,844,true],
  ['mobile412',412,915,true],
  ['tablet768',768,1024,false],
  ['desktop1366',1366,900,false],
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromePath() {
  for (const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']) {
    try {
      const value = execFileSync('bash',['-lc',`command -v ${name}`],{encoding:'utf8'}).trim();
      if (value) return value;
    } catch {}
  }
  throw new Error('Chrome/Chromium not found');
}

class CDP {
  constructor(url){this.url=url;this.seq=0;this.pending=new Map();this.events=[];}
  async connect(){
    this.ws=new WebSocket(this.url);
    await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});
    this.ws.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(!message.id){this.events.push(message);return;}
      const pending=this.pending.get(message.id);if(!pending)return;
      this.pending.delete(message.id);
      message.error?pending.reject(new Error(JSON.stringify(message.error))):pending.resolve(message.result);
    };
  }
  send(method,params={},sessionId=''){
    return new Promise((resolve,reject)=>{
      const id=++this.seq;this.pending.set(id,{resolve,reject});
      this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  close(){this.ws?.close();}
}

async function launch(){
  const profile=await mkdtemp(join(tmpdir(),'mobile-shell-v7-'));
  const child=spawn(chromePath(),[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-extensions',
    '--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank',
  ],{stdio:['ignore','ignore','pipe']});
  let stderr='';
  try{
    const version=await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value)};
      const timer=setTimeout(()=>finish(reject,new Error('Chrome DevTools endpoint not ready')),15000);
      child.stderr.on('data',chunk=>{
        stderr=(stderr+chunk.toString()).slice(-4000);
        const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if(match) finish(resolve,{webSocketDebuggerUrl:match[1]});
      });
      child.once('exit',code=>finish(reject,new Error(`Chrome exited before CDP ready (${code})`)));
      child.once('error',error=>finish(reject,error));
    });
    return {child,profile,version};
  }catch(error){
    child.kill('SIGTERM');
    await sleep(300);
    await rm(profile,{recursive:true,force:true}).catch(()=>{});
    throw new Error(`${error.message}${stderr?` · ${stderr.trim().slice(-1200)}`:''}`);
  }
}

async function evaluate(cdp,sessionId,expression){
  const reply=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
  if(reply.exceptionDetails) throw new Error(reply.exceptionDetails.text||'Browser evaluate failed');
  return reply.result?.value;
}

async function waitForLiveRelease(){
  for(let i=0;i<120;i+=1){
    try{
      const r=await fetch(`${ORIGIN}/style.css?v=20260905-dev-shell-v3&mobileShell=${Date.now()}`,{cache:'no-store',headers:{'cache-control':'no-cache'}});
      const text=await r.text();
      if(r.ok&&text.includes('DEV mobile unified shell v7')) return;
    }catch{}
    await sleep(1000);
  }
  throw new Error('Timed out waiting for DEV mobile unified shell v7 deployment');
}

async function waitReady(cdp,sessionId,page){
  for(let i=0;i<240;i+=1){
    const state=await evaluate(cdp,sessionId,`(()=>({ready:document.readyState,header:Boolean(document.querySelector('.dev-unified-header')),details:document.querySelectorAll('.dev-unified-header details.app-nav').length,central:document.querySelectorAll('#central-settings-btn,#settings-btn,.dev-central-settings').length,proofV16:Boolean(window.__PROOF_V16_READY__&&document.getElementById('proof-v16-style')&&document.querySelector('.proof-toolbar-v16')),href:location.href}))()`);
    const proofReady=page!=='proof.html'||state?.proofV16===true;
    if(state?.ready==='complete'&&state.header&&state.details===3&&state.central===1&&proofReady&&state.href.includes(`/${page}`)) return;
    await sleep(100);
  }
  throw new Error(`${page}: shell/final UI did not become ready`);
}

const BASE_PROBE = `(() => {
  const rect=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{x:+b.x.toFixed(1),y:+b.y.toFixed(1),width:+b.width.toFixed(1),height:+b.height.toFixed(1),right:+b.right.toFixed(1),bottom:+b.bottom.toFixed(1)}};
  const selector=e=>{const id=e.id?('#'+e.id):'';const classes=[...e.classList].slice(0,5).map(x=>'.'+x).join('');return e.tagName.toLowerCase()+id+classes};
  const header=document.querySelector('.dev-unified-header');
  const details=[...document.querySelectorAll('.dev-unified-header details.app-nav')];
  const status=document.querySelector('.dev-shell-status>*');
  const refresh=document.querySelector('.dev-shell-refresh>*');
  const central=[...document.querySelectorAll('#central-settings-btn,#settings-btn,.dev-central-settings')];
  const overflowers=[...document.querySelectorAll('body *')].map(e=>{const s=getComputedStyle(e),r=rect(e);return{selector:selector(e),rect:r,display:s.display,position:s.position,minWidth:s.minWidth,width:s.width,overflowX:s.overflowX,whiteSpace:s.whiteSpace}}).filter(x=>x.display!=='none'&&x.rect&&x.rect.width>0&&(x.rect.right>innerWidth+1||x.rect.x<-1||x.rect.width>innerWidth+1)).sort((a,b)=>Math.max(b.rect.right-innerWidth,b.rect.width-innerWidth)-Math.max(a.rect.right-innerWidth,a.rect.width-innerWidth)).slice(0,15);
  return {
    viewport:{width:innerWidth,height:innerHeight},
    documentWidth:document.documentElement.scrollWidth,
    bodyWidth:document.body.scrollWidth,
    header:rect(header),
    summaries:details.map(d=>rect(d.querySelector('summary'))),
    status:rect(status),refresh:rect(refresh),
    centralCount:central.length,
    centralHidden:central.every(e=>getComputedStyle(e).display==='none'||e.classList.contains('hidden')),
    openCount:details.filter(d=>d.open).length,
    proofV16Ready:Boolean(window.__PROOF_V16_READY__&&document.getElementById('proof-v16-style')&&document.querySelector('.proof-toolbar-v16')),
    overflowers,
  };
})()`;

function menuProbe(index){
  return `(async()=>{
    const details=[...document.querySelectorAll('.dev-unified-header details.app-nav')];
    const beforeOpen=details.map(d=>Boolean(d.open));
    details[${index}]?.querySelector('summary')?.click();
    await new Promise(r=>setTimeout(r,90));
    const d=details[${index}],menu=d?.querySelector('.app-nav-menu');
    const rect=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};
    const rgb=value=>{const m=String(value||'').match(/rgba?\\((\\d+)[, ]+\\s*(\\d+)[, ]+\\s*(\\d+)/i);return m?[+m[1],+m[2],+m[3]]:null};
    const lum=c=>{if(!c)return 0;const a=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
    const ratio=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b)),hi=Math.max(x,y),lo=Math.min(x,y);return(hi+.05)/(lo+.05)};
    const menuBg=getComputedStyle(menu).backgroundColor;
    const links=[...(menu?.querySelectorAll('a')||[])];
    const contrasts=links.map(link=>{const own=getComputedStyle(link).backgroundColor,bg=own==='rgba(0, 0, 0, 0)'?menuBg:own,b=link.querySelector('b'),small=link.querySelector('small');return{b:b?ratio(getComputedStyle(b).color,bg):99,small:small?ratio(getComputedStyle(small).color,bg):99}});
    return {beforeOpen,open:Boolean(d?.open),openCount:details.filter(x=>x.open).length,openStates:details.map(x=>Boolean(x.open)),menu:rect(menu),linkCount:links.length,contrasts};
  })()`;
}

function assertBase(label,result,width,mobile){
  const diagnostic=` overflowers=${JSON.stringify(result.overflowers)}`;
  assert.equal(result.viewport.width,width,`${label}: viewport mismatch`);
  assert.ok(result.documentWidth<=width+1,`${label}: document overflow ${result.documentWidth}/${width}${diagnostic}`);
  assert.ok(result.bodyWidth<=width+1,`${label}: body overflow ${result.bodyWidth}/${width}${diagnostic}`);
  assert.equal(result.centralCount,1,`${label}: central admin control must exist exactly once`);
  assert.equal(result.centralHidden,true,`${label}: central admin control must stay hidden without admin auth`);
  assert.equal(result.openCount,0,`${label}: dropdown must start closed`);
  assert.equal(result.summaries.length,3,`${label}: missing System/Tools/Account summary`);
  for(const box of [...result.summaries,result.status,result.refresh]){
    assert.ok(box&&box.x>=-1&&box.right<=width+1,`${label}: header control overflow ${JSON.stringify(box)}${diagnostic}`);
  }
  if(label.includes('/proof.html')) assert.equal(result.proofV16Ready,true,`${label}: Proof V16 final UI not ready`);
  if(mobile){
    assert.ok(result.header.height<310,`${label}: mobile header unexpectedly tall ${result.header.height}`);
    const [system,tools,account]=result.summaries;
    assert.ok(Math.abs(system.y-tools.y)<=2,`${label}: System/Tools not aligned`);
    assert.ok(system.right<=tools.x+2,`${label}: System/Tools overlap`);
    assert.ok(account.y>=Math.max(system.bottom,tools.bottom)-1,`${label}: Account overlaps System/Tools`);
    assert.ok(Math.abs(result.status.y-result.refresh.y)<=2,`${label}: status/refresh not on same row`);
    assert.ok(result.status.height<=52,`${label}: status wrapped vertically (${result.status.height})`);
    assert.ok(result.refresh.height<=52,`${label}: refresh wrapped vertically (${result.refresh.height})`);
  }
}

function assertMenu(label,result,width,height,mobile,isSystem){
  assert.equal(result.open,true,`${label}: menu did not open states=${JSON.stringify(result.openStates)} before=${JSON.stringify(result.beforeOpen)}`);
  assert.equal(result.openCount,1,`${label}: more than one dropdown open states=${JSON.stringify(result.openStates)}`);
  assert.ok(result.menu&&result.menu.x>=-1&&result.menu.right<=width+1,`${label}: dropdown horizontal overflow ${JSON.stringify(result.menu)}`);
  if(mobile){
    assert.ok(result.menu.bottom<=height+2,`${label}: dropdown exceeds viewport height ${JSON.stringify(result.menu)}`);
  }
  if(isSystem){
    assert.equal(result.linkCount,3,`${label}: system menu must contain the three active user pages`);
    for(const pair of result.contrasts){
      assert.ok(pair.b>=4.5,`${label}: menu title contrast too low ${pair.b}`);
      assert.ok(pair.small>=4.5,`${label}: menu detail contrast too low ${pair.small}`);
    }
  }
}

async function probePnoModal(cdp,sessionId,width,label){
  const expression = '(async()=>{'+
    'if(typeof openPendingParcels!==\'function\') return {ok:false,reason:\'openPendingParcels missing\'};'+
    'const originalBrowserPnoPage=browserPnoPage;'+
    'try{'+
      'const row={id:\'pno-smoke-row\',proofId:\'SMOKE-BC-001\',routeName:\'SMOKE ROUTE\',pnoState:\'OK\',pnoEnabled:true,pnoSourceDay:\'2026-09-19\',pnoLineId:\'LINE-SMOKE\',pnoVanLineId:\'\',pnoStoreId:\'STORE-A\',pnoNextStoreId:\'STORE-B\',expectedParcels:3,enteredParcels:2,pendingParcels:1};'+
      'const parcels=[{pno:\'PNO-SMOKE-001\',status:\'เข้าคลังแล้ว\',lastAction:\'Backing\',lastActionAt:\'2026-09-19 08:01:00\',targetHub:\'NAK\',targetBranch:\'A\',backingNo:\'BAG-SMOKE-01\'},{pno:\'PNO-SMOKE-002\',status:\'เข้าคลังแล้ว\',lastAction:\'Backing\',lastActionAt:\'2026-09-19 08:02:00\',targetHub:\'NAK\',targetBranch:\'A\',backingNo:\'BAG-SMOKE-01\'},{pno:\'PNO-SMOKE-003\',status:\'คงเหลือ\',lastAction:\'-\',lastActionAt:\'-\',targetHub:\'NAK\',targetBranch:\'B\',backingNo:\'\'}];'+
      'browserPnoPage=async (_row,type,page)=>({proofId:row.proofId,routeName:row.routeName,total:3,page,parcels:type===\'no_entry\'?[parcels[2]]:type===\'already\'?parcels.slice(0,2):parcels});'+
      'state.currentRows=[row];'+
      'await openPendingParcels(row,\'total\',1);await new Promise(r=>setTimeout(r,30));'+
      'const style=(sel)=>{const node=document.querySelector(sel);if(!node)return null;const s=getComputedStyle(node),r=node.getBoundingClientRect();return{display:s.display,backgroundColor:s.backgroundColor,color:s.color,borderColor:s.borderColor,width:r.width,right:r.right,x:r.x,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}};'+
      'const head=style(\'.pno-v18-head\'),tableHead=style(\'.pno-v18-table th\'),desktop=style(\'.pno-v18-desktop\'),mobile=style(\'.pno-v18-mobile\'),parcelTableHeaders=[...document.querySelectorAll(\'.pno-v18-desktop .pno-v18-table thead th\')].map(x=>x.textContent.trim()),parcelMobileBagBox=style(\'.pno-v18-mobile-bagbox\');'+
      'document.querySelector(\'[data-pno-v18-type="bag"]\')?.click();await new Promise(r=>setTimeout(r,30));'+
      'const bagTabStyle=style(\'[data-pno-v18-type="bag"].is-active\'),bagCard=style(\'.pno-v18-bag-card\'),backingBadge=style(\'.pno-v18-badge.is-backing\');'+
      'const dialog=document.querySelector(\'#pending-parcels-dialog\'),dr=dialog?.getBoundingClientRect();'+
      'return {ok:true,styleElement:Boolean(document.querySelector(\'#pno-approved-modal-v18-style\')),runtimeV2:(typeof pnoV18ViewCache!==\'undefined\'&&typeof pnoV18LoadBags===\'function\'),head,tableHead,desktop,mobile,bagTabStyle,bagCard,backingBadge,parcelMobileBagBox,parcelTableHeaders,dialog:dr?{width:dr.width,right:dr.right,x:dr.x,scrollWidth:dialog.scrollWidth,clientWidth:dialog.clientWidth}:null,viewport:innerWidth};'+
    '}finally{browserPnoPage=originalBrowserPnoPage;document.querySelector(\'#pending-parcels-dialog\')?.close();}'+
  '})()';
  const result=await evaluate(cdp,sessionId,expression);
  console.log(`PNO_VISUAL_RESULT_${label.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}=${JSON.stringify(result)}`);
  assert.equal(result?.ok,true,`${label}: PNO probe failed ${JSON.stringify(result)}`);
  assert.equal(result.styleElement,true,`${label}: live PNO style element missing`);
  assert.equal(result.runtimeV2,true,`${label}: live PNO V18 mobile/cache runtime missing`);
  assert.equal(result.head?.backgroundColor,'rgb(255, 255, 255)',`${label}: PNO head is not neutral white ${JSON.stringify(result.head)}`);
  assert.equal(result.tableHead?.backgroundColor,'rgb(36, 36, 36)',`${label}: PNO table header is not black`);
  assert.equal(result.tableHead?.color,'rgb(255, 255, 255)',`${label}: PNO table header text is not white`);
  assert.equal(result.bagTabStyle?.backgroundColor,'rgb(241, 242, 243)',`${label}: Backing tab is not neutral active style`);
  assert.equal(result.bagTabStyle?.color,'rgb(32, 33, 36)',`${label}: Backing tab text is not neutral dark`);
  assert.equal(result.backingBadge?.color,'rgb(37, 37, 37)',`${label}: Backing label is not neutral dark`);
  if(width>720) assert.deepEqual(result.parcelTableHeaders?.slice(0,6),['#','PNO','สถานะ','ล่าสุด','ปลายทาง','เวลา'],`${label}: desktop table does not match classic columns`);
  if(width<=720){
    assert.equal(result.desktop?.display,'none',`${label}: desktop table still visible on mobile`);
    assert.notEqual(result.mobile?.display,'none',`${label}: mobile cards are hidden on mobile`);
    assert.ok(result.bagCard&&result.bagCard.width<=width,`${label}: Backing card overflows mobile viewport`);
    assert.ok(result.dialog&&result.dialog.right<=width+1&&result.dialog.x>=-1,`${label}: PNO dialog overflows mobile viewport ${JSON.stringify(result.dialog)}`);
  }else assert.notEqual(result.desktop?.display,'none',`${label}: desktop table hidden on desktop`);
  console.log(`PNO_VISUAL_${label.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}=PASS`);
}

async function main(){
  await waitForLiveRelease();
  const {child,profile,version}=await launch();
  const cdp=new CDP(version.webSocketDebuggerUrl);
  try{
    await cdp.connect();
    const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    await cdp.send('Page.enable',{},sessionId);
    await cdp.send('Runtime.enable',{},sessionId);
    await cdp.send('Network.enable',{},sessionId);
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:true},sessionId);
    console.log(`MOBILE_SHELL_SMOKE_VERSION=${VERSION}`);

    for(const [view,width,height,isMobileDevice] of VIEWPORTS){
      const mobile=width<=412;
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:isMobileDevice},sessionId);
      for(const page of PAGES){
        await cdp.send('Page.navigate',{url:`${ORIGIN}/${page}?mobileShellSmoke=${Date.now()}-${view}`},sessionId);
        await waitReady(cdp,sessionId,page);
        const base=await evaluate(cdp,sessionId,BASE_PROBE);
        const label=`${view}/${page}`;
        if(page==='ms.html'&&(view==='mobile360'||view==='desktop1366')) await probePnoModal(cdp,sessionId,width,label);
        if(base.overflowers?.length) console.log(`OVERFLOW_DIAG_${view.toUpperCase()}_${page.replace('.html','').toUpperCase()}=${JSON.stringify(base.overflowers)}`);
        assertBase(label,base,width,mobile);
        const system=await evaluate(cdp,sessionId,menuProbe(0));
        assertMenu(`${label}/system`,system,width,height,mobile,true);
        if(mobile){
          assert.ok(system.menu.y>=base.header.bottom-1,`${label}: system dropdown overlaps mobile header/account area`);
          const tools=await evaluate(cdp,sessionId,menuProbe(1));
          assertMenu(`${label}/tools`,tools,width,height,true,false);
          assert.ok(tools.menu.y>=base.header.bottom-1,`${label}: tools dropdown overlaps mobile header/account area`);
          const account=await evaluate(cdp,sessionId,menuProbe(2));
          assertMenu(`${label}/account`,account,width,height,true,false);
          assert.ok(account.menu.y>=base.header.bottom-1,`${label}: account dropdown overlaps mobile header area`);
        }
        console.log(`MOBILE_SHELL_${view.toUpperCase()}_${page.replace('.html','').toUpperCase()}=PASS`);
      }
    }

    const mutationMethods=cdp.events
      .filter(e=>e.method==='Network.requestWillBeSent')
      .map(e=>e.params?.request?.method)
      .filter(method=>method&&!['GET','HEAD','OPTIONS'].includes(method));
    assert.deepEqual(mutationMethods,[],'mobile shell smoke emitted an HTTP mutation method');
    console.log('PNO_VISUAL_LIVE_SMOKE=PASS');
    console.log('MOBILE_SHELL_ALL_PAGES=PASS');
    console.log('MOBILE_SHELL_ADMIN_ENTRY_DOM=PASS');
    console.log('MOBILE_SHELL_MENU_CONTRAST=PASS');
    console.log('MOBILE_SHELL_DROPDOWN_ANCHOR=PASS');
    console.log('BROWSER_MUTATION_METHODS=0');
    console.log('MS_MUTATION_TESTED=NO');
    console.log('PRODUCTION_TOUCHED=NO');
  } finally {
    cdp.close();child.kill('SIGTERM');await sleep(300);await rm(profile,{recursive:true,force:true}).catch(()=>{});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
