const VERSION = '20260907-02';

export async function maybeHandleProofUiV16(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/proof-v16.js') return null;
  return new Response(`(()=>{const __name=(target,value)=>target;(${proofUiV16.toString()})();})();`, {
    headers: { 'Content-Type':'application/javascript; charset=utf-8', 'Cache-Control':'no-store' },
  });
}

function proofUiV16() {
  const boot = () => {
    const P = window.ProofV2;
    if (!window.__PROOF_V15_READY__ || !P || typeof P.loadRoutes !== 'function' || !P.state) return setTimeout(boot, 40);
    if (window.__PROOF_V16_READY__) return;
    window.__PROOF_V16_READY__ = true; // PROOF_QUICK_DAY_V16

    const dayInput = P.el('day-filter');
    const dayLabel = dayInput?.closest('label');
    let supplierRetryTimer = null;
    const printableStates = P.PRINTABLE_STATES || new Set([1,2,7]);

    const dayOffset = offset => {
      const base = String(P.thaiDay()).split('-').map(Number);
      const value = new Date(Date.UTC(base[0], base[1] - 1, base[2] + Number(offset || 0), 12, 0, 0));
      return value.toISOString().slice(0, 10);
    };
    const shortDay = value => {
      const [y,m,d] = String(value || '').split('-');
      return y && m && d ? `${d}/${m}` : '';
    };

    const syncQuickDays = () => {
      const current = String(dayInput?.value || P.state.day || '');
      document.querySelectorAll('[data-proof-day-offset]').forEach(button => {
        button.classList.toggle('is-active', current === dayOffset(Number(button.dataset.proofDayOffset || 0)));
      });
      const caption = document.getElementById('proof-day-caption-v16');
      if (caption) caption.textContent = current ? `วันที่ ${current}` : '';
    };

    const setDay = async value => {
      if (!value || P.state.loading) return;
      P.state.day = value;
      if (dayInput) dayInput.value = value;
      P.state.stateFilter = 'all';
      P.state.groupOpen?.clear?.();
      const stateFilter = P.el('state-filter');
      if (stateFilter) stateFilter.value = 'all';
      syncQuickDays();
      await P.loadRoutes(false);
    };

    if (dayLabel && !document.getElementById('proof-quick-day-v16')) {
      const quick = document.createElement('div');
      quick.id = 'proof-quick-day-v16';
      quick.className = 'proof-quick-day-v16';
      quick.innerHTML = [
        [-1,'เมื่อวาน'],
        [0,'วันนี้'],
        [1,'พรุ่งนี้'],
      ].map(([offset,label]) => `<button type='button' data-proof-day-offset='${offset}'><strong>${label}</strong><span>${shortDay(dayOffset(offset))}</span></button>`).join('') + `<small id='proof-day-caption-v16'></small>`;
      dayInput.insertAdjacentElement('afterend', quick);
      quick.addEventListener('click', event => {
        const button = event.target.closest('[data-proof-day-offset]');
        if (!button) return;
        event.preventDefault();
        setDay(dayOffset(Number(button.dataset.proofDayOffset || 0)));
      });
      dayInput.addEventListener('change', syncQuickDays);
    }

    const missingSupplierRows = () => (P.state.rows || []).filter(row => printableStates.has(Number(row?.proofState)) && !String(row?.fleetName || '').trim());
    const supplierRetryKey = () => `proof-v16-supplier-refresh:${String(P.state.branch || '')}:${String(P.state.day || '')}`;
    const scheduleSupplierCacheRefresh = () => {
      clearTimeout(supplierRetryTimer);
      if (!P.state.auth || !missingSupplierRows().length) return;
      if (P.state.loading) {
        supplierRetryTimer = setTimeout(scheduleSupplierCacheRefresh, 800);
        return;
      }
      let used = false;
      try { used = sessionStorage.getItem(supplierRetryKey()) === '1'; } catch {}
      if (used) return;
      supplierRetryTimer = setTimeout(async () => {
        if (!P.state.auth || P.state.loading || !missingSupplierRows().length) return;
        try { sessionStorage.setItem(supplierRetryKey(), '1'); } catch {}
        await P.loadRoutes(true);
      }, 6500);
    };

    const baseLoadRoutes = P.loadRoutes;
    P.loadRoutes = async (...args) => {
      const result = await baseLoadRoutes(...args);
      syncQuickDays();
      scheduleSupplierCacheRefresh();
      return result;
    };

    syncQuickDays();
    scheduleSupplierCacheRefresh();

    const style = document.createElement('style');
    style.id = 'proof-v16-style';
    style.textContent = `
      .proof-toolbar label:has(#day-filter){align-self:stretch;min-width:0}
      .proof-quick-day-v16{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:1px;width:100%;min-width:0;max-width:100%;overflow:hidden;box-sizing:border-box}
      .proof-quick-day-v16 button{min-width:0;max-width:100%;overflow:hidden;border:1px solid #cbd4da;background:#fff;color:#243340;border-radius:8px;padding:5px 3px;cursor:pointer;text-align:center;line-height:1.15;box-sizing:border-box}
      .proof-quick-day-v16 button strong,.proof-quick-day-v16 button span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .proof-quick-day-v16 button strong{font-size:10px}.proof-quick-day-v16 button span{font-size:8.5px;color:#63717c;margin-top:2px}
      .proof-quick-day-v16 button:hover{border-color:#c7a800;background:#fffbe8}.proof-quick-day-v16 button.is-active{background:#151515;border-color:#151515;color:#ffd400}
      .proof-quick-day-v16 button.is-active span{color:#fff2a6}.proof-quick-day-v16>small{grid-column:1/-1;text-align:center;color:#66747e;font-size:9px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media(max-width:760px){.proof-toolbar label:has(#day-filter){grid-column:1/-1!important;width:100%!important}.proof-quick-day-v16{gap:7px}.proof-quick-day-v16 button{padding:7px 5px}.proof-quick-day-v16 button strong{font-size:12px}.proof-quick-day-v16 button span{font-size:9.5px}}
      @media(max-width:430px){.proof-toolbar label:has(#day-filter){grid-column:1/-1!important;width:100%!important}.proof-quick-day-v16{gap:6px}.proof-quick-day-v16 button{padding:8px 4px}.proof-quick-day-v16 button strong{font-size:11.5px}}
    `;
    document.getElementById('proof-v16-style')?.remove();
    document.head.appendChild(style);
  };
  boot();
}
