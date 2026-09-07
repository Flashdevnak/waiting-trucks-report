const VERSION = '20260907-04';

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
    const toolbar = dayInput?.closest('.proof-toolbar');
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

    // Keep the date input aligned with HUB/search. Quick-day controls sit below the toolbar.
    const quickDay = document.getElementById('proof-quick-day-v16');
    if (toolbar && quickDay) {
      quickDay.classList.add('proof-quick-day-detached-v16');
      toolbar.insertAdjacentElement('afterend', quickDay);
    }
    if (dayLabel) dayLabel.classList.add('proof-day-field-v16');

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
        timeCard.className = 'proof-v16-editor-meta-card proof-v16-time-card';
        const timeLabel = document.createElement('small');
        timeLabel.textContent = 'เวลาเที่ยวรถ';
        const timeGrid = document.createElement('div');
        timeGrid.className = 'proof-v16-time-grid';
        timeGrid.innerHTML = `<div class='proof-v16-time-item standby'><small>Standby</small><strong id='proof-v16-standby-time'>ยังไม่ทราบ</strong></div><div class='proof-v16-time-item release'><small>ปล่อยรถ</small><strong id='proof-v16-release-time'>ยังไม่ทราบ</strong></div>`;
        timeCard.append(timeLabel, timeGrid, plan);

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
      const standby = planText.match(/Standby\s*([0-2]?\d:[0-5]\d)/i)?.[1] || 'ยังไม่ทราบ';
      const release = planText.match(/ปล่อย\s*([0-2]?\d:[0-5]\d)/)?.[1] || 'ยังไม่ทราบ';
      const standbyEl = hero.querySelector('#proof-v16-standby-time');
      const releaseEl = hero.querySelector('#proof-v16-release-time');
      if (standbyEl) standbyEl.textContent = standby;
      if (releaseEl) releaseEl.textContent = release;
      plan.classList.add('proof-v16-plan-source');
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
      .proof-toolbar .proof-day-field-v16{align-self:end!important;height:auto!important;min-width:0}
      .proof-toolbar .proof-day-field-v16 #day-filter{min-height:56px!important}
      .proof-quick-day-v16{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;width:100%;min-width:0;box-sizing:border-box}
      .proof-quick-day-detached-v16{width:min(360px,100%)!important;max-width:360px!important;margin:10px 0 0 auto!important;overflow:visible!important}
      .proof-quick-day-v16 button{min-width:0;max-width:100%;overflow:hidden;border:1px solid #cbd4da;background:#fff;color:#243340;border-radius:8px;padding:5px 3px;cursor:pointer;text-align:center;line-height:1.15;box-sizing:border-box}
      .proof-quick-day-v16 button strong,.proof-quick-day-v16 button span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .proof-quick-day-v16 button strong{font-size:10px}.proof-quick-day-v16 button span{font-size:8.5px;color:#63717c;margin-top:2px}
      .proof-quick-day-v16 button:hover{border-color:#c7a800;background:#fffbe8}.proof-quick-day-v16 button.is-active{background:#151515;border-color:#151515;color:#ffd400}
      .proof-quick-day-v16 button.is-active span{color:#fff2a6}.proof-quick-day-v16>small{grid-column:1/-1;text-align:center;color:#66747e;font-size:9px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

      @media(min-width:761px){
        .proof-v15-row>.proof-v15-route>small:first-child,
        .proof-v15-row>.proof-v15-cell>small:first-child,
        .proof-v15-row>.proof-v15-status>div:first-child>small:first-child{display:none!important}
      }
      .proof-v15-row .proof-v15-cell.barcode>span,
      .proof-v15-row .proof-v15-cell.time>span,
      .proof-v15-row .proof-v15-cell.driver>span{display:inline-flex!important;align-items:center;max-width:100%;margin-top:6px;padding:3px 8px;border:1px solid #d8e0e6;border-radius:999px;background:#f4f7f9;color:#40515e!important;font-size:10.5px!important;font-weight:800!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proof-v15-row .proof-v15-cell.supplier>strong{font-size:14px!important}
      .proof-v15-row .proof-v15-status>div:first-child>strong{display:inline-flex!important;align-items:center;justify-content:center;min-height:30px;margin-top:0!important;padding:4px 10px;border-radius:999px;border:1px solid #e3cc68;background:#fff4c8;color:#6c5200!important;font-size:11.5px!important;font-weight:900!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;text-align:center}
      .proof-v15-row.is-ready .proof-v15-status>div:first-child>strong{background:#eaf7ef;border-color:#bfddc8;color:#285d3c!important}
      .proof-v15-row.is-missed .proof-v15-status>div:first-child>strong{background:#fff0ee;border-color:#ecc5bf;color:#963e34!important}

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
      .proof-v16-editor-meta-card #proof-editor-ms-user{display:block!important;margin:0!important;color:#17232d!important;font-size:14px!important;font-weight:800!important;line-height:1.4!important;white-space:normal!important;word-break:break-word}
      .proof-v16-plan-source{display:none!important}
      .proof-v16-time-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .proof-v16-time-item{min-width:0;padding:9px 10px;border:1px solid #dbe3e8;border-radius:10px;background:#f8fafb;text-align:center}
      .proof-v16-time-item small{display:block!important;margin:0 0 4px!important;color:#66737d!important;font-size:10.5px!important;font-weight:800!important}
      .proof-v16-time-item strong{display:block;color:#15222c;font-size:18px!important;font-weight:900!important;line-height:1.2!important;white-space:nowrap}
      .proof-v16-time-item.standby{box-shadow:inset 0 3px 0 #8da4b4}.proof-v16-time-item.release{box-shadow:inset 0 3px 0 #e0c000}

      @media(max-width:760px){.proof-toolbar .proof-day-field-v16{grid-column:auto!important;width:100%!important}.proof-quick-day-detached-v16{width:100%!important;max-width:none!important;margin:8px 0 0!important}.proof-quick-day-v16{gap:7px}.proof-quick-day-v16 button{padding:7px 5px}.proof-quick-day-v16 button strong{font-size:12px}.proof-quick-day-v16 button span{font-size:9.5px}.proof-v16-editor-meta-grid{grid-template-columns:1fr}.proof-v16-editor-hero #proof-editor-route{font-size:19px!important}}
      @media(max-width:430px){.proof-quick-day-v16{gap:6px}.proof-quick-day-v16 button{padding:8px 4px}.proof-quick-day-v16 button strong{font-size:11.5px}.proof-v15-editor .proof-editor-route-box{padding:14px 12px!important}.proof-v16-editor-meta-grid{gap:8px;margin-top:12px}.proof-v16-time-grid{grid-template-columns:1fr 1fr;gap:6px}.proof-v16-time-item{padding:8px 6px}.proof-v16-time-item strong{font-size:16px!important}}
    `;
    document.getElementById('proof-v16-style')?.remove();
    document.head.appendChild(style);
  };
  boot();
}
