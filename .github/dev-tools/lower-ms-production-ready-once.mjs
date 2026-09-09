import fs from "node:fs";

function replaceBetween(text, start, end, replacement) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`cannot replace ${start}`);
  return text.slice(0, a) + replacement.trimEnd() + "\n\n" + text.slice(b);
}

let s = fs.readFileSync("ms.js", "utf8");

if (!s.includes("let completedTodayLoadPromise = null;")) {
  s = s.replace(
    "let archiveTotalPromise = null;",
    "let archiveTotalPromise = null;\nlet completedTodayLoadPromise = null;\nlet completedTodayHydratedKey = \"\";\nlet completedTodayRetryAt = 0;",
  );
}

s = s.replace(
  "  archiveTotalPromise = null;\n  state.completedToday = 0;",
  "  archiveTotalPromise = null;\n  completedTodayLoadPromise = null;\n  completedTodayHydratedKey = \"\";\n  completedTodayRetryAt = 0;\n  state.completedToday = 0;",
);
s = s.replace(
  "  state.completedToday = 0;\n  if (state.summary === \"completed\"",
  "  state.completedToday = 0;\n  completedTodayLoadPromise = null;\n  completedTodayHydratedKey = \"\";\n  completedTodayRetryAt = 0;\n  if (state.summary === \"completed\"",
);

const responsive = String.raw`
function isPhoneDesktopSiteLayout(
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0,
  screenWidth = typeof screen !== "undefined" ? screen.width : 0,
  screenHeight = typeof screen !== "undefined" ? screen.height : 0,
) {
  const viewport = Number(viewportWidth) || 0;
  const dimensions = [Number(screenWidth) || 0, Number(screenHeight) || 0].filter((value) => value > 0);
  const physicalMin = dimensions.length ? Math.min(...dimensions) : viewport;
  if (!viewport || !physicalMin) return false;
  return physicalMin <= 600 && viewport >= 900 && viewport >= physicalMin * 1.45;
}

function useMobileCardLayout(
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0,
  screenWidth = typeof screen !== "undefined" ? screen.width : 0,
  screenHeight = typeof screen !== "undefined" ? screen.height : 0,
) {
  const viewport = Number(viewportWidth) || 0;
  return viewport <= 1024 && !isPhoneDesktopSiteLayout(viewport, screenWidth, screenHeight);
}

function renderRowsProgressively(rows) {
  const generation = ++rowRenderGeneration;
  const desktopSitePhone = isPhoneDesktopSiteLayout();
  document.documentElement.classList.toggle("ms-desktop-site-phone", desktopSitePhone);
  const mobileLayout = useMobileCardLayout();
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
    target.insertAdjacentHTML(
      "beforeend",
      rows.slice(start, end).map(renderer).join(""),
    );
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
}`;
s = replaceBetween(s, "function renderRowsProgressively(rows) {", "async function loadCompletedTodayRows()", responsive);

const completed = String.raw`
function completedTodayDatasetKey(total = state.completedToday) {
  return \`${"${state.branch}"}|\${bangkokDateValue(new Date())}|\${Number(total) || 0}\`;
}

function completedTodayDatasetRows() {
  return mergeLatest(state.archiveRows, state.currentRows).filter(isCompletedToday);
}

function completedTodayDatasetReady() {
  const expected = Number(state.completedToday) || 0;
  if (expected === 0) return true;
  return completedTodayHydratedKey === completedTodayDatasetKey(expected) &&
    completedTodayDatasetRows().length >= expected;
}

function shouldHydrateCompletedTodayRows() {
  const expected = Number(state.completedToday) || 0;
  const key = completedTodayDatasetKey(expected);
  const cached = completedTodayDatasetRows();
  if (expected === 0 || cached.length >= expected) {
    completedTodayHydratedKey = key;
    return false;
  }
  if (completedTodayHydratedKey === key || completedTodayLoadPromise?.key === key) return false;
  return Date.now() >= completedTodayRetryAt;
}

async function loadCompletedTodayRows(force = false) {
  const expectedCompleted = Number(state.completedToday) || 0;
  const key = completedTodayDatasetKey(expectedCompleted);
  const cachedCompletedRows = completedTodayDatasetRows();
  if (expectedCompleted === 0 || cachedCompletedRows.length >= expectedCompleted) {
    completedTodayHydratedKey = key;
    return cachedCompletedRows;
  }
  if (completedTodayLoadPromise?.key === key) return completedTodayLoadPromise.promise;
  if (!force && Date.now() < completedTodayRetryAt) return cachedCompletedRows;

  const branch = state.branch;
  const promise = (async () => {
    try {
      const completed = await apiGet("msCompletedToday", { branch });
      if (state.branch !== branch) return [];
      const completedRows = Array.isArray(completed?.rows) ? completed.rows : [];
      state.archiveRows = mergeLatest(
        state.archiveRows.filter((row) => !isCompletedToday(row)),
        completedRows,
      );
      state.rows = mergeLatest(state.archiveRows, state.currentRows);
      state.completedToday = Number(completed?.total) || completedRows.length;
      completedTodayHydratedKey = completedTodayDatasetKey(state.completedToday);
      completedTodayRetryAt = 0;
      return completedRows;
    } catch (error) {
      completedTodayRetryAt = Date.now() + 60_000;
      throw error;
    } finally {
      if (completedTodayLoadPromise?.promise === promise) completedTodayLoadPromise = null;
    }
  })();
  completedTodayLoadPromise = { key, promise };
  return promise;
}`;
s = replaceBetween(s, "async function loadCompletedTodayRows()", "function renderFilterSummary(rows)", completed);

