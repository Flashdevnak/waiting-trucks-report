// UI-only hooks for the received Truck Header QR on existing owner transitions.
export function patchPnoTruckQrOwnerIntegrationV1(source){
 if(source.includes('// WTR009_TRUCK_QR_OWNER_INTEGRATION_V1'))return source;
 for(const name of ['pnoAsyncInvalidate','pnoAsyncBeginOpen']){
  const anchor='function '+name+'() {\n';
  if(source.split(anchor).length!==2)throw Error('TRUCK_OWNER_ANCHOR_'+name);
  source=source.replace(anchor,anchor+'  pnoTruckQrClearV1();\n');
 }
 const multi='  pnoV18State.sourceRow = row; pnoV18State.proofId = row.proofId;';
 if(source.split(multi).length!==2)throw Error('TRUCK_OWNER_MULTI_ANCHOR');
 source=source.replace(multi,multi+'\n  pnoTruckQrRenderV1();');
 return source+String.raw`
// WTR009_TRUCK_QR_OWNER_INTEGRATION_V1
function pnoTruckQrClearV1(){
 const slot=el('pending-parcels-dialog')?.querySelector('.pno-v18-head')?.querySelector('#pno-truck-qr-v1');
 if(slot){slot.replaceChildren();slot.hidden=true;}
}
`;
}
