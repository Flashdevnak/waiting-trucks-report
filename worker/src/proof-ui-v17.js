const VERSION = '20260907-01';

export async function maybeHandleProofUiV17(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/proof-v17.js') return null;
  return new Response(`(()=>{const __name=(target,value)=>target;(${proofUiV17.toString()})();})();`, {
    headers: { 'Content-Type':'application/javascript; charset=utf-8', 'Cache-Control':'no-store' },
  });
}

function proofUiV17() {
  const boot = () => {
    const P = window.ProofV2;
    if (!window.__PROOF_V16_READY__ || !P || !P.state) return setTimeout(boot, 40);
    if (window.__PROOF_V17_READY__) return;
    window.__PROOF_V17_READY__ = true; // PROOF_LAYOUT_POLISH_V17

    const dayInput = P.el('day-filter');
    const dayLabel = dayInput?.closest('label');
    const toolbar = dayInput?.closest('.proof-toolbar');
    const quick = document.getElementById('proof-quick-day-v16');
    if (toolbar && quick) {
      quick.classList.add('proof-quick-day-v17');
      toolbar.insertAdjacentElement('afterend', quick);
    }
    if (dayLabel) dayLabel.classList.add('proof-day-field-v17');

    const splitEditorTime = () => {
      const dialog = document.getElementById('proof-editor-dialog');
      if (!dialog?.open) return;
      const hero = dialog.querySelector('.proof-v16-editor-hero');
      const plan = document.getElementById('proof-editor-plan');
      if (!hero || !plan) return;
      const card = plan.closest('.proof-v16-editor-meta-card');
      if (!card) return;
      const label = card.querySelector(':scope > small');
      if (label) label.textContent = 'เวลาเที่ยวรถ';

      let grid = card.querySelector('.proof-v17-time-grid');
      if (!grid) {
        grid = document.createElement('div');
        grid.className = 'proof-v17-time-grid';
        grid.innerHTML = `
          <div class='proof-v17-time-item standby'><small>Standby</small><strong id='proof-v17-standby-time'>ยังไม่ทราบ</strong></div>
          <div class='proof-v17-time-item release'><small>ปล่อยรถ</small><strong id='proof-v17-release-time'>ยังไม่ทราบ</strong></div>`;
        plan.insertAdjacentElement('beforebegin', grid);
      }

      const text = String(plan.textContent || '').replace(/\s{2,}/g,' ').trim();
      const standby = text.match(/Standby\s*([0-2]?\d:[0-5]\d)/i)?.[1] || 'ยังไม่ทราบ';
      const release = text.match(/ปล่อย\s*([0-2]?\d:[0-5]\d)/)?.[1] || 'ยังไม่ทราบ';
      const standbyEl = grid.querySelector('#proof-v17-standby-time');
      const releaseEl = grid.querySelector('#proof-v17-release-time');
      if (standbyEl) standbyEl.textContent = standby;
      if (releaseEl) releaseEl.textContent = release;
      plan.classList.add('proof-v17-plan-source');
    };

    const baseOpenEditor = P.openEditor;
    if (typeof baseOpenEditor === 'function') {
      P.openEditor = (row, detail) => {
        const result = baseOpenEditor(row, detail);
        setTimeout(splitEditorTime, 20);
        return result;
      };
    }

    const style = document.createElement('style');
    style.id = 'proof-v17-style';
    style.textContent = `
      .proof-toolbar .proof-day-field-v17{align-self:end!important;height:auto!important}
      .proof-toolbar .proof-day-field-v17 #day-filter{min-height:56px!important}
      .proof-quick-day-v17{width:min(360px,100%)!important;max-width:360px!important;margin:10px 0 0 auto!important;overflow:visible!important}

      @media(min-width:761px){
        .proof-v15-row>.proof-v15-route>small:first-child,
        .proof-v15-row>.proof-v15-cell>small:first-child,
        .proof-v15-row>.proof-v15-status>div:first-child>small:first-child{display:none!important}
      }

      .proof-v15-row .proof-v15-cell.barcode>span,
      .proof-v15-row .proof-v15-cell.time>span,
      .proof-v15-row .proof-v15-cell.driver>span{
        display:inline-flex!important;align-items:center;max-width:100%;margin-top:6px;padding:3px 8px;border:1px solid #d8e0e6;border-radius:999px;background:#f4f7f9;color:#40515e!important;font-size:10.5px!important;font-weight:800!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis
      }
      .proof-v15-row .proof-v15-cell.supplier>strong{font-size:14px!important}
      .proof-v15-row .proof-v15-status>div:first-child>strong{
        display:inline-flex!important;align-items:center;justify-content:center;min-height:30px;margin-top:0!important;padding:4px 10px;border-radius:999px;border:1px solid #e3cc68;background:#fff4c8;color:#6c5200!important;font-size:11.5px!important;font-weight:900!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;text-align:center
      }
      .proof-v15-row.is-ready .proof-v15-status>div:first-child>strong{background:#eaf7ef;border-color:#bfddc8;color:#285d3c!important}
      .proof-v15-row.is-missed .proof-v15-status>div:first-child>strong{background:#fff0ee;border-color:#ecc5bf;color:#963e34!important}

      .proof-v17-plan-source{display:none!important}
      .proof-v17-time-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .proof-v17-time-item{min-width:0;padding:9px 10px;border:1px solid #dbe3e8;border-radius:10px;background:#f8fafb;text-align:center}
      .proof-v17-time-item small{display:block!important;margin:0 0 4px!important;color:#66737d!important;font-size:10.5px!important;font-weight:800!important}
      .proof-v17-time-item strong{display:block;color:#15222c;font-size:18px!important;font-weight:900!important;line-height:1.2!important;white-space:nowrap}
      .proof-v17-time-item.standby{box-shadow:inset 0 3px 0 #8da4b4}
      .proof-v17-time-item.release{box-shadow:inset 0 3px 0 #e0c000}

      @media(max-width:760px){
        .proof-toolbar .proof-day-field-v17{grid-column:auto!important;width:100%!important}
        .proof-quick-day-v17{width:100%!important;max-width:none!important;margin:8px 0 0!important}
      }
      @media(max-width:430px){
        .proof-v17-time-grid{grid-template-columns:1fr 1fr;gap:6px}
        .proof-v17-time-item{padding:8px 6px}.proof-v17-time-item strong{font-size:16px!important}
      }
    `;
    document.getElementById('proof-v17-style')?.remove();
    document.head.appendChild(style);
  };
  boot();
}