if (!s.includes("function isCompletedTodayOvertime(row")) {
  s = s.replace(
    "function isCompletedUnloadOverStandard(row) {\n  return unloadTiming(row).overStandard;\n}",
    "function isCompletedUnloadOverStandard(row) {\n  return unloadTiming(row).overStandard;\n}\n\nfunction isCompletedTodayOvertime(row, now = new Date()) {\n  return isCompletedToday(row, now) && isCompletedUnloadOverStandard(row);\n}\n\nfunction completedTodayOvertimeRows() {\n  return completedTodayDatasetRows().filter(\n    (row) => isCompletedTodayOvertime(row) && matchesOvertimeContext(row),\n  );\n}",
  );
}

s = s.replace(
  "(state.status === \"unload-overtime\" && isCompletedUnloadOverStandard(row))",
  "(state.status === \"unload-overtime\" && isCompletedTodayOvertime(row))",
);
s = s.replace(
  "(state.summary === \"unload-overtime\" && isCompletedUnloadOverStandard(row))",
  "(state.summary === \"unload-overtime\" && isCompletedTodayOvertime(row))",
);
s = s.replace(
  "  const overtimeSource = mergeLatest(state.archiveRows, state.currentRows);\n  counts.unloadOvertime = overtimeSource.filter(\n    (row) => isCompletedToday(row) && isCompletedUnloadOverStandard(row) && matchesOvertimeContext(row),\n  ).length;",
  "  counts.unloadOvertime = completedTodayOvertimeRows().length;",
);
s = s.replace(
  "${nf.format(counts.unloadOvertime)}</strong></button>",
  "${completedTodayDatasetReady() ? nf.format(counts.unloadOvertime) : \"…\"}</strong></button>",
);
s = s.replaceAll("await loadCompletedTodayRows();", "await loadCompletedTodayRows(true);");

const loadRenderNeedle = "    render();\n    // DEV: archive stays lazy; live polling must never auto-read msArchive.";
if (s.includes(loadRenderNeedle)) {
  s = s.replace(loadRenderNeedle, `    render();
    if (shouldHydrateCompletedTodayRows()) {
      const hydrationBranch = state.branch;
      void loadCompletedTodayRows(false)
        .then(() => {
          if (state.auth && state.branch === hydrationBranch) render();
        })
        .catch(() => {});
    }
    // DEV: completed-today detail hydrates only when the lightweight daily total changes.
    // DEV: archive stays lazy; live polling must never auto-read msArchive.`);
}

