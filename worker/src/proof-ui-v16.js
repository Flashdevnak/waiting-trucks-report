const VERSION = '20260907-03';

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

    // PROOF_EDITOR_HERO_A_V16: clean operational header for the print dialog.
    const polishEditorHero = () => {
      const dialog = document.getElementById('proof-editor-dialog');
      if (!dialog?.open) return;
      const box = dialog.querySelector('.proof-editor-route-box');
      const route = document.getElementById('proof-editor-route');
      const status = document.getElementById('proof-editor-status');
      const plan = document.getElementById('proof-editor-plan');
      const user = document.getElementById('proof-editor-ms-user');
      if (!box || !route || !status || !plan || !user) return;

      let hero = box.querySelector('.proof-v16-editor-hero');
      if (!hero) {
        hero = document.createElement('div');
        hero.className = 'proof-v16-editor-hero';

        const routeLabel = document.createElement('div');
        routeLabel.className = 'proof-v16-editor-route-label';
        routeLabel.textContent = 'เส้นทาง';

        const statusRow = document.createElement('div');
        statusRow.className = 'proof-v16-editor-status-row';

        const metaGrid = document.createElement('div');
        metaGrid.className = 'proof-v16-editor-meta-grid';

        const timeCard = document.createElement('div');
        timeCard.className = 'proof-v16-editor-meta-card';
        const timeLabel = document.createElement('small');
        timeLabel.textContent = 'เวลา';
        timeCard.append(timeLabel, plan);

        const userCard = document.createElement('div');
        userCard.className = 'proof-v16-editor-meta-card';
        const userLabel = document.createElement('small');
        userLabel.textContent = 'ผู้ใช้งาน';
        userCard.append(userLabel, user);

        statusRow.append(status);
        metaGrid.append(timeCard, userCard);
        hero.append(routeLabel, route, statusRow, metaGrid);
        box.replaceChildren(hero);
      }

      const stateCode = Number(P.editorState?.detail?.proofState ?? P.editorState?.row?.proofState ?? 0);
      status.className = `proof-v16-editor-status is-state-${Number.isFinite(stateCode) ? stateCode : 0}`;
      const planText = String(plan.textContent || '')
        .replace(/^เวลา\s*:\s*/,'')
        .replace(/\s*→\s*/g,' ถึง ')
        .replace(/\s{2,}/g,' ')
        .trim();
      if (planText) plan.textContent = planText;
      user.textContent = String(user.textContent || '').replace(/^ผู้ใช้งาน\s*:\s*/,'').trim() || 'ยังไม่ระบุ';
    };

    const baseOpenEditorV16 = P.openEditor;
    if (typeof baseOpenEditorV16 === 'function') {
      P.openEditor = (row, detail) => {
        const result = baseOpenEditorV16(row, detail);
        setTimeout(polishEditorHero, 0);
        return result;
      };
    }

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

      .proof-v15-editor .proof-editor-route-box{padding:18px 20px!important;background:#f8fafb!important}
      .proof-v16-editor-hero{width:100%;min-width:0;text-align:center}
      .proof-v16-editor-route-label{font-size:12px;font-weight:800;color:#65727d;margin-bottom:5px}
      .proof-v16-editor-hero #proof-editor-route{display:block;font-size:22px!important;line-height:1.3!important;font-weight:900!important;color:#13212d!important;word-break:break-word;margin:0 auto!important}
      .proof-v16-editor-status-row{display:flex;justify-content:center;align-items:center;margin-top:9px}
      .proof-v16-editor-status{display:inline-flex!important;align-items:center;justify-content:center;min-height:32px;padding:5px 13px;border-radius:999px;border:1px solid #e1ca61;background:#fff4c2;color:#6b5200!important;font-size:13px!important;font-weight:900!important;line-height:1.2!important;white-space:nowrap}
      .proof-v16-editor-status.is-state-2,.proof-v16-editor-status.is-state-7{background:#edf5ff;border-color:#bfd4ea;color:#234f73!important}
      .proof-v16-editor-status.is-state-3,.proof-v16-editor-status.is-state-4{background:#eaf7ef;border-color:#bbddc7;color:#285c3a!important}
      .proof-v16-editor-status.is-state-5,.proof-v16-editor-status.is-state-6{background:#fff0ee;border-color:#ebc5bf;color:#934238!important}
      .proof-v16-editor-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:15px;text-align:left}
      .proof-v16-editor-meta-card{min-width:0;background:#fff;border:1px solid #d5dee5;border-radius:11px;padding:10px 12px;box-sizing:border-box}
      .proof-v16-editor-meta-card>small{display:block!important;font-size:10.5px!important;font-weight:800!important;color:#65727d!important;margin:0 0 5px!important}
      .proof-v16-editor-meta-card #proof-editor-plan,.proof-v16-editor-meta-card #proof-editor-ms-user{display:block!important;margin:0!important;color:#17232d!important;font-size:14px!important;font-weight:800!important;line-height:1.4!important;white-space:normal!important;word-break:break-word}

      @media(max-width:760px){.proof-toolbar label:has(#day-filter){grid-column:1/-1!important;width:100%!important}.proof-quick-day-v16{gap:7px}.proof-quick-day-v16 button{padding:7px 5px}.proof-quick-day-v16 button strong{font-size:12px}.proof-quick-day-v16 button span{font-size:9.5px}.proof-v16-editor-meta-grid{grid-template-columns:1fr}.proof-v16-editor-hero #proof-editor-route{font-size:19px!important}}
      @media(max-width:430px){.proof-toolbar label:has(#day-filter){grid-column:1/-1!important;width:100%!important}.proof-quick-day-v16{gap:6px}.proof-quick-day-v16 button{padding:8px 4px}.proof-quick-day-v16 button strong{font-size:11.5px}.proof-v15-editor .proof-editor-route-box{padding:14px 12px!important}.proof-v16-editor-meta-grid{gap:8px;margin-top:12px}}
    `;
    document.getElementById('proof-v16-style')?.remove();
    document.head.appendChild(style);
  };
  boot();
}
