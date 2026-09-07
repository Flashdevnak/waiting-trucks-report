const VERSION = '20260907-06';

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
    window.__PROOF_V16_READY__ = true; // PROOF_QUICK_DAY_V16 PROOF_LAYOUT_FIX_V16_06 PROOF_QUICK_DAY_SEGMENTED_V16

    const dayInput = P.el('day-filter');
    const dayLabel = dayInput?.closest('label');
    const toolbar = dayInput?.closest('.proof-toolbar');
    const branchLabel = P.el('branch-filter')?.closest('label');
    const searchLabel = P.el('search-input')?.closest('label');
    let supplierRetryTimer = null;
    const printableStates = P.PRINTABLE_STATES || new Set([1,2,7]);

    if (toolbar) toolbar.classList.add('proof-toolbar-v16');
    if (dayLabel) dayLabel.classList.add('proof-day-field-v16');
    if (branchLabel) branchLabel.classList.add('proof-hub-field-v16');
    if (searchLabel) searchLabel.classList.add('proof-search-field-v16');

    const dayOffset = offset => {
      const base = String(P.thaiDay()).split('-').map(Number);
      const value = new Date(Date.UTC(base[0], base[1] - 1, base[2] + Number(offset || 0), 12, 0, 0));
      return value.toISOString().slice(0, 10);
    };

    const syncQuickDays = () => {
      const current = String(dayInput?.value || P.state.day || '');
      document.querySelectorAll('[data-proof-day-offset]').forEach(button => {
        const active = current === dayOffset(Number(button.dataset.proofDayOffset || 0));
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current', 'date');
        else button.removeAttribute('aria-current');
      });
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

    // Compact segmented navigator: keep the three quick-day actions beside the date input.
    if (dayLabel && dayInput && !document.getElementById('proof-quick-day-v16')) {
      let dayRow = dayInput.closest('.proof-day-row-v16');
      if (!dayRow) {
        dayRow = document.createElement('div');
        dayRow.className = 'proof-day-row-v16';
        dayInput.insertAdjacentElement('beforebegin', dayRow);
        dayRow.appendChild(dayInput);
      }

      const quick = document.createElement('div');
      quick.id = 'proof-quick-day-v16';
      quick.className = 'proof-quick-day-v16';
      quick.setAttribute('role', 'group');
      quick.setAttribute('aria-label', 'เลือกวันแบบด่วน');
      quick.innerHTML = [
        [-1,'เมื่อวาน'],
        [0,'วันนี้'],
        [1,'พรุ่งนี้'],
      ].map(([offset,label]) => {
        const value = dayOffset(offset);
        return `<button type='button' data-proof-day-offset='${offset}' aria-label='${label} ${value}' title='${label} ${value}'><strong>${label}</strong></button>`;
      }).join('');
      dayRow.appendChild(quick);
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
      .proof-toolbar-v16{grid-template-columns:minmax(250px,1.45fr) 110px minmax(300px,1.2fr) repeat(4,minmax(125px,.72fr)) auto!important;gap:10px!important;align-items:start!important}
      .proof-toolbar-v16 .proof-search-field-v16{order:1!important;grid-column:auto!important}
      .proof-toolbar-v16 .proof-hub-field-v16{order:2!important}
      .proof-toolbar-v16 .proof-day-field-v16{order:3!important;align-self:start!important;height:auto!important;min-width:0}
      .proof-toolbar-v16 label:not(.proof-search-field-v16):not(.proof-hub-field-v16):not(.proof-day-field-v16){order:4!important}
      .proof-toolbar-v16>#clear-filter-btn{order:5!important;min-height:44px!important;height:44px!important;margin-top:22px!important}
      .proof-toolbar-v16 select,.proof-toolbar-v16 input{height:44px!important;min-height:44px!important;box-sizing:border-box}
      .proof-toolbar-v16 .proof-day-field-v16 #day-filter{height:44px!important;min-height:44px!important;width:100%!important;min-width:0!important}
      .proof-day-row-v16{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(150px,.92fr);gap:6px;align-items:stretch;width:100%;min-width:0}
      .proof-quick-day-v16{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;width:100%;height:44px;min-width:0;box-sizing:border-box;margin:0;border:1px solid #aebbc4;border-radius:8px;overflow:hidden;background:#fff}
      .proof-quick-day-v16 button{min-width:0;max-width:100%;min-height:44px;height:44px;overflow:hidden;border:0;border-left:1px solid #d2d9de;background:#fff;color:#20313e;border-radius:0;padding:0 5px;cursor:pointer;text-align:center;line-height:1;box-sizing:border-box;transition:background .15s ease,color .15s ease,border-color .15s ease}
      .proof-quick-day-v16 button:first-child{border-left:0}
      .proof-quick-day-v16 button strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:900}
      .proof-quick-day-v16 button:hover{background:#fff8cf;color:#4a3d00}.proof-quick-day-v16 button.is-active{background:#151515;color:#ffd400}
      .proof-quick-day-v16 button:focus-visible{position:relative;z-index:2;outline:2px solid #d6b400;outline-offset:-2px}

      /* Column labels stay visible exactly when V15 hides the desktop column header. */
      @media(min-width:1321px){
        .proof-v15-row>.proof-v15-route>small:first-child,
        .proof-v15-row>.proof-v15-cell>small:first-child,
        .proof-v15-row>.proof-v15-status>div:first-child>small:first-child{display:none!important}
      }
      @media(max-width:1320px) and (min-width:761px){
        .proof-v15-row>.proof-v15-route>small:first-child,
        .proof-v15-row>.proof-v15-cell>small:first-child,
        .proof-v15-row>.proof-v15-status>div:first-child>small:first-child{display:block!important;color:#405563!important;font-size:10px!important;font-weight:900!important;margin-bottom:4px!important}
      }

      .proof-v15-tags span{background:#dce5eb!important;border-color:#aebdc7!important;color:#182c3a!important}
      .proof-v15-lane[data-proof-lane='FD'] .proof-v15-lane-head strong{color:#3f3500!important}.proof-v15-lane[data-proof-lane='LH'] .proof-v15-lane-head strong{color:#142838!important}
      .proof-v15-lane-count span{background:#151515!important;border-color:#151515!important;color:#ffd400!important}
      .proof-v15-row .proof-v15-cell.barcode>span,
      .proof-v15-row .proof-v15-cell.time>span,
      .proof-v15-row .proof-v15-cell.driver>span{display:inline-flex!important;align-items:center;max-width:100%;margin-top:6px;padding:3px 8px;border:1px solid #afbec8;border-radius:999px;background:#e7edf1;color:#263b49!important;font-size:10.5px!important;font-weight:800!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proof-v15-row .proof-v15-cell.supplier>strong{font-size:14px!important;color:#142532!important}
      .proof-v15-vehicle span{background:#e4eaee!important;border:1px solid #b7c3cb!important;color:#263945!important;font-weight:800!important}
      .proof-v15-row .proof-v15-status>div:first-child>strong{display:inline-flex!important;align-items:center;justify-content:center;min-height:30px;margin-top:0!important;padding:4px 10px;border-radius:999px;border:1px solid #b89500;background:#ffe47a;color:#3f3000!important;font-size:11.5px!important;font-weight:900!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;text-align:center}
      .proof-v15-row.is-ready .proof-v15-status>div:first-child>strong{background:#d9f1e2;border-color:#76ad89;color:#17472b!important}
      .proof-v15-row.is-missed .proof-v15-status>div:first-child>strong{background:#ffdeda;border-color:#d58f87;color:#7d281f!important}

      .proof-v15-editor .proof-editor-route-box{padding:18px 20px!important;background:#f8fafb!important}
      .proof-v16-editor-hero{width:100%;min-width:0;text-align:center}
      .proof-v16-editor-route-label{font-size:12px;font-weight:800;color:#65727d;margin-bottom:5px}
      .proof-v16-editor-hero #proof-editor-route{display:block;font-size:22px!important;line-height:1.3!important;font-weight:900!important;color:#13212d!important;word-break:break-word;margin:0 auto!important}
      .proof-v16-editor-status-row{display:flex;justify-content:center;align-items:center;margin-top:9px}
      .proof-v16-editor-status{display:inline-flex!important;align-items:center;justify-content:center;min-height:32px;padding:5px 13px;border-radius:999px;border:1px solid #b99400;background:#ffe477;color:#443400!important;font-size:13px!important;font-weight:900!important;line-height:1.2!important;white-space:nowrap}
      .proof-v16-editor-status.is-state-2,.proof-v16-editor-status.is-state-7{background:#dcecff;border-color:#86afd4;color:#153f64!important}
      .proof-v16-editor-status.is-state-3,.proof-v16-editor-status.is-state-4{background:#d9f1e2;border-color:#77ae8a;color:#17472b!important}
      .proof-v16-editor-status.is-state-5,.proof-v16-editor-status.is-state-6{background:#ffdeda;border-color:#d58f87;color:#7d281f!important}
      .proof-v16-editor-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:15px;text-align:left}
      .proof-v16-editor-meta-card{min-width:0;background:#fff;border:1px solid #c3cfd7;border-radius:11px;padding:10px 12px;box-sizing:border-box}
      .proof-v16-editor-meta-card>small{display:block!important;font-size:10.5px!important;font-weight:800!important;color:#52636f!important;margin:0 0 5px!important}
      .proof-v16-editor-meta-card #proof-editor-ms-user{display:block!important;margin:0!important;color:#17232d!important;font-size:14px!important;font-weight:800!important;line-height:1.4!important;white-space:normal!important;word-break:break-word}
      .proof-v16-plan-source{display:none!important}
      .proof-v16-time-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .proof-v16-time-item{min-width:0;padding:9px 10px;border:1px solid #c5d0d7;border-radius:10px;background:#f5f8fa;text-align:center}
      .proof-v16-time-item small{display:block!important;margin:0 0 4px!important;color:#4d5f6c!important;font-size:10.5px!important;font-weight:900!important}
      .proof-v16-time-item strong{display:block;color:#15222c;font-size:18px!important;font-weight:900!important;line-height:1.2!important;white-space:nowrap}
      .proof-v16-time-item.standby{box-shadow:inset 0 4px 0 #58778d}.proof-v16-time-item.release{box-shadow:inset 0 4px 0 #c2a500;background:#fff9dc}

      @media(max-width:1180px){
        .proof-toolbar-v16{grid-template-columns:minmax(220px,1.4fr) 110px minmax(300px,1.25fr) repeat(2,minmax(130px,1fr))!important}
        .proof-toolbar-v16 label:not(.proof-search-field-v16):not(.proof-hub-field-v16):not(.proof-day-field-v16),.proof-toolbar-v16>#clear-filter-btn{order:4!important}
      }
      @media(max-width:760px){
        .proof-toolbar-v16{grid-template-columns:1fr 1fr!important;align-items:start!important}
        .proof-toolbar-v16 .proof-search-field-v16{grid-column:1/-1!important;order:1!important}
        .proof-toolbar-v16 .proof-hub-field-v16{order:2!important}.proof-toolbar-v16 .proof-day-field-v16{order:3!important;width:100%!important}
        .proof-toolbar-v16 label:not(.proof-search-field-v16):not(.proof-hub-field-v16):not(.proof-day-field-v16){order:4!important}
        .proof-toolbar-v16>#clear-filter-btn{order:5!important;margin-top:0!important;align-self:end!important}
        .proof-day-row-v16{grid-template-columns:minmax(0,1.08fr) minmax(145px,.92fr)}
        .proof-quick-day-v16 button strong{font-size:11px}
        .proof-v16-editor-meta-grid{grid-template-columns:1fr}.proof-v16-editor-hero #proof-editor-route{font-size:19px!important}
      }
      @media(max-width:430px){
        .proof-toolbar-v16{grid-template-columns:1fr!important}.proof-toolbar-v16 .proof-search-field-v16,.proof-toolbar-v16 .proof-hub-field-v16,.proof-toolbar-v16 .proof-day-field-v16{grid-column:1!important}
        .proof-day-row-v16{grid-template-columns:minmax(0,1.08fr) minmax(150px,.92fr)}
        .proof-quick-day-v16 button{padding:0 3px}.proof-quick-day-v16 button strong{font-size:10.5px}
        .proof-v15-editor .proof-editor-route-box{padding:14px 12px!important}.proof-v16-editor-meta-grid{gap:8px;margin-top:12px}.proof-v16-time-grid{grid-template-columns:1fr 1fr;gap:6px}.proof-v16-time-item{padding:8px 6px}.proof-v16-time-item strong{font-size:16px!important}
      }
    `;
    document.getElementById('proof-v16-style')?.remove();
    document.head.appendChild(style);
  };
  boot();
}