const icons = String.raw`
function operationIcon(kind) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    package: '<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    truck: '<path d="M3 7h10v9H3zM13 10h4l4 4v2h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
    loading: '<path d="M3 8h9v8H3zM12 11h4l3 3v2h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="16" cy="18" r="2"/><path d="M8 5h5v4H8zM20 4v6m-3-3 3 3 3-3"/>',
    unload: '<path d="M3 7h10v9H3zM13 10h4l4 4v2h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M18 3v6m-3-3 3 3 3-3"/>',
    release: '<path d="M3 8h10v8H3zM13 11h4l3 3v2h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M15 5h7m-3-3 3 3-3 3"/>',
    worker: '<circle cx="7" cy="5" r="2"/><path d="M5 9h4l2 3 3-1 1 2-5 2-2-3v8M5 10l-2 5"/><path d="M15 8h6v7h-6zM18 8V6M15 11h6"/>',
    warehouse: '<path d="m3 10 9-6 9 6v10H3z"/><path d="M7 13h10v7H7zM9 16h6"/>',
    alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  };
  return `<svg class="operation-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind] || paths.clock}</svg>`;
}`;
s = replaceBetween(s, "function operationIcon(kind) {", "function operationTimeline(stages, activeIndex)", icons);

const destination = String.raw`
function unloadCompletionCard(row) {
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
  const slaText = timing.slaMinutes === null ? "-" : `${nf.format(timing.slaMinutes)} นาที`;
  const slaLabel = done ? "ตั้งแต่รถถึงจนลงเสร็จ" : "ตั้งแต่รถถึง";
  const over = timing.overStandard
    ? `<div class="operation-warning">${operationIcon("alert")}เกินมาตรฐาน ${nf.format(timing.slaMinutes - timing.standard)} นาที</div>`
    : active && timing.standard !== null && timing.slaMinutes !== null && timing.slaMinutes > timing.standard
      ? `<div class="operation-warning">${operationIcon("alert")}เกิน SLA ปัจจุบัน ${nf.format(timing.slaMinutes - timing.standard)} นาที</div>`
      : "";
  const timeline = waiting
    ? operationTimeline([
        { icon: "pin", value: timing.arrival ? shortDateTime(timing.arrival) : "-", label: "ถึงปลายทาง" },
        { icon: "worker", value: "รอเริ่ม", label: "รอเริ่มลง" },
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
    ? `<div class="operation-work-duration">ใช้เวลาลงจริง <strong>${nf.format(timing.workMinutes)} นาที</strong></div>`
    : "";
  const standardContext = timing.standard === null
    ? "ยังไม่มีมาตรฐานประเภทรถ"
    : active && timing.start
      ? `เริ่มลงรถ ${shortDateTime(timing.start)} / มาตรฐาน ${nf.format(timing.standard)} นาที`
      : `มาตรฐาน ${nf.format(timing.standard)} นาที`;
  return `<section class="lower-operation destination-operation ${done ? "is-completed" : active ? "is-active" : "is-waiting"} ${timing.overStandard ? "is-over" : ""}">${operationHeader(icon, headline, subtitle)}<div class="operation-kpi"><strong>${slaText}</strong><span>${slaLabel}</span></div><div class="operation-standard">${standardContext}</div>${over}${timeline}${work}</section>`;
}`;
s = replaceBetween(s, "function unloadCompletionCard(row) {", "function renderOriginOperation(row)", destination);

const origin = String.raw`
function renderOriginOperation(row) {
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
    ? `<div class="operation-warning ${releaseDiff <= 0 ? "is-ok" : ""}">${releaseDiff > 0 ? `ออกช้า ${nf.format(releaseDiff)} นาที` : `ออกก่อนแผน ${nf.format(Math.abs(releaseDiff))} นาที`}</div>`
    : untilRelease !== null
      ? `<div class="operation-warning ${untilRelease >= 0 ? "is-ok" : ""}">${untilRelease >= 0 ? `เหลือ ${nf.format(untilRelease)} นาทีถึงกำหนดปล่อย` : `เลยกำหนดปล่อย ${nf.format(Math.abs(untilRelease))} นาที`}</div>`
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
          { icon: "release", value: "รอขั้นถัดไป", label: "รอขั้นถัดไป" },
        ], 1)
      : operationTimeline([
          { icon: "loading", value: row.unloadingCompletedAt ? shortDateTime(row.unloadingCompletedAt) : "ยืนยันสถานะแล้ว", label: "โหลดขึ้นรถแล้ว" },
          { icon: "clock", value: "รอปล่อย", label: "รอปล่อย" },
          { icon: "release", value: planned ? shortDateTime(planned) : "-", label: "กำหนดออก" },
        ], 1);
  return `<section class="lower-operation origin-operation ${released ? "is-released" : loading ? "is-loading" : "is-wait-release"}">${operationHeader(released ? "release" : "loading", headline, subtitle)}${stay !== null ? `<div class="operation-kpi"><strong>${nf.format(stay)} นาที</strong><span>${released ? "เวลาที่อยู่ในคลัง" : loading ? "ตั้งแต่รถถึง" : "อยู่ในคลังแล้ว"}</span></div>` : ""}${detail}${timeline}</section>`;
}`;
s = replaceBetween(s, "function renderOriginOperation(row) {", "function renderDropOperation(row)", origin);

const drop = String.raw`
function renderDropOperation(row) {
  const arrival = parseDate(row.actualArrivalAt);
  const departure = parseDate(row.actualDepartureAt);
  if (!arrival) return "";
  const minutes = Math.floor(((departure || new Date()) - arrival) / 60000);
  if (minutes < 0) return "";
  const active = !departure && Number(row.unloadingState) === 1;
  const released = Boolean(departure);
  const started = parseDate(row.scheduleUnloadingStartedAt);
  const headline = released ? "ออกต่อจากจุดดรอปแล้ว" : active ? "กำลังจัดการพัสดุที่จุดดรอป" : "ถึงจุดดรอปแล้ว";
  const subtitle = released ? "" : active ? "กำลังดำเนินการ" : "รอเริ่มดำเนินการ";
  const timeline = released
    ? operationTimeline([
        { icon: "warehouse", value: shortDateTime(arrival), label: "ถึงจุดดรอป" },
        { icon: "package", value: started ? shortDateTime(started) : "ดำเนินการแล้ว", label: "ดำเนินการ" },
        { icon: "release", value: shortDateTime(departure), label: "ออกต่อ" },
      ], 2)
    : active
      ? operationTimeline([
          { icon: "warehouse", value: shortDateTime(arrival), label: "ถึงจุดดรอป" },
          { icon: "package", value: started ? shortDateTime(started) : "กำลังดำเนินการ", label: "กำลังดำเนินการ" },
          { icon: "release", value: "รอออกต่อ", label: "ออกต่อ" },
        ], 1)
      : operationTimeline([
          { icon: "warehouse", value: shortDateTime(arrival), label: "ถึงจุดดรอป" },
          { icon: "package", value: "รอดำเนินการ", label: "รอดำเนินการ" },
          { icon: "release", value: "รอออกต่อ", label: "ออกต่อ" },
        ], 0);
  return `<section class="lower-operation drop-operation ${released ? "is-released" : active ? "is-active" : "is-waiting"}">${operationHeader(released ? "release" : active ? "package" : "warehouse", headline, subtitle)}<div class="operation-kpi"><strong>${nf.format(minutes)} นาที</strong><span>เวลาที่อยู่ ณ จุดดรอป</span></div>${timeline}<div class="operation-work-duration">ใช้เวลาที่จุดดรอป <strong>${nf.format(minutes)} นาที</strong></div></section>`;
}`;
s = replaceBetween(s, "function renderDropOperation(row) {", "function renderOperation(row)", drop);

fs.writeFileSync("ms.js", s);

let css = fs.readFileSync("style.css", "utf8");
const lowerStart = css.indexOf("/* MS summary performance */");
if (lowerStart < 0) throw new Error("Lower CSS start marker missing");
const prefix = css.slice(0, lowerStart).trimEnd();
const canonical = String.raw`
/* MS_LOWER_CANONICAL_V11: one production visual system below frozen upper metrics. */
.ms-page{--ms-destination:#c88700;--ms-destination-soft:#fff6dc;--ms-origin:#6d55b4;--ms-origin-soft:#f3effc;--ms-drop:#1978ba;--ms-drop-soft:#eaf5fd;--ms-success:#238a57;--ms-success-soft:#eaf7f0;--ms-danger:#c43d4f;--ms-danger-soft:#fdeff1;--ms-neutral:#66727a;--ms-neutral-soft:#f2f4f5;--ms-line:#e2e6e8;--ms-ink:#20262b}
.ms-page #filter-summary{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:10px;margin:14px 0 18px}
.ms-page #filter-summary button{--card-accent:var(--ms-neutral);--card-soft:var(--ms-neutral-soft);position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;min-width:0;min-height:78px;padding:12px 13px;border:1px solid color-mix(in srgb,var(--card-accent) 22%,#e2e6e8);border-radius:12px;background:linear-gradient(145deg,#fff 12%,var(--card-soft));color:var(--ms-ink);box-shadow:0 3px 12px #1b2b360c;text-align:left;cursor:pointer}
.ms-page #filter-summary button:before{content:"";position:absolute;inset:11px auto 11px 0;width:3px;border-radius:0 4px 4px 0;background:var(--card-accent)}
.ms-page #filter-summary button .operation-icon{width:21px;height:21px;padding:6px;border-radius:9px;background:#ffffffd9;color:var(--card-accent)}
.ms-page #filter-summary button span{min-width:0;color:#49535a;font-size:12px;font-weight:750;line-height:1.3;text-align:left}
.ms-page #filter-summary button strong{min-width:28px;color:#151a1e;font-size:27px;font-weight:900;line-height:1;text-align:right;font-variant-numeric:tabular-nums}
.ms-page #filter-summary button:hover{border-color:color-mix(in srgb,var(--card-accent) 45%,#d9dfe2);box-shadow:0 6px 16px #1b2b3614}
.ms-page #filter-summary button:focus-visible{outline:3px solid #151515;outline-offset:2px}
.ms-page #filter-summary button.is-active{border-color:var(--card-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--card-accent) 18%,transparent),0 6px 16px #1b2b3614}
.ms-page #filter-summary .summary-all{--card-accent:#647078;--card-soft:#f2f4f5}.ms-page #filter-summary .summary-wait{--card-accent:#c88700;--card-soft:#fff6dc}.ms-page #filter-summary .summary-work{--card-accent:#397eb2;--card-soft:#eaf4fb}.ms-page #filter-summary .summary-done{--card-accent:#27865a;--card-soft:#eaf7f0}.ms-page #filter-summary .summary-origin{--card-accent:#6d55b4;--card-soft:#f3effc}.ms-page #filter-summary .summary-overtime{--card-accent:#c43d4f;--card-soft:#fdeff1}.ms-page #filter-summary .summary-drop{--card-accent:#1978ba;--card-soft:#eaf5fd}.ms-page #filter-summary .summary-cancelled{--card-accent:#7b858c;--card-soft:#f1f3f4}
.ms-page .table-panel{background:#fff}.ms-page .table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}.ms-page .ms-table{width:100%;min-width:1400px;border-collapse:separate;border-spacing:0;background:#fff}
.ms-page .ms-table thead th{background:#1f2428;color:#fff;text-align:center;vertical-align:middle;border-color:#32393e;font-size:12px;font-weight:850;letter-spacing:.01em}.ms-page .ms-table tbody tr,.ms-page .ms-table tbody tr:nth-child(even),.ms-page .ms-table tbody tr.is-unloading{background:#fff}.ms-page .ms-table tbody td{padding:14px 11px;border-color:#e6e9eb;background:#fff;vertical-align:middle}.ms-page .ms-table tbody tr:nth-child(even) td{background:#fcfdfd}.ms-page .ms-table tbody tr:hover td{background:#f4f7f8}
.ms-page .ms-table .col-route{width:24%}.ms-page .ms-table .col-meta{width:12%}.ms-page .ms-table .col-work{width:9%}.ms-page .ms-table .col-schedule{width:19%}.ms-page .ms-table .col-status{width:24%}.ms-page .ms-table .col-company{width:12%}.ms-page .route-summary{text-align:left}.ms-page .route-title{font-size:13px;line-height:1.45}.ms-page .route-code strong{font-size:14px}.ms-page .attendance-cell,.ms-page .schedule-stack.single,.ms-page .work-summary{text-align:center}
.ms-page .type-badge{display:inline-flex;align-items:center;justify-content:center;min-width:82px;padding:7px 11px;border:1px solid transparent;border-radius:999px;font-size:12px;font-weight:850;line-height:1.15}.ms-page .type-badge.inbound{border-color:#e8c46b;background:var(--ms-destination-soft);color:#765000}.ms-page .type-badge.outbound{border-color:#c9bce9;background:var(--ms-origin-soft);color:#4f3a94}.ms-page .type-badge.drop{border-color:#afd3eb;background:var(--ms-drop-soft);color:#0f5f92}
.ms-page .schedule-stack.single{gap:0;overflow:hidden;border:1px solid #dfe4e7;border-radius:12px;background:#fff;box-shadow:0 3px 12px #1b2b360b}.ms-page .schedule-stack.single .schedule-section.arrival{margin:0;padding:0 0 11px;border:0;border-radius:0;background:linear-gradient(180deg,#f7f9fa,#fff 58%);box-shadow:none}.ms-page .schedule-stack.single .schedule-heading{padding:10px 12px 5px;border:0;background:transparent;color:#30383e;font-size:14px;font-weight:850}.ms-page .schedule-stack.single .schedule-values{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:7px 12px 2px}.ms-page .schedule-stack.single .schedule-values:after{content:"";position:absolute;left:50%;top:9px;bottom:4px;width:1px;background:#e8ecee}.ms-page .schedule-stack.single .schedule-values>span{min-width:0;padding:0;border:0}.ms-page .schedule-stack.single .schedule-values>span+span{border:0}.ms-page .schedule-stack.single .schedule-values b{display:block;margin:0 0 4px;color:#778188;font-size:12px;font-weight:750}.ms-page .schedule-stack.single .schedule-values strong{display:block;color:#1f2529;font-size:15px;line-height:1.35;font-weight:900;font-variant-numeric:tabular-nums;white-space:normal;word-break:normal}.ms-page .schedule-stack.single .timing-chip{display:table;margin:9px auto 0;padding:5px 10px;border-radius:999px;font-size:12px}.ms-page .schedule-stack.single .arrival-system-row{margin:0;border:0;border-top:1px solid #e7ebed;background:#f7f9fa}.ms-page .arrival-system-row>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;padding:5px 6px 8px}.ms-page .arrival-system-row>div span{display:flex;min-width:0;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;padding:5px 6px;border:0;color:#707b82;font-size:12px;font-weight:750;line-height:1.25}.ms-page .arrival-system-row>div span+span{border-left:1px solid #e7ebed}.ms-page .arrival-system-row em{font-style:normal;font-size:12px;font-weight:850;color:#5c6870}.ms-page .arrival-source-value{display:flex;min-width:0;flex-direction:column;gap:1px;color:#20272c;font-size:13px;font-weight:850;line-height:1.25;white-space:nowrap;word-break:normal;overflow-wrap:normal;font-variant-numeric:tabular-nums}.ms-page .arrival-system-row.is-empty{min-height:44px}
.ms-page .lower-operation{--op-accent:var(--ms-neutral);--op-soft:var(--ms-neutral-soft);position:relative;width:100%;overflow:hidden;border:1px solid color-mix(in srgb,var(--op-accent) 20%,#dfe4e7);border-radius:12px;background:#fff;color:var(--ms-ink);text-align:center;box-shadow:0 4px 14px #1b2b360d}.ms-page .lower-operation:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--op-accent)}.ms-page .destination-operation{--op-accent:var(--ms-destination);--op-soft:var(--ms-destination-soft)}.ms-page .origin-operation{--op-accent:var(--ms-origin);--op-soft:var(--ms-origin-soft)}.ms-page .drop-operation{--op-accent:var(--ms-drop);--op-soft:var(--ms-drop-soft)}
.ms-page .lower-operation>header{display:flex;align-items:center;justify-content:center;gap:9px;padding:11px 12px;border:0;border-bottom:1px solid color-mix(in srgb,var(--op-accent) 14%,#e6e9eb);background:linear-gradient(100deg,var(--op-soft),#fff);color:var(--op-accent)}.ms-page .lower-operation>header>.operation-icon{width:20px;height:20px;flex:0 0 auto;padding:5px;border-radius:8px;background:#fff}.ms-page .lower-operation>header>div{display:grid;gap:2px;text-align:left}.ms-page .lower-operation>header>div>strong{font-size:15px;line-height:1.25}.ms-page .lower-operation>header>div>span{color:#5f686e;font-size:13px;font-weight:700;line-height:1.3}.ms-page .operation-kpi{display:grid;gap:3px;padding:13px 10px 6px}.ms-page .operation-kpi>strong{color:#171c20;font-size:32px;font-weight:900;line-height:1.05;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.ms-page .operation-kpi>span{color:#59636a;font-size:13px;font-weight:700}.ms-page .operation-standard{padding:0 10px 10px;color:#6d777e;font-size:12px;font-weight:700}.ms-page .operation-warning{display:inline-flex;align-items:center;justify-content:center;gap:5px;margin:0 auto 10px;padding:6px 10px;border:1px solid #efbcc3;border-radius:999px;background:var(--ms-danger-soft);color:#aa2d3e;font-size:12px;font-weight:850}.ms-page .operation-warning .operation-icon{width:15px;height:15px}.ms-page .operation-warning.is-ok{border-color:#b9ddca;background:var(--ms-success-soft);color:#1d744b}.ms-page .destination-operation.is-over{border-color:#e7b5bc}.ms-page .destination-operation.is-over .operation-kpi>strong{color:var(--ms-danger)}.ms-page .destination-operation.is-completed>header .operation-icon,.ms-page .origin-operation.is-released>header .operation-icon,.ms-page .drop-operation.is-released>header .operation-icon{color:var(--ms-success)}
.ms-page .operation-timeline{display:grid;align-items:center;gap:5px;margin:0 10px 10px;padding:10px 9px;border-radius:10px;background:#f7f9fa}.ms-page .operation-timeline.stages-2{grid-template-columns:minmax(0,1fr) 34px minmax(0,1fr)}.ms-page .operation-timeline.stages-3{grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr) 26px minmax(0,1fr)}.ms-page .operation-stage{display:flex;min-width:0;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#7a848a;text-align:center}.ms-page .operation-stage .operation-icon{width:20px;height:20px;padding:4px;border-radius:50%;background:#fff;color:#879198;box-shadow:0 0 0 1px #dfe4e7}.ms-page .operation-stage b{color:#354047;font-size:12px;font-weight:850;line-height:1.25}.ms-page .operation-stage small{color:#747f86;font-size:11px;font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums}.ms-page .operation-stage.is-active .operation-icon{color:var(--op-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--op-accent) 30%,#fff);animation:ms-operation-pulse 1.8s ease-in-out infinite}.ms-page .operation-stage.is-done .operation-icon{color:var(--ms-success);box-shadow:0 0 0 1px #b9ddca}.ms-page .operation-stage.is-done b{color:#296847}.ms-page .operation-timeline>i{position:relative;height:2px;border-radius:99px;background:color-mix(in srgb,var(--op-accent) 42%,#d9dfe2)}.ms-page .operation-work-duration{margin:0 10px 10px;padding:8px 9px;border-radius:8px;background:var(--op-soft);color:#59646b;font-size:12px;font-weight:700}.ms-page .operation-work-duration strong{color:#283238}
@keyframes ms-operation-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}@media(prefers-reduced-motion:reduce){.ms-page .operation-stage.is-active .operation-icon{animation:none;transform:none}}
@media(min-width:1201px){.ms-page #filter-summary{grid-template-columns:repeat(8,minmax(0,1fr))}.ms-page #desktop-table{display:block}.ms-page #mobile-cards{display:none}}@media(min-width:701px) and (max-width:1200px){.ms-page #filter-summary{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:1024px){.ms-page #desktop-table{display:none}.ms-page #mobile-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ms-page .compact-card{min-width:0;max-width:100%;overflow:hidden}.ms-page .compact-card>.lower-operation{width:calc(100% - 24px);margin:0 12px 12px}.ms-page .compact-schedule{padding:12px;background:#f6f8f9}}
@media(max-width:700px){.ms-page #filter-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ms-page #filter-summary button{min-height:72px;padding:10px;grid-template-columns:29px minmax(0,1fr) auto}.ms-page #filter-summary button .operation-icon{width:19px;height:19px;padding:5px}.ms-page #filter-summary button span{font-size:11px}.ms-page #filter-summary button strong{font-size:23px}.ms-page #mobile-cards{grid-template-columns:1fr;gap:10px}.ms-page .compact-card{width:100%;max-width:100%;margin:0;overflow:hidden}.ms-page .operation-timeline{grid-template-columns:1fr!important;gap:6px;padding:10px 12px}.ms-page .operation-timeline>i{width:2px;height:16px;justify-self:center}}
@media(max-width:430px){.ms-page .app-shell{padding-left:8px;padding-right:8px}.ms-page #filter-summary button{min-height:70px;padding:9px 8px}.ms-page .compact-card>.lower-operation{width:calc(100% - 18px);margin-left:9px;margin-right:9px}.ms-page .compact-schedule{padding:10px 9px}.ms-page .arrival-system-row>div span{padding-left:3px;padding-right:3px}.ms-page .arrival-source-value{font-size:12px}}
html.ms-desktop-site-phone .ms-page #desktop-table{display:block;max-width:100%;overflow-x:auto}html.ms-desktop-site-phone .ms-page #mobile-cards{display:none}html.ms-desktop-site-phone .ms-page .ms-table{min-width:1450px}
`;
fs.writeFileSync("style.css", prefix + "\n\n" + canonical.trim() + "\n");

const regression = String.raw`import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
const root=new URL("../../",import.meta.url);
const [front,style,html,sw]=await Promise.all([readFile(new URL("ms.js",root),"utf8"),readFile(new URL("style.css",root),"utf8"),readFile(new URL("ms.html",root),"utf8"),readFile(new URL("sw.js",root),"utf8")]);
const between=(text,a,b)=>{const x=text.indexOf(a),y=text.indexOf(b,x+a.length);assert.ok(x>=0&&y>x,`missing block ${a}`);return text.slice(x,y)};
const visual=style.split("MS_LOWER_CANONICAL_V11")[1]||"";
function loadTiming(){const src=between(front,"function unloadTiming","function isCompletedUnloadOverStandard");const ctx={Date,state:{standards:{"6W":45}},parseDate(v){if(!v)return null;const d=v instanceof Date?v:new Date(v);return Number.isNaN(d.getTime())?null:d},normalizeVehicle(){return "6W"},unloadStandard(){return 45},isDestination(){return true}};vm.createContext(ctx);vm.runInContext(`${src};globalThis.fn=unloadTiming`,ctx);return ctx.fn}
test("frozen upper metric markup and lower eight cards",()=>{assert.equal((html.match(/class="metric-card/g)||[]).length,8);for(const id of ["metric-archive","metric-total","metric-unloading","metric-completed","metric-not-arrived","metric-arrived","metric-departed","metric-within-standard"])assert.match(html,new RegExp(`id="${id}"`));const r=between(front,"function renderFilterSummary(rows)","async function applyMetricFilter");assert.equal((r.match(/data-summary-status=/g)||[]).length,8)});
test("one canonical lower palette",()=>{assert.equal((style.match(/MS_LOWER_CANONICAL_V11/g)||[]).length,1);for(const old of ["MS_LOWER_VISUAL_ACCEPTANCE_V3","MS_OPERATION_PRESENTATION_V4","MS_PRESENTATION_STATE_CORRECTION_V5","MS_LOWER_REFERENCE_V7"])assert.doesNotMatch(style,new RegExp(old));assert.match(visual,/--ms-destination:#c88700/);assert.match(visual,/--ms-origin:#6d55b4/);assert.match(visual,/--ms-drop:#1978ba/);assert.doesNotMatch(visual,/\.metric-card|\.ms-metrics|data-metric/)});
test("work type and operation identity",()=>{assert.match(visual,/type-badge\.inbound[^}]*var\(--ms-destination-soft\)/);assert.match(visual,/type-badge\.outbound[^}]*var\(--ms-origin-soft\)/);assert.match(visual,/type-badge\.drop[^}]*var\(--ms-drop-soft\)/);assert.match(visual,/destination-operation\{--op-accent:var\(--ms-destination\)/);assert.match(visual,/origin-operation\{--op-accent:var\(--ms-origin\)/);assert.match(visual,/drop-operation\{--op-accent:var\(--ms-drop\)/);const over=between(visual,".ms-page .destination-operation.is-over",".ms-page .destination-operation.is-completed");assert.doesNotMatch(over,/--op-accent/)});
test("arrival KIT TBR readable and advisory",()=>{assert.match(visual,/arrival-system-row>div\{display:grid;grid-template-columns:repeat\(3/);assert.match(visual,/arrival-source-value[^}]*font-size:13px/);assert.match(visual,/arrival-source-value[^}]*white-space:nowrap/);const schedule=between(front,"function scheduleSection(row, mode)","function queueInfo");assert.match(schedule,/const actual = incoming\s*\? row\.actualArrivalAt/);assert.equal(loadTiming()({unloadingState:0,scheduleKitArrivalAt:"2026-09-08T23:25:00Z",scheduleTbrArrivalAt:"2026-09-08T23:20:00Z"},new Date("2026-09-08T23:40:00Z")).slaMinutes,null)});
test("171 45 gives 126 and S E stays 46 information only",()=>{const t=loadTiming()({unloadingState:2,actualArrivalAt:"2026-09-08T15:56:00Z",scheduleUnloadingStartedAt:"2026-09-08T18:01:00Z",unloadingCompletedAt:"2026-09-08T18:47:00Z"},new Date("2026-09-08T18:47:00Z"));assert.equal(t.slaMinutes,171);assert.equal(t.workMinutes,46);assert.equal(t.standard,45);assert.equal(t.overStandard,true);assert.equal(t.slaMinutes-t.standard,126)});
test("active current over SLA excluded from completed overtime",()=>{const t=loadTiming()({unloadingState:1,actualArrivalAt:"2026-09-08T17:40:00Z",scheduleUnloadingStartedAt:"2026-09-08T17:50:00Z"},new Date("2026-09-08T18:40:00Z"));assert.equal(t.slaMinutes,60);assert.equal(t.overStandard,false);assert.match(between(front,"function unloadCompletionCard(row)","function renderOriginOperation(row)"),/เกิน SLA ปัจจุบัน/)});
test("overtime card table dropdown share predicate and coalesced data",()=>{assert.match(front,/function isCompletedTodayOvertime\(row, now = new Date\(\)\)[\s\S]*isCompletedToday\(row, now\) && isCompletedUnloadOverStandard\(row\)/);assert.match(front,/counts\.unloadOvertime = completedTodayOvertimeRows\(\)\.length/);assert.match(front,/state\.status === "unload-overtime" && isCompletedTodayOvertime\(row\)/);assert.match(front,/state\.summary === "unload-overtime" && isCompletedTodayOvertime\(row\)/);assert.match(front,/completedTodayLoadPromise\?\.key === key/);assert.match(front,/completedTodayRetryAt = Date\.now\(\) \+ 60_000/);assert.equal((front.match(/apiGet\("msCompletedToday"/g)||[]).length,1)});
test("group copy truth",()=>{const d=between(front,"function unloadCompletionCard(row)","function renderOriginOperation(row)"),o=between(front,"function renderOriginOperation(row)","function renderDropOperation(row)"),p=between(front,"function renderDropOperation(row)","function renderOperation(row)");assert.match(d,/ถึงปลายทางแล้ว/);assert.match(d,/กำลังลงพัสดุ/);assert.match(d,/โหลดพัสดุลงรถเสร็จสิ้น/);assert.doesNotMatch(d,/กำลังโหลดพัสดุขึ้นรถ|รอปล่อยรถ/);assert.match(o,/loadingComplete = !released && !routeStillLoading && Number\(row\.unloadingState\) === 2/);assert.match(o,/กำลังโหลดพัสดุขึ้นรถ/);assert.match(o,/โหลดพัสดุขึ้นรถแล้ว/);assert.match(o,/ออกจาก HUB แล้ว/);assert.doesNotMatch(o,/กำลังลงพัสดุ|ถึงปลายทาง|จุดดรอป/);assert.match(p,/กำลังจัดการพัสดุที่จุดดรอป/);assert.match(p,/ออกต่อจากจุดดรอปแล้ว/);assert.doesNotMatch(p,/รอปล่อยรถ|โหลดพัสดุลงรถเสร็จสิ้น|กำลังโหลดพัสดุขึ้นรถ/);assert.doesNotMatch(d+o+p,/ · | • /)});
test("semantic timeline and motion safety",()=>{assert.match(front,/worker:/);assert.match(front,/loading:/);assert.match(front,/release:/);assert.match(front,/class="operation-stage/);assert.match(visual,/@keyframes ms-operation-pulse/);assert.match(visual,/@media\(prefers-reduced-motion:reduce\)/);assert.doesNotMatch(visual,/setInterval|setTimeout|fetch\(|apiGet\()/)});
test("typography and clean table",()=>{assert.match(visual,/header>div>strong\{font-size:15px/);assert.match(visual,/header>div>span\{color:[^}]*font-size:13px/);assert.match(visual,/operation-kpi>strong\{[^}]*font-size:32px/);assert.match(visual,/operation-stage b\{[^}]*font-size:12px/);assert.match(visual,/operation-stage small\{[^}]*font-size:11px/);assert.match(visual,/ms-table thead th\{background:#1f2428;color:#fff/);assert.match(visual,/tbody tr:hover td\{background:#f4f7f8/);assert.doesNotMatch(visual,/#fffdf5|background:[^;}]*yellow/i)});
test("phone desktop site uses physical signal plus viewport",()=>{const src=between(front,"function isPhoneDesktopSiteLayout(","function renderRowsProgressively(rows)");const ctx={};vm.createContext(ctx);vm.runInContext(`${src};globalThis.desktop=isPhoneDesktopSiteLayout;globalThis.mobile=useMobileCardLayout`,ctx);for(const w of [375,390,412,430])assert.equal(ctx.mobile(w,w,800),true);for(const w of [768,820,1024])assert.equal(ctx.mobile(w,w,1200),true);for(const w of [980,1024]){assert.equal(ctx.desktop(w,390,844),true);assert.equal(ctx.mobile(w,390,844),false)}for(const w of [1280,1366,1440,1920])assert.equal(ctx.mobile(w,390,844),false);assert.doesNotMatch(src,/userAgent|Android|iPhone|Samsung/i);assert.match(visual,/html\.ms-desktop-site-phone \.ms-page #desktop-table\{display:block/)});
test("normal mobile no unintended page overflow",()=>{assert.match(visual,/@media\(max-width:1024px\)[\s\S]*#desktop-table\{display:none\}[\s\S]*#mobile-cards\{display:grid/);assert.match(visual,/@media\(max-width:430px\)/);assert.match(visual,/table-scroll\{max-width:100%;overflow-x:auto/);assert.doesNotMatch(visual,/width:100vw|translateX\(-/)});
test("service worker freshness only",()=>{assert.match(sw,/cache: "no-store"/);assert.doesNotMatch(sw,/MS_JS_HOTFIX|MS_CSS_HOTFIX|String\.raw|appendPatch|MS_OWNER_CORRECTION|style\.textContent/)});
`;
fs.writeFileSync(".github/dev-tools/ms-unload-completion-ui.test.mjs", regression);

const owner = String.raw`import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root=new URL("../../",import.meta.url);
const [front,style,sw]=await Promise.all([readFile(new URL("ms.js",root),"utf8"),readFile(new URL("style.css",root),"utf8"),readFile(new URL("sw.js",root),"utf8")]);
test("owner lower V11 source integrated",()=>{const v=style.split("MS_LOWER_CANONICAL_V11")[1]||"";assert.ok(v);assert.match(v,/--ms-destination:#c88700/);assert.match(v,/--ms-origin:#6d55b4/);assert.match(v,/--ms-drop:#1978ba/);assert.doesNotMatch(v,/\.metric-card|\.ms-metrics/);assert.match(front,/function isPhoneDesktopSiteLayout/);assert.match(front,/function completedTodayOvertimeRows/)});
test("route and overtime truth locked",()=>{assert.match(front,/const arrival = parseDate\(row\.actualArrivalAt\)/);assert.match(front,/overStandard: isDestination\(row\) && completed[\s\S]*slaMinutes > standard/);assert.match(front,/const workMinutes = start && workEnd/);assert.match(front,/state\.status === "unload-overtime" && isCompletedTodayOvertime\(row\)/)});
test("service worker freshness only",()=>{assert.match(sw,/cache: "no-store"/);assert.doesNotMatch(sw,/MS_JS_HOTFIX|MS_CSS_HOTFIX|String\.raw|appendPatch|MS_OWNER_CORRECTION/) });
`;
fs.writeFileSync("worker/tests/ms-owner-live-v8.test.mjs", owner);

console.log("LOWER_SOURCE_CONSOLIDATION=STAGED");
