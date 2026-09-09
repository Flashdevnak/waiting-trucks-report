const VERSION = "20260909-03-lower-reference";
const OWNER_CORRECTION_VERSION = "20260909-04-owner-correction-v10";

// Stable owner correction for the lower MS queue UI. This patch is intentionally
// scoped to ms.js/style.css only and does not change API, MS authority, polling,
// cron, Turso writes, D1, or any mutation path.
const MS_OWNER_CORRECTION_JS = String.raw`
/* MS_OWNER_CORRECTION_V10 */
(function () {
  function phoneDesktopSiteMode() {
    const viewport = Number(window.innerWidth || 0);
    const screenMin = Math.min(
      Number(window.screen && window.screen.width || viewport || 9999),
      Number(window.screen && window.screen.height || viewport || 9999),
    );
    return viewport > 700 && screenMin <= 600;
  }

  function syncDesktopSiteClass() {
    document.documentElement.classList.toggle("ms-desktop-site-phone", phoneDesktopSiteMode());
  }
  syncDesktopSiteClass();
  window.addEventListener("resize", syncDesktopSiteClass, { passive: true });
  window.addEventListener("orientationchange", syncDesktopSiteClass, { passive: true });

  // Desktop-site on a phone must keep the approved desktop table instead of
  // collapsing into the compact card renderer.
  renderRowsProgressively = function ownerRenderRowsProgressively(rows) {
    const generation = ++rowRenderGeneration;
    const mobileLayout = window.matchMedia("(max-width: 1024px)").matches && !phoneDesktopSiteMode();
    const tableBody = el("table-body");
    const mobileCards = el("mobile-cards");
    tableBody.innerHTML = "";
    mobileCards.innerHTML = "";

    const target = mobileLayout ? mobileCards : tableBody;
    const renderer = mobileLayout ? card : tableRow;
    const firstBatch = mobileLayout ? 32 : 64;
    const nextBatch = mobileLayout ? 24 : 64;

    const appendBatch = (start, end) => {
      if (generation !== rowRenderGeneration || start >= rows.length) return;
      target.insertAdjacentHTML("beforeend", rows.slice(start, end).map(renderer).join(""));
    };

    let index = Math.min(firstBatch, rows.length);
    appendBatch(0, index);
    const pump = () => {
      if (generation !== rowRenderGeneration || index >= rows.length) return;
      const end = Math.min(index + nextBatch, rows.length);
      appendBatch(index, end);
      index = end;
      if (index < rows.length) requestAnimationFrame(pump);
    };
    if (index < rows.length) requestAnimationFrame(pump);
  };

  // Keep status graphics semantic and consistent across all operation groups.
  operationIcon = function ownerOperationIcon(kind) {
    const paths = {
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      package: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
      truck: '<path d="M3 7h10v9H3zM13 10h4l4 4v2h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
      pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
      loading: '<path d="M2.5 8h9v8h-9zM11.5 11h4l3 3v2h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="16" cy="18" r="2"/><path d="M22 5h-7m3-3 4 3-4 3"/><path d="M8 5h4v4H8z"/>',
      unload: '<path d="M3 7h10v9H3zM13 10h4l4 4v2h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M22 5h-7m3-3 4 3-4 3"/>',
      release: '<path d="M3 8h10v8H3zM13 11h4l3 3v2h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M15 5h7m-3-3 3 3-3 3"/>',
      worker: '<circle cx="8" cy="5" r="2"/><path d="M6 9h4l2 3 3-1 1 2-5 2-2-3v8M6 10l-2 5"/><path d="M15 8h6v7h-6zM18 8V6M15 11h6"/>',
      warehouse: '<path d="m3 10 9-6 9 6v10H3z"/><path d="M7 13h10v7H7zM9 16h6"/>',
      alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    };
    return '<svg class="operation-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[kind] || paths.clock) + '</svg>';
  };

  operationTimeline = function ownerOperationTimeline(stages, activeIndex) {
    return '<div class="operation-timeline stages-' + stages.length + '">' + stages.map((stage, index) => {
      const stageClass = index < activeIndex ? "is-done" : index === activeIndex ? "is-active" : "is-next";
      return '<span class="operation-stage ' + stageClass + '">' + operationIcon(stage.icon) + '<b>' + stage.label + '</b><small>' + stage.value + '</small></span>';
    }).join('<i aria-hidden="true"></i>') + '</div>';
  };

  operationHeader = function ownerOperationHeader(icon, title, subtitle) {
    return '<header>' + operationIcon(icon) + '<div><strong>' + title + '</strong>' + (subtitle ? '<span>' + subtitle + '</span>' : '') + '</div></header>';
  };

  unloadCompletionCard = function ownerUnloadCompletionCard(row) {
    if (!isDestination(row)) return "";
    const timing = unloadTiming(row);
    const stateKey = routeState(row).key;
    if (!timing.arrival && !timing.start && !timing.finish) return "";
    const active = Number(row.unloadingState) === 1 || stateKey === "unloading";
    const done = Number(row.unloadingState) === 2 || stateKey === "completed";
    const waiting = !active && !done;
    const headline = done ? "โหลดพัสดุลงรถเสร็จสิ้น" : active ? "กำลังลงพัสดุ" : "ถึงปลายทางแล้ว";
    const subtitle = waiting ? "รอเริ่มลงรถ" : active ? "กำลังดำเนินการ" : "";
    const icon = done ? "check" : active ? "worker" : "pin";
    const slaText = timing.slaMinutes === null ? "-" : nf.format(timing.slaMinutes) + " นาที";
    const slaLabel = done ? "ตั้งแต่รถถึงจนลงเสร็จ" : "ตั้งแต่รถถึง";
    const over = timing.overStandard
      ? '<div class="operation-warning">' + operationIcon("alert") + 'เกินมาตรฐาน ' + nf.format(timing.slaMinutes - timing.standard) + ' นาที</div>'
      : active && timing.standard !== null && timing.slaMinutes !== null && timing.slaMinutes > timing.standard
        ? '<div class="operation-warning">' + operationIcon("alert") + 'เกิน SLA ปัจจุบัน ' + nf.format(timing.slaMinutes - timing.standard) + ' นาที</div>'
        : "";
    const timeline = waiting
      ? operationTimeline([
          { icon: "pin", value: timing.arrival ? shortDateTime(timing.arrival) : "-", label: "ถึงปลายทาง" },
          { icon: "worker", value: "รอเริ่ม", label: "เริ่มลงรถ" },
        ], 0)
      : active
        ? operationTimeline([
            { icon: "pin", value: timing.arrival ? shortDateTime(timing.arrival) : "-", label: "มาถึง" },
            { icon: "worker", value: timing.start ? shortDateTime(timing.start) : "กำลังดำเนินการ", label: "กำลังลงพัสดุ" },
          ], 1)
        : operationTimeline([
            { icon: "worker", value: timing.start ? shortDateTime(timing.start) : "-", label: "เริ่มลง" },
            { icon: "check", value: timing.finish ? shortDateTime(timing.finish) : "-", label: "เสร็จจริง" },
          ], 1);
    const work = done && timing.workMinutes !== null
      ? '<div class="operation-work-duration">ใช้เวลาลงจริง <strong>' + nf.format(timing.workMinutes) + ' นาที</strong></div>'
      : "";
    const standardContext = timing.standard === null
      ? "ยังไม่มีมาตรฐานประเภทรถ"
      : active && timing.start
        ? "เริ่มลงรถ " + shortDateTime(timing.start) + " / มาตรฐาน " + nf.format(timing.standard) + " นาที"
        : "มาตรฐาน " + nf.format(timing.standard) + " นาที";
    return '<section class="lower-operation destination-operation ' + (done ? "is-completed" : active ? "is-active" : "is-waiting") + (timing.overStandard ? " is-over" : "") + '">' + operationHeader(icon, headline, subtitle) + '<div class="operation-kpi"><strong>' + slaText + '</strong><span>' + slaLabel + '</span></div><div class="operation-standard">' + standardContext + '</div>' + over + timeline + work + '</section>';
  };

  renderOriginOperation = function ownerRenderOriginOperation(row) {
    const arrival = parseDate(row.actualArrivalAt);
    const departure = parseDate(row.actualDepartureAt);
    const planned = parseDate(row.estimatedDepartureAt);
    if (!arrival && !departure && !planned) return "";
    const now = new Date();
    const stay = arrival && (departure || now) >= arrival ? Math.floor(((departure || now) - arrival) / 60000) : null;
    const releaseDiff = departure && planned ? Math.floor((departure - planned) / 60000) : null;
    const released = Boolean(departure);
    const routeStillLoading = Number(row.unloadingState) === 1 || /กำลัง.*โหลด|loading/i.test(String(row.vehicleStatus || ""));
    const loadingComplete = !released && !routeStillLoading && Number(row.unloadingState) === 2;
    const loading = !released && !loadingComplete;
    const headline = released ? "ออกจาก HUB แล้ว" : loadingComplete ? "โหลดพัสดุขึ้นรถแล้ว" : "กำลังโหลดพัสดุขึ้นรถ";
    const subtitle = loadingComplete ? "รอปล่อยรถ" : loading ? "กำลังนำพัสดุออกจากคลัง" : "";
    const untilRelease = !released && planned ? Math.floor((planned - now) / 60000) : null;
    const detail = released && releaseDiff !== null
      ? '<div class="operation-warning ' + (releaseDiff <= 0 ? "is-ok" : "") + '">' + (releaseDiff > 0 ? "ออกช้า " + nf.format(releaseDiff) + " นาที" : "ออกก่อนแผน " + nf.format(Math.abs(releaseDiff)) + " นาที") + '</div>'
      : untilRelease !== null
        ? '<div class="operation-warning ' + (untilRelease >= 0 ? "is-ok" : "") + '">' + (untilRelease >= 0 ? "เหลือ " + nf.format(untilRelease) + " นาทีถึงกำหนดปล่อย" : "เลยกำหนดปล่อย " + nf.format(Math.abs(untilRelease)) + " นาที") + '</div>'
        : "";
    const timeline = released
      ? operationTimeline([
          { icon: "pin", value: arrival ? shortDateTime(arrival) : "-", label: "มาถึง" },
          { icon: "loading", value: row.unloadingCompletedAt ? shortDateTime(row.unloadingCompletedAt) : "ยืนยันสถานะแล้ว", label: "โหลดขึ้นรถ" },
          { icon: "release", value: shortDateTime(departure), label: "ออกจริง" },
        ], 2)
      : loading
        ? operationTimeline([
            { icon: "loading", value: row.scheduleUnloadingStartedAt ? shortDateTime(row.scheduleUnloadingStartedAt) : arrival ? shortDateTime(arrival) : "-", label: "เริ่มโหลด" },
            { icon: "loading", value: "กำลังดำเนินการ", label: "กำลังโหลดขึ้นรถ" },
            { icon: "release", value: "รอขั้นถัดไป", label: "รอปล่อย" },
          ], 1)
        : operationTimeline([
            { icon: "loading", value: row.unloadingCompletedAt ? shortDateTime(row.unloadingCompletedAt) : "ยืนยันโหลดเสร็จ", label: "โหลดขึ้นรถแล้ว" },
            { icon: "release", value: "รอปล่อยรถ", label: "รอปล่อย" },
            { icon: "release", value: planned ? shortDateTime(planned) : "-", label: "กำหนดออก" },
          ], 1);
    const headerIcon = released || loadingComplete ? "release" : "loading";
    return '<section class="lower-operation origin-operation ' + (released ? "is-released" : loading ? "is-loading" : "is-wait-release") + '">' + operationHeader(headerIcon, headline, subtitle) + (stay !== null ? '<div class="operation-kpi"><strong>' + nf.format(stay) + ' นาที</strong><span>' + (released ? "เวลาที่อยู่ในคลัง" : loading ? "ตั้งแต่รถถึงคลัง" : "อยู่ในคลังแล้ว") + '</span></div>' : "") + detail + timeline + '</section>';
  };

  renderDropOperation = function ownerRenderDropOperation(row) {
    const arrival = parseDate(row.actualArrivalAt);
    const departure = parseDate(row.actualDepartureAt);
    if (!arrival) return "";
    const minutes = Math.floor(((departure || new Date()) - arrival) / 60000);
    if (minutes < 0) return "";
    const active = !departure && Number(row.unloadingState) === 1;
    const released = Boolean(departure);
    const started = parseDate(row.scheduleUnloadingStartedAt);
    const headline = released ? "ออกต่อจากจุดดรอปแล้ว" : active ? "กำลังจัดการพัสดุที่จุดดรอป" : "ถึงจุดดรอปแล้ว";
    const subtitle = !released && !active ? "รอเริ่มดำเนินการ" : active ? "กำลังดำเนินการ" : "";
    const timeline = operationTimeline([
      { icon: "pin", value: shortDateTime(arrival), label: "ถึงจุดดรอป" },
      { icon: "worker", value: started ? shortDateTime(started) : active ? "กำลังดำเนินการ" : "รอเริ่ม", label: "ดำเนินการ" },
      { icon: "release", value: released ? shortDateTime(departure) : "รอออกต่อ", label: "ออกต่อ" },
    ], released ? 2 : active ? 1 : 0);
    const headerIcon = released ? "release" : active ? "worker" : "pin";
    return '<section class="lower-operation drop-operation ' + (released ? "is-released" : active ? "is-active" : "is-waiting") + '">' + operationHeader(headerIcon, headline, subtitle) + '<div class="operation-kpi"><strong>' + nf.format(minutes) + ' นาที</strong><span>เวลาที่อยู่ ณ จุดดรอป</span></div>' + timeline + '<div class="operation-work-duration">ใช้เวลาที่จุดดรอป <strong>' + nf.format(minutes) + ' นาที</strong></div></section>';
  };

  // Make overtime summary count use the same completed-today dataset as the
  // table. The completed dataset is loaded once per branch/day/total change;
  // there is no extra MS polling and repeated 4-second live polls reuse cache.
  const ownerBaseLoadData = loadData;
  let completedSummaryToken = "";
  let completedSummaryPromise = null;
  async function ownerSyncCompletedSummary() {
    if (!state.auth) return;
    const token = [state.branch, bangkokDateValue(new Date()), Number(state.completedToday) || 0].join("|");
    if (completedSummaryToken === token) return;
    if (completedSummaryPromise) return completedSummaryPromise;
    completedSummaryPromise = (async () => {
      await loadCompletedTodayRows();
      completedSummaryToken = [state.branch, bangkokDateValue(new Date()), Number(state.completedToday) || 0].join("|");
      render();
    })().catch(() => {}).finally(() => { completedSummaryPromise = null; });
    return completedSummaryPromise;
  }
  loadData = async function ownerLoadData() {
    const result = await ownerBaseLoadData.apply(this, arguments);
    if (state.auth) void ownerSyncCompletedSummary();
    return result;
  };

  // Status filter context must be part of the overtime card count just like it
  // is part of the rendered rows.
  matchesOvertimeContext = function ownerMatchesOvertimeContext(row) {
    const haystack = [row.proofId, row.routeName, row.vehicleType, row.plate, row.driverName, row.supplier].join(" ").toLowerCase();
    const day = rowBusinessDay(row);
    const status = routeState(row);
    const statusMatch = state.status === "all" ||
      state.status === "unload-overtime" ||
      status.key === state.status ||
      (state.status === "arrival-ontime" && isDestination(row) && punctuality(row).key === "ontime") ||
      (state.status === "arrival-late" && status.arrivalLate) ||
      (state.status === "departure-ontime" && isOrigin(row) && punctuality(row).key === "ontime") ||
      (state.status === "departure-late" && status.departureLate);
    return (!state.query || haystack.includes(state.query)) &&
      (!state.dateFrom || day >= state.dateFrom) && (!state.dateTo || day <= state.dateTo) &&
      (state.attendance === "all" || normalizeAttendance(row.attendanceType) === state.attendance) &&
      (state.attribute === "all" || row.routeAttribute === state.attribute) &&
      (state.region === "all" || row.region === state.region) &&
      (state.route === "all" || row.routeType === state.route) &&
      statusMatch;
  };

  window.addEventListener("resize", () => {
    if (state && state.auth && Array.isArray(state.rows) && state.rows.length) render();
  }, { passive: true });
})();
`;

