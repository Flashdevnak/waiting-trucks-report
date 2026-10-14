// DEV-only UI guard: keep the opened parcel occurrence stable across unrelated
// background table refreshes, and give the mobile filter controls a real grid.
// No provider fetches, timers, database writes, or production changes.
export const PNO_MOBILE_MODAL_SCOPE_MARKER = 'PNO_MOBILE_MODAL_SCOPE_V1';

export const PNO_MOBILE_MODAL_STYLE = `

@media(min-width:1020px){
.ms-page #pending-parcels-dialog .pno-v18-filterbar:not(.hidden){display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) minmax(0,1fr) minmax(0,1.25fr)!important;gap:10px!important;align-items:end!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-field{min-width:0!important;max-width:none!important;width:100%!important;display:grid!important;grid-template-rows:auto 36px!important;gap:5px!important;align-items:end!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-field select{width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box;height:36px!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-reset{grid-column:1!important;justify-self:start!important;margin:0!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-result{grid-column:2/-1!important;margin:0!important;justify-self:end!important;align-self:center!important;text-align:right!important;overflow-wrap:anywhere}
}
@media(min-width:721px) and (max-width:1019px){
.ms-page #pending-parcels-dialog .pno-v18-filterbar:not(.hidden){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;align-items:end!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-field{min-width:0!important;width:100%!important;display:grid!important;gap:5px!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-field select{height:36px!important;width:100%!important;min-width:0!important;box-sizing:border-box}
.ms-page #pending-parcels-dialog .pno-v18-filter-reset{grid-column:1!important;justify-self:start!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-result{grid-column:2!important;margin:0!important;text-align:right!important;overflow-wrap:anywhere}
}
@media(max-width:720px){
.ms-page #pending-parcels-dialog .pno-v18-toolbar{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:10px!important;padding:10px 12px!important;align-items:stretch!important}
.ms-page #pending-parcels-dialog .pno-v18-tabs{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important;width:100%!important}
.ms-page #pending-parcels-dialog .pno-v18-tabs button{width:100%!important;min-width:0!important;min-height:42px;white-space:normal;overflow-wrap:anywhere}
.ms-page #pending-parcels-dialog .pno-v18-actions{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;width:100%!important;margin:0!important;align-items:stretch!important}
.ms-page #pending-parcels-dialog .pno-v18-actions .btn{grid-column:auto!important;min-width:0!important;width:100%!important;min-height:42px!important;padding:7px 4px!important;font-size:12px!important;line-height:1.4;white-space:normal;overflow-wrap:anywhere}
.ms-page #pending-parcels-dialog .pno-v18-filterbar:not(.hidden){display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:10px!important;align-items:stretch!important;padding:12px!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-field{grid-column:1/-1!important;min-width:0!important;max-width:none!important;width:100%!important;box-sizing:border-box;display:grid!important;gap:5px!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-field>span{font-size:12px!important;line-height:1.4}
.ms-page #pending-parcels-dialog .pno-v18-filter-field select{display:block;width:100%!important;min-width:0!important;max-width:100%!important;height:42px!important;box-sizing:border-box;font-size:14px!important}
.ms-page #pending-parcels-dialog .pno-v18-filter-reset{grid-column:1/-1!important;width:100%!important;min-width:0!important;height:auto!important;min-height:42px!important;white-space:normal!important;line-height:1.4!important;overflow-wrap:anywhere}
.ms-page #pending-parcels-dialog .pno-v18-filter-result{grid-column:1/-1!important;width:100%!important;margin:0!important;text-align:left!important;font-size:12px!important;line-height:1.5!important;overflow-wrap:anywhere}
.ms-page #pending-parcels-dialog .pno-v18-summary-item{min-width:0!important}
.ms-page #pending-parcels-dialog .pno-destination-summary{min-width:0!important}
.ms-page #pending-parcels-dialog .pno-destination-summary header>p{max-height:none!important;overflow-wrap:anywhere!important}
.ms-page #pending-parcels-dialog .pno-destination-table-scroll{max-width:100%;overflow:auto;-webkit-overflow-scrolling:touch}
}
@media(max-width:380px){
.ms-page #pending-parcels-dialog .pno-v18-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
.ms-page #pending-parcels-dialog #copy-line-pending-parcels{grid-column:1/-1!important}
}
`;

