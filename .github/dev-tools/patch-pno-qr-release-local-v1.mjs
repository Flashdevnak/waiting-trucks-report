// Local candidate only. Scheduling refinement; no data/schema/network/gate changes.
export function patchPnoQrRelease009R2(source) {
  if (source.includes('WTR009R2_PNO_QR_YIELD_V1')) return source;
  if (!source.includes('WTR009R_PNO_QR_CLOSURE_V1')) throw Error('WTR009R2_PREREQUISITE_REQUIRED');
  const a=source.indexOf('async function workbook('), b=source.indexOf('scope.PnoQr009=Object.freeze(',a);
  if(a<0||b<=a)throw Error('WTR009R2_WORKBOOK_MISSING');
  const body=source.slice(a,b),old='if(++processed%32===0){await yieldFn();check();}';
  if(body.split(old).length!==2)throw Error('WTR009R2_YIELD_ANCHOR_MISMATCH');
  return source.slice(0,a)+body.replace(old,'if(++processed%8===0){await yieldFn();check();}')+source.slice(b)+'\n// WTR009R2_PNO_QR_YIELD_V1 — RELEASE HOLD\n';
}
