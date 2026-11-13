// Target-specific fault containment over the existing008/009 owner implementation.
// No new QR/Excel/filter/provider engine; no timer or I/O.
const runtime=String.raw`
// WTR_DEV_TARGET_FAULT_BOUNDARY_V1_BEGIN
function pnoIntegratedReport(owner,error,opening) {
  if(owner&&!pnoAsyncOwn(owner))return;
  pnoV18State.busy=false;
  if(opening)pnoAsyncInvalidate();
  try{toast("ดำเนินการ PNO ไม่สำเร็จ กรุณาลองใหม่",true);}catch(_){}
}
function pnoIntegratedProtect(action,opening=false) {
  if(action.pnoIntegratedBound)return action;
  const wrapped=async function(...args){
    let owner;
    try{const pending=action.apply(this,args);owner=pnoAsyncCapture();return await pending;}
    catch(error){pnoIntegratedReport(owner||pnoAsyncCapture(),error,opening);}
  };
  wrapped.pnoIntegratedBound=true;return wrapped;
}
function pnoIntegratedBindHandlers(dialog) {
  if(!dialog)return;
  if(typeof dialog.close==="function"&&!dialog.close.pnoIntegratedBound){
    const nativeClose=dialog.close;
    const wrapped=function(...args){
      const life=pnoAsyncContext();
      if(this.open)life.targetCloseEvents=(life.targetCloseEvents||0)+1;
      pnoAsyncInvalidate();return nativeClose.apply(this,args);
    };
    wrapped.pnoIntegratedBound=true;dialog.close=wrapped;
  }
  const close=el("pending-parcels-close");
  if(close)close.onclick=pnoIntegratedProtect(()=>dialog.close());
  dialog.onclose=()=>{
    const life=pnoAsyncContext();
    if(life.targetCloseEvents>0){life.targetCloseEvents--;return;}
    if(!dialog.open&&!life.opening)pnoAsyncInvalidate();
  };
  dialog.oncancel=event=>{event?.preventDefault?.();if(dialog.open)dialog.close();else pnoAsyncInvalidate();};
  for(const node of dialog.querySelectorAll("button,select")){
    if(node===close)continue;
    for(const key of ["onclick","onchange"]){const action=node[key];if(typeof action==="function"&&!action.pnoIntegratedBound)node[key]=pnoIntegratedProtect(action);}
  }
}
(function pnoIntegratedTargetBoundary(){
  const ui=pnoV18EnsureUi;
  pnoV18EnsureUi=function(...args){const result=ui.apply(this,args);pnoIntegratedBindHandlers(el("pending-parcels-dialog"));return result;};
  for(const entry of [[()=>pnoV18RenderFilters,x=>{pnoV18RenderFilters=x;}],[()=>pnoV18RenderBags,x=>{pnoV18RenderBags=x;}]]){
    const render=entry[0]();entry[1](function(...args){const result=render.apply(this,args);pnoIntegratedBindHandlers(el("pending-parcels-dialog"));return result;});
  }
  for(const entry of [
    [()=>pnoV18PrepareCurrentFilters,x=>{pnoV18PrepareCurrentFilters=x;}],
    [()=>pnoV18Load,x=>{pnoV18Load=x;}],
    [()=>pnoV18LoadBags,x=>{pnoV18LoadBags=x;}],
    [()=>pnoInboundLoad,x=>{pnoInboundLoad=x;}],
    [()=>pnoV18Copy,x=>{pnoV18Copy=x;}],
    [()=>pnoV18CopyLine,x=>{pnoV18CopyLine=x;}],
    [()=>pnoV18Export,x=>{pnoV18Export=x;}],
    [()=>openPendingParcels,x=>{openPendingParcels=x;},true]
  ])entry[1](pnoIntegratedProtect(entry[0](),entry[2]===true));
})();
// WTR_DEV_TARGET_FAULT_BOUNDARY_V1_END
`;
export function patchPnoIntegratedTargetBoundary(source){
 if(source.includes('// WTR_DEV_TARGET_FAULT_BOUNDARY_V1_BEGIN'))return source;
 const before='  pnoV18EnsureUi();\n  if (typeof pnoAsyncBeginOpen === "function") pnoAsyncBeginOpen();';
 const after='  if (typeof pnoAsyncBeginOpen === "function") pnoAsyncBeginOpen();\n  pnoV18EnsureUi();';
 if(source.split(before).length!==3)throw Error('TARGET_BOUNDARY_OPEN_ANCHORS');
 const filter='  void pnoV18EnsureParcelFilterRows().then(() => {';
 if(source.split(filter).length!==2)throw Error('TARGET_BOUNDARY_FILTER_ANCHOR');
 return source.replaceAll(before,after).replace(filter,'  return pnoV18EnsureParcelFilterRows().then(() => {')+'\n'+runtime;
}