const MS_OWNER_CORRECTION_CSS = String.raw`
/* MS_OWNER_CORRECTION_V10 — canonical lower queue palette and geometry. */
.ms-page{
  --owner-yellow:#d79a00;--owner-yellow-soft:#fff7df;
  --owner-violet:#6e4fc2;--owner-violet-soft:#f1edff;
  --owner-blue:#1683d2;--owner-blue-soft:#eaf5ff;
  --owner-green:#15855a;--owner-green-soft:#eaf8f1;
  --owner-red:#d93649;--owner-red-soft:#fff0f2;
  --owner-slate:#64716b;--owner-slate-soft:#f2f5f3;
  --owner-line:#dfe6e2;--owner-ink:#18201b;--owner-muted:#69756d;
}

/* Lower summary cards: one deliberate palette, no competing legacy colors. */
.ms-page #filter-summary{gap:10px;margin:14px 0 18px;overflow-x:auto;overscroll-behavior-inline:contain;padding:2px 1px 6px}
.ms-page #filter-summary button{position:relative;min-width:0;min-height:78px;padding:11px 12px!important;border:1px solid color-mix(in srgb,var(--lower-accent) 36%,#e4e9e6)!important;border-left:3px solid var(--lower-accent)!important;border-radius:12px!important;background:var(--lower-soft)!important;box-shadow:0 4px 14px #21362a0c!important;color:var(--owner-ink)!important;transform:none!important}
.ms-page #filter-summary button .operation-icon{width:20px!important;height:20px!important;padding:7px!important;border-radius:9px!important;background:#fff!important;color:var(--lower-accent)!important;box-shadow:0 2px 8px #23372c12!important}
.ms-page #filter-summary button span{font-size:12px!important;line-height:1.3!important;font-weight:800!important;color:#465049!important}
.ms-page #filter-summary button strong{font-size:28px!important;line-height:1!important;font-weight:900!important;color:#121713!important}
.ms-page #filter-summary button.is-active{border-color:var(--lower-accent)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--lower-accent) 18%,transparent),0 7px 18px #20352a14!important}
.ms-page #filter-summary button.is-active:after{background:var(--lower-accent)!important}
.ms-page #filter-summary .summary-all{--lower-accent:var(--owner-slate);--lower-soft:var(--owner-slate-soft)}
.ms-page #filter-summary .summary-wait{--lower-accent:#d79a00;--lower-soft:#fff8e7}
.ms-page #filter-summary .summary-work{--lower-accent:#287ec4;--lower-soft:#edf7ff}
.ms-page #filter-summary .summary-done{--lower-accent:var(--owner-green);--lower-soft:var(--owner-green-soft)}
.ms-page #filter-summary .summary-origin{--lower-accent:var(--owner-violet);--lower-soft:var(--owner-violet-soft)}
.ms-page #filter-summary .summary-overtime{--lower-accent:var(--owner-red);--lower-soft:var(--owner-red-soft)}
.ms-page #filter-summary .summary-drop{--lower-accent:var(--owner-blue);--lower-soft:var(--owner-blue-soft)}
.ms-page #filter-summary .summary-cancelled{--lower-accent:#858e89;--lower-soft:#f1f3f2}

/* Table surface and cells. Yellow is reserved for destination identity/warnings, not row wash. */
.ms-page .ms-table{background:#fff!important}
.ms-page .ms-table thead th{background:#171918!important;color:#fff!important;border-color:#3a3e3b!important;text-align:center!important;font-size:13px!important;font-weight:900!important;padding:13px 10px!important}
.ms-page .ms-table tbody tr,.ms-page .ms-table tbody tr:nth-child(even),.ms-page .ms-table tbody tr.is-unloading{background:#fff!important;box-shadow:none!important}
.ms-page .ms-table tbody tr:hover td,.ms-page .ms-table tbody tr:nth-child(even):hover td,.ms-page .ms-table tbody tr.is-unloading:hover td{background:#f7faf8!important;box-shadow:none!important}
.ms-page .ms-table tbody td{background:#fff!important;border-color:#e4e9e6!important;text-align:center!important;vertical-align:middle!important;color:var(--owner-ink)!important;font-size:13px!important;padding:15px 12px!important}
.ms-page .route-summary,.ms-page .route-meta,.ms-page .attendance-cell,.ms-page .work-summary,.ms-page .people-summary{align-items:center!important;text-align:center!important}
.ms-page .route-title{font-size:14px!important;line-height:1.45!important;font-weight:900!important}
.ms-page .route-plate,.ms-page .row-muted,.ms-page .people-summary span{font-size:12px!important;color:var(--owner-muted)!important}
.ms-page .route-meta-grid .meta-chip{border:1px solid #d8e0dc!important;background:#f5f8f6!important;color:#2c3630!important;font-size:12px!important;font-weight:800!important;box-shadow:none!important}
.ms-page .route-meta-grid b{font-size:11px!important;color:#6a756d!important}

/* Work type identity is stable: destination yellow, origin violet, drop blue. */
.ms-page .attendance-cell .type-badge{min-width:82px!important;justify-content:center!important;border-radius:999px!important;padding:6px 10px!important;font-size:12px!important;font-weight:900!important;box-shadow:none!important}
.ms-page .attendance-cell .type-badge::before{display:none!important;content:none!important}
.ms-page .attendance-cell .type-badge.inbound{border:1px solid #e5ba46!important;background:#fff1b8!important;color:#6f5100!important}
.ms-page .attendance-cell .type-badge.outbound{border:1px solid #cdbcf2!important;background:#eee7ff!important;color:#6543ac!important}
.ms-page .attendance-cell .type-badge.drop{border:1px solid #acd8f5!important;background:#dff2ff!important;color:#126ba8!important}

/* Arrival is one integrated neutral card; KIT/TBR are secondary and readable. */
.ms-page .schedule-stack.single{border:1px solid #dce5e1!important;border-radius:13px!important;background:#fff!important;box-shadow:0 5px 18px #17324a0d!important;overflow:hidden!important}
.ms-page .schedule-stack.single .schedule-section.arrival{background:linear-gradient(180deg,#f1f6f8 0,#fff 58%)!important;border:0!important;box-shadow:none!important}
.ms-page .schedule-stack.single .schedule-heading{background:transparent!important;color:#25312a!important;font-size:13px!important;font-weight:900!important;padding:10px 12px!important}
.ms-page .schedule-stack.single .schedule-values b{font-size:11px!important;color:#748078!important}
.ms-page .schedule-stack.single .schedule-values strong{font-size:14px!important;line-height:1.4!important;white-space:nowrap!important;color:#151b17!important}
.ms-page .schedule-stack.single .timing-chip{font-size:11px!important;font-weight:900!important}
.ms-page .schedule-stack.single .arrival-system-row{background:#f7faf8!important;border-top:1px solid #e8eeea!important}
.ms-page .arrival-system-row>b{font-size:11px!important;color:#6b776f!important;padding:7px 10px 4px!important}
.ms-page .arrival-system-row>div{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important;padding:3px 8px 9px!important}
.ms-page .arrival-system-row>div span{padding:5px 7px!important;font-size:11px!important;line-height:1.25!important;color:#7a867e!important;white-space:nowrap!important}
.ms-page .arrival-system-row>div span+span{border-left:1px solid #e2e9e5!important}
.ms-page .arrival-system-row strong{font-size:12px!important;line-height:1.35!important;font-weight:900!important;color:#1f2822!important;white-space:nowrap!important;overflow-wrap:normal!important;word-break:normal!important}

/* Operation cards share one structure; group identity is never mixed. */
.ms-page .lower-operation{--op-accent:var(--owner-slate);--op-soft:var(--owner-slate-soft);position:relative!important;width:100%!important;border:1px solid color-mix(in srgb,var(--op-accent) 25%,#dfe6e2)!important;border-radius:13px!important;background:#fff!important;box-shadow:0 5px 18px #17324a0d!important;overflow:hidden!important;text-align:center!important}
.ms-page .lower-operation:before{content:""!important;position:absolute!important;inset:0 auto 0 0!important;width:3px!important;background:var(--op-accent)!important;opacity:.9!important}
.ms-page .lower-operation>header{display:flex!important;align-items:center!important;justify-content:center!important;gap:9px!important;padding:10px 11px!important;border:0!important;border-bottom:1px solid color-mix(in srgb,var(--op-accent) 14%,#eef2ef)!important;background:var(--op-soft)!important;color:var(--op-accent)!important;font-size:14px!important;line-height:1.3!important}
.ms-page .lower-operation>header>div{display:grid!important;gap:1px!important;text-align:left!important}
.ms-page .lower-operation>header strong{font-size:14px!important;font-weight:900!important}
.ms-page .lower-operation>header span{font-size:12px!important;font-weight:700!important;opacity:.86!important}
.ms-page .lower-operation>header>.operation-icon{box-sizing:content-box!important;width:19px!important;height:19px!important;padding:6px!important;border-radius:9px!important;background:#fff!important;box-shadow:0 2px 7px #18312710!important}
.ms-page .operation-kpi{gap:3px!important;padding:13px 10px 6px!important}
.ms-page .operation-kpi>strong{font-size:31px!important;line-height:1.05!important;font-weight:900!important;letter-spacing:-.035em!important;color:#151b17!important}
.ms-page .operation-kpi>span{font-size:12px!important;font-weight:800!important;color:#5f6c64!important}
.ms-page .operation-standard{padding:0 9px 10px!important;font-size:11px!important;line-height:1.35!important;font-weight:700!important;color:#7b867f!important}
.ms-page .operation-warning{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;margin:0 auto 10px!important;padding:6px 10px!important;border:1px solid #f0c4ca!important;border-radius:999px!important;background:var(--owner-red-soft)!important;color:#b12d40!important;font-size:11px!important;font-weight:900!important}
.ms-page .operation-warning.is-ok{border-color:#c9e5d5!important;background:#eef9f3!important;color:#187049!important}
.ms-page .operation-warning .operation-icon{width:14px!important;height:14px!important}
.ms-page .operation-work-duration{margin:0 10px 10px!important;padding:7px 9px!important;border:0!important;border-radius:8px!important;background:var(--op-soft)!important;color:#5f6b64!important;font-size:11px!important;font-weight:700!important}
.ms-page .operation-work-duration strong{color:var(--op-accent)!important}

/* Group color contract. Overtime alone may override destination with red. */
.ms-page .destination-operation,.ms-page .destination-operation.is-waiting,.ms-page .destination-operation.is-active,.ms-page .destination-operation.is-completed{--op-accent:var(--owner-yellow)!important;--op-soft:var(--owner-yellow-soft)!important}
.ms-page .destination-operation.is-over{--op-accent:var(--owner-red)!important;--op-soft:var(--owner-red-soft)!important;border-color:#efc5cb!important}
.ms-page .destination-operation.is-over .operation-kpi>strong{color:#b92f42!important}
.ms-page .origin-operation,.ms-page .origin-operation.is-loading,.ms-page .origin-operation.is-wait-release,.ms-page .origin-operation.is-released{--op-accent:var(--owner-violet)!important;--op-soft:var(--owner-violet-soft)!important}
.ms-page .drop-operation,.ms-page .drop-operation.is-waiting,.ms-page .drop-operation.is-active,.ms-page .drop-operation.is-released{--op-accent:var(--owner-blue)!important;--op-soft:var(--owner-blue-soft)!important}

/* Timeline: stage icon is the graphic, connectors are secondary, no generic dot-only state. */
.ms-page .operation-timeline{display:grid!important;align-items:start!important;gap:5px!important;margin:0 10px 10px!important;padding:10px 9px!important;border:0!important;border-radius:10px!important;background:#f8faf9!important}
.ms-page .operation-timeline.stages-2{grid-template-columns:minmax(0,1fr) 58px minmax(0,1fr)!important}
.ms-page .operation-timeline.stages-3{grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr) 36px minmax(0,1fr)!important}
.ms-page .operation-stage{display:grid!important;justify-items:center!important;align-content:start!important;gap:3px!important;min-width:0!important;color:#7a857e!important;font-size:11px!important;font-weight:800!important}
.ms-page .operation-stage>.operation-icon{box-sizing:content-box!important;width:20px!important;height:20px!important;padding:6px!important;border:1px solid color-mix(in srgb,var(--op-accent) 18%,#e1e7e3)!important;border-radius:10px!important;background:#fff!important;color:#87918a!important;box-shadow:0 2px 6px #17324a0b!important}
.ms-page .operation-stage.is-done>.operation-icon{color:var(--op-accent)!important;background:color-mix(in srgb,var(--op-soft) 72%,#fff)!important}
.ms-page .operation-stage.is-active>.operation-icon{color:var(--op-accent)!important;border-color:color-mix(in srgb,var(--op-accent) 35%,#dfe6e2)!important;background:#fff!important;animation:ms-owner-stage-pulse 1.8s ease-in-out infinite!important}
.ms-page .operation-stage b{font-size:11px!important;line-height:1.25!important;font-weight:900!important;color:#354139!important;overflow-wrap:normal!important}
.ms-page .operation-stage small{font-size:10px!important;line-height:1.25!important;color:#77837b!important;white-space:normal!important}
.ms-page .operation-timeline>i{align-self:start!important;height:2px!important;margin-top:17px!important;border-radius:99px!important;background:#d8e0dc!important;position:relative!important}
.ms-page .operation-stage.is-done+i,.ms-page .operation-stage.is-active+i{background:linear-gradient(90deg,var(--op-accent),color-mix(in srgb,var(--op-accent) 24%,#d8e0dc))!important}
.ms-page .operation-timeline>i:before,.ms-page .operation-timeline>i:after{display:none!important;content:none!important}
@keyframes ms-owner-stage-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--op-accent) 18%,transparent)}50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--op-accent) 8%,transparent)}}
@media(prefers-reduced-motion:reduce){.ms-page .operation-stage.is-active>.operation-icon{animation:none!important}.ms-page #filter-summary button{transition:none!important}}

/* No duplicate completion/status chip outside a complete operation card. */
.ms-page .work-summary:has(.lower-operation)>.queue-label,.ms-page .lower-operation~.queue-label,.ms-page .compact-card:has(.lower-operation)>.queue-label{display:none!important}
.ms-page .people-summary strong{font-size:13px!important;line-height:1.35!important}.ms-page .people-summary span,.ms-page .phone-chip{font-size:12px!important}

/* Request Desktop Site on a phone: preserve desktop table geometry instead of two-column cards. */
html.ms-desktop-site-phone .ms-page #desktop-table:not(.hidden){display:block!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
html.ms-desktop-site-phone .ms-page #mobile-cards:not(.hidden){display:none!important}
html.ms-desktop-site-phone .ms-page .ms-table{min-width:1480px!important;table-layout:fixed!important}
html.ms-desktop-site-phone .ms-page #filter-summary{grid-template-columns:repeat(8,minmax(132px,1fr))!important;min-width:1180px!important}
html.ms-desktop-site-phone .ms-page #filter-summary button{min-height:78px!important}
html.ms-desktop-site-phone .ms-page .ms-table col.col-route{width:19%!important}
html.ms-desktop-site-phone .ms-page .ms-table col.col-meta{width:10%!important}
html.ms-desktop-site-phone .ms-page .ms-table col.col-work{width:8%!important}
html.ms-desktop-site-phone .ms-page .ms-table col.col-schedule{width:32%!important}
html.ms-desktop-site-phone .ms-page .ms-table col.col-status{width:21%!important}
html.ms-desktop-site-phone .ms-page .ms-table col.col-company{width:10%!important}

/* Keep ordinary mobile/tablet card mode readable; this does not affect Desktop Site mode. */
@media(max-width:700px){
  .ms-page #filter-summary{grid-template-columns:repeat(2,minmax(0,1fr))!important;overflow:visible!important}
  .ms-page #filter-summary button{min-height:72px!important;padding:9px 10px!important}
  .ms-page #filter-summary button span{font-size:11px!important}.ms-page #filter-summary button strong{font-size:24px!important}
  .ms-page .lower-operation>header{font-size:14px!important;padding:10px!important}.ms-page .lower-operation>header strong{font-size:14px!important}.ms-page .lower-operation>header span{font-size:12px!important}
  .ms-page .operation-kpi>strong{font-size:30px!important}.ms-page .operation-kpi>span,.ms-page .operation-standard,.ms-page .operation-warning,.ms-page .operation-work-duration{font-size:12px!important}
  .ms-page .operation-timeline,.ms-page .operation-timeline.stages-2,.ms-page .operation-timeline.stages-3{grid-template-columns:1fr!important;gap:6px!important;padding:10px 13px!important}
  .ms-page .operation-timeline>i{justify-self:center!important;width:2px!important;height:14px!important;margin:0!important}
  .ms-page .operation-stage b{font-size:12px!important}.ms-page .operation-stage small{font-size:11px!important}
  .ms-page .arrival-system-row>div span{font-size:11px!important}.ms-page .arrival-system-row strong{font-size:12px!important}
}
`;

async function withOwnerCorrection(response, patch, type) {
  if (!response || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("content-type", type);
  headers.set("cache-control", "no-store");
  headers.set("x-ms-owner-correction", OWNER_CORRECTION_VERSION);
  return new Response((await response.text()) + "\n" + patch, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== "GET") return;
  url.searchParams.set("__fresh", VERSION);
  const fresh = () => fetch(url.toString(), {
    cache: "no-store",
    credentials: event.request.credentials,
    headers: event.request.headers,
    redirect: "follow",
  });
  if (url.pathname.endsWith("/ms.js")) {
    event.respondWith(fresh().then((response) => withOwnerCorrection(response, MS_OWNER_CORRECTION_JS, "application/javascript; charset=utf-8")).catch(() => fetch(event.request)));
    return;
  }
  if (url.pathname.endsWith("/style.css")) {
    event.respondWith(fresh().then((response) => withOwnerCorrection(response, MS_OWNER_CORRECTION_CSS, "text/css; charset=utf-8")).catch(() => fetch(event.request)));
    return;
  }
  event.respondWith(fresh().catch(() => fetch(event.request)));
});