export function patchPnoMobileModalScope(source) {
  let output = String(source || '');
  const marker = '// PNO_MOBILE_MODAL_SCOPE_V1: applied';
  if (output.includes(marker)) return output;
  if (!output.includes('PNO_DESTINATION_TABLES_STABILITY_V1: applied') ||
      !output.includes('PNO_SEGMENT_DESTINATION_FRONTEND_V1'))
    throw Error('PNO_MOBILE_MODAL_SCOPE_V1: expected PNO-only UX prerequisites missing');
  const runtime = String.raw`
// PNO_MOBILE_MODAL_SCOPE_V1: applied; passive opened-trip snapshot and mobile grid.
(function pnoMobileModalScopeV1(){
  // Standalone diagnostic VM contexts may not load the PNO modal. Remain inert there.
  if (typeof pnoV18SourceRow !== 'function' || typeof openPendingParcels !== 'function' ||
      typeof pnoV18State !== 'object' || typeof state !== 'object' ||
      typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const liveSourceRow = pnoV18SourceRow;
  const originalOpen = openPendingParcels;
  let openedHub = '', openedSnapshot = null;
  openPendingParcels = function(...args){
    openedHub = String(state.branch || '');
    const row = args[0];
    openedSnapshot = row && typeof row === 'object' ?
      {...row, pnoSegments: Array.isArray(row.pnoSegments) ? row.pnoSegments.map(x => ({...x})) : row.pnoSegments} : null;
    return originalOpen.apply(this,args);
  };
  pnoV18SourceRow = function(...args){
    const dialog = el('pending-parcels-dialog');
    if (dialog?.open && openedSnapshot &&
        String(state.branch || '') === openedHub &&
        String(pnoV18State.proofId || '').trim() === String(openedSnapshot.proofId || '').trim())
      return openedSnapshot;
    return liveSourceRow.apply(this,args);
  };
  // Do not imply that an already-verified modal snapshot is live after a
  // background refresh changes only the counts of this exact opened occurrence.
  if (typeof pnoDestinationMarkup === 'function') {
    const originalMarkup = pnoDestinationMarkup;
    pnoDestinationMarkup = function(summary, scopeLabel, statusLabel){
      const html = originalMarkup.call(this, summary, scopeLabel, statusLabel);
      if (summary?.status !== 'COMPLETE' || !el('pending-parcels-dialog')?.open || !openedSnapshot)
        return html;
      const latest = liveSourceRow();
      if (!latest || typeof pnoV18LocatorKey !== 'function') return html;
      const identity = row => [row?.proofId,row?.pnoSourceDay,row?.pnoLineId,
        row?.pnoVanLineId,row?.pnoStoreId,row?.pnoNextStoreId]
        .map(x => String(x ?? '').trim()).join('|');
      if (identity(latest) !== identity(openedSnapshot) ||
          pnoV18LocatorKey(latest) === pnoV18LocatorKey(openedSnapshot)) return html;
      return html + '<p class="pno-destination-verified-note" role="status">' +
        'ข้อมูลปลายทางนี้ยืนยันครบ ณ ตอนเปิดรายการ · ยอดรถในตารางหลักเปลี่ยนแล้ว ' +
        'ปิดและเปิดรายการอีกครั้งเพื่อดูยอดล่าสุด</p>';
    };
  }
  const styleId = 'pno-mobile-modal-scope-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = PNO_MOBILE_MODAL_SCOPE_STYLE;
    document.head.append(style);
  }
})();
`;
  return output + '\nconst PNO_MOBILE_MODAL_SCOPE_STYLE = ' + JSON.stringify(PNO_MOBILE_MODAL_STYLE) + ';\n' + runtime;
}
