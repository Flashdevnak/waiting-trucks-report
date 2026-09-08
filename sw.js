const VERSION="20260909-02";

// MS_OWNER_LIVE_FIX_V8
// Runtime-only presentation patch for the MS Tracking page. It adds no MS/API polling,
// no timers, no database writes, and leaves the frozen upper KPI cards untouched.
const MS_JS_HOTFIX = String.raw`
;(() => {
  const baseUnloadTiming = window.unloadTiming;
  if (typeof baseUnloadTiming === "function") {
    window.unloadTiming = function ownerLiveUnloadTiming(row, now = new Date()) {
      const timing = baseUnloadTiming(row, now);
      const completed = Number(row && row.unloadingState) === 2;
      const arrival = typeof parseDate === "function" ? parseDate(row && row.actualArrivalAt) : null;
      // Waiting and active destination work must keep counting from the Route-authored
      // actual arrival. A completed row still requires its trusted completion timestamp.
      if (!completed && arrival && now >= arrival) {
        const slaMinutes = Math.max(0, Math.floor((now - arrival) / 60000));
        return { ...timing, arrival, slaMinutes, overStandard: false };
      }
      return timing;
    };
  }

  const baseSchedulePunctuality = window.schedulePunctuality;
  if (typeof baseSchedulePunctuality === "function") {
    window.schedulePunctuality = function ownerLiveSchedulePunctuality(row, mode) {
      const result = baseSchedulePunctuality(row, mode);
      if (!result || result.diff === null) return result;
      const incoming = mode === "arrival";
      const diff = Number(result.diff) || 0;
      return {
        ...result,
        label: incoming
          ? diff > 0 ? "รถเข้าช้า" : diff < 0 ? "รถเข้าก่อนเวลา" : "รถเข้าตรงเวลา"
          : diff > 0 ? "ปล่อยรถช้า" : diff < 0 ? "ปล่อยก่อนเวลา" : "ปล่อยตรงเวลา",
      };
    };
  }
})();
`;

const MS_CSS_HOTFIX = String.raw`
/* MS_OWNER_VISUAL_V8 — strict lower-section visual correction. */
.ms-page #filter-summary{gap:12px;margin:12px 0 14px}
.ms-page #filter-summary button{min-height:84px;padding:13px 14px;border:1px solid color-mix(in srgb,var(--lower-accent,#607080) 26%,#dfe6ea);border-radius:14px;background:var(--lower-soft,#f4f7f8);box-shadow:0 5px 16px #17324a10;grid-template-columns:38px minmax(0,1fr) auto;align-items:center}
.ms-page #filter-summary button .operation-icon{width:20px;height:20px;padding:8px;border-radius:10px;background:#fff;box-shadow:0 2px 7px #17324a0c}
.ms-page #filter-summary button span{font-size:12px;font-weight:850;color:#27343d}
.ms-page #filter-summary button strong{font-size:29px;line-height:1;color:#10181e}
.ms-page #filter-summary button.is-active{transform:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--lower-accent,#607080) 22%,transparent),0 7px 20px #17324a14}

.ms-page .schedule-stack.single{border:1px solid #dce4e8;border-radius:15px;background:#fff;box-shadow:0 7px 22px #17324a0d;overflow:hidden}
.ms-page .schedule-stack.single .schedule-section.arrival{padding:0 0 13px;background:#fff}
.ms-page .schedule-stack.single .schedule-heading{padding:11px 14px;background:#eef2f4;color:#17232d;font-size:14px;font-weight:900;text-align:center}
.ms-page .schedule-stack.single .schedule-values{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:15px 14px 7px}
.ms-page .schedule-stack.single .schedule-values:after{top:14px;bottom:7px;background:#e7ecef}
.ms-page .schedule-stack.single .schedule-values b{font-size:11px;color:#72808a;font-weight:800}
.ms-page .schedule-stack.single .schedule-values strong{margin-top:4px;font-size:14px;line-height:1.35;color:#131b21;font-weight:900}
.ms-page .schedule-stack.single .timing-chip{margin:10px auto 0;padding:6px 12px;font-size:11px;font-weight:850;border-radius:999px}
.ms-page .schedule-stack.single .arrival-system-row{margin:0;border:0;border-top:1px solid #e7ecef;border-radius:0;background:#f7f9fa}
.ms-page .schedule-stack.single .arrival-system-row>b{padding:9px 10px 3px;font-size:11px;color:#75828b;text-align:center}
.ms-page .schedule-stack.single .arrival-system-row>div{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important;padding:4px 7px 9px!important}
.ms-page .schedule-stack.single .arrival-system-row>div>span{display:flex!important;flex-direction:column;align-items:center;justify-content:flex-start;gap:3px!important;min-width:0;padding:7px 5px!important;border:0!important;text-align:center;color:#6f7c84;font-size:10px!important}
.ms-page .schedule-stack.single .arrival-system-row>div>span+span{border-left:1px solid #e4e9ec!important}
.ms-page .schedule-stack.single .arrival-system-row em{font-size:10px;font-style:normal;font-weight:850;color:#7c8991}
.ms-page .schedule-stack.single .arrival-system-row .arrival-source-value{display:flex!important;flex-direction:column;gap:1px;align-items:center;font-size:11px!important;line-height:1.3;color:#111a20;font-weight:900;white-space:nowrap}

.ms-page .lower-operation{border:1px solid color-mix(in srgb,var(--op-accent) 18%,#dfe6e8);border-radius:15px;background:#fff;box-shadow:0 7px 22px #17324a10;overflow:hidden}
.ms-page .lower-operation:before{height:3px;inset:0 0 auto;background:var(--op-accent);opacity:.9}
.ms-page .lower-operation>header{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(90deg,var(--op-soft),#fff);text-align:left}
.ms-page .lower-operation>header .operation-icon{width:20px;height:20px;padding:7px;border-radius:10px;background:#fff;box-shadow:0 2px 7px #17324a0c}
.ms-page .lower-operation>header>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.ms-page .lower-operation>header strong{font-size:14px;line-height:1.25;font-weight:900;color:var(--op-accent)}
.ms-page .lower-operation>header span{font-size:12px;line-height:1.3;font-weight:750;color:#68757d}
.ms-page .operation-kpi{padding:14px 14px 4px;text-align:center}
.ms-page .operation-kpi>strong{font-size:34px;line-height:1;font-weight:950;letter-spacing:-.035em;color:#11191e}
.ms-page .operation-kpi>span{margin-top:5px;font-size:12px;line-height:1.35;color:#66737b;font-weight:750}
.ms-page .operation-standard{padding:0 14px 11px;font-size:11px;line-height:1.3;color:#89939a;text-align:center;font-weight:750}
.ms-page .operation-warning{margin:0 auto 11px;padding:6px 10px;font-size:11px;font-weight:850}
.ms-page .operation-timeline,.ms-page .operation-timeline.stages-2{display:grid;grid-template-columns:minmax(0,1fr) 46px minmax(0,1fr);align-items:start;gap:0;margin:3px 13px 12px;padding:12px 10px 10px;border-radius:12px;background:#f7f9fa}
.ms-page .operation-timeline.stages-3{grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr) 24px minmax(0,1fr)}
.ms-page .operation-timeline .operation-stage{display:grid;grid-template-rows:36px auto auto;place-items:center;align-content:start;gap:4px;min-width:0;text-align:center}
.ms-page .operation-timeline .operation-stage .operation-icon{box-sizing:border-box;width:34px;height:34px;padding:7px;border:1px solid #dce4e7;border-radius:11px;background:#fff;color:#8b969d;box-shadow:0 2px 7px #17324a0b}
.ms-page .operation-timeline .operation-stage.is-done .operation-icon,.ms-page .operation-timeline .operation-stage.is-active .operation-icon{border-color:color-mix(in srgb,var(--op-accent) 28%,#dfe6e8);background:var(--op-soft);color:var(--op-accent)}
.ms-page .operation-timeline .operation-stage.is-active .operation-icon{box-shadow:0 0 0 4px color-mix(in srgb,var(--op-accent) 11%,transparent)}
.ms-page .operation-timeline .operation-stage b{max-width:100%;font-size:11px;line-height:1.3;color:#26323a;font-weight:900;overflow-wrap:normal;word-break:normal}
.ms-page .operation-timeline .operation-stage small{max-width:100%;font-size:10px;line-height:1.25;color:#7b878e;font-weight:700}
.ms-page .operation-timeline i{position:relative;align-self:start;width:auto;height:3px;margin-top:16px;border-radius:999px;background:#dce3e7}
.ms-page .operation-timeline .is-done+i,.ms-page .operation-timeline .is-active+i{background:linear-gradient(90deg,var(--op-accent),color-mix(in srgb,var(--op-accent) 35%,#dce3e7))}
.ms-page .operation-work-duration{margin:0 13px 12px;padding:8px 10px;border-radius:9px;background:var(--op-soft);font-size:11px;text-align:center;color:#66737b}
.ms-page .operation-work-duration strong{font-weight:900;color:var(--op-accent)}

.ms-page .destination-operation.is-waiting{--op-accent:#277367;--op-soft:#eaf7f3}
.ms-page .destination-operation.is-active{--op-accent:#b87900;--op-soft:#fff5dc}
.ms-page .destination-operation.is-completed{--op-accent:#147a54;--op-soft:#eaf7ef}
.ms-page .destination-operation.is-over{--op-accent:#b33a4d;--op-soft:#fff0f2}
.ms-page .origin-operation.is-loading{--op-accent:#5264ae;--op-soft:#eef0ff}
.ms-page .origin-operation.is-wait-release{--op-accent:#7357b8;--op-soft:#f2edff}
.ms-page .origin-operation.is-released{--op-accent:#2f7753;--op-soft:#edf8f1}
.ms-page .drop-operation{--op-accent:#7652a2;--op-soft:#f4effc}

@media (max-width:1024px){
  .ms-page .mobile-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:12px;background:#f4f7f8}
  .ms-page .compact-card{min-width:0;border:1px solid #dfe6ea;border-radius:18px;background:#fff;box-shadow:0 7px 24px #17324a10;overflow:hidden}
  .ms-page .compact-card-head{padding:16px 16px 12px;text-align:center;background:#fff}
  .ms-page .compact-card-head h2{font-size:18px;line-height:1.25;color:#15212a}
  .ms-page .compact-card-head p{margin-top:4px;font-size:12px;color:#6f7d86}
  .ms-page .compact-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:0 14px 13px}
  .ms-page .compact-meta>span{display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;min-width:0;padding:9px 6px;border:1px solid #e4d28c;border-radius:10px;background:#fff6d7;color:#2a2b27;font-size:13px;font-weight:900;text-align:center}
  .ms-page .compact-meta>span>b{font-size:9px;color:#7d7661;font-weight:800}
  .ms-page .compact-times{margin:0 14px 14px;padding:0;background:transparent}
  .ms-page .compact-schedule .schedule-section.arrival{border:0;border-radius:0;background:#fff;box-shadow:none}
  .ms-page .compact-schedule .arrival-system-row{margin:0;border-radius:0;background:#f7f9fa;box-shadow:none}
  .ms-page .compact-card>.lower-operation{width:auto!important;margin:0 14px 14px!important}
  .ms-page .compact-party{margin:0 14px 14px;padding:12px;border:1px solid #e4eaed;border-radius:12px;background:#fafcfc}
  .ms-page .operation-timeline,.ms-page .operation-timeline.stages-2{grid-template-columns:minmax(0,1fr) 46px minmax(0,1fr)!important;gap:0!important;margin:3px 13px 12px!important;padding:12px 10px 10px!important}
  .ms-page .operation-timeline.stages-3{grid-template-columns:minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1fr)!important}
  .ms-page .operation-timeline.stages-2 .operation-stage:first-child{grid-column:auto!important}
  .ms-page .operation-timeline.stages-2 i{grid-column:auto!important}
  .ms-page .operation-timeline.stages-2 .operation-stage:last-child{grid-column:auto!important}
  .ms-page .operation-timeline i{width:auto!important;height:3px!important;margin-top:16px!important;background:#dce3e7!important}
  .ms-page .operation-timeline .is-done+i,.ms-page .operation-timeline .is-active+i{background:linear-gradient(90deg,var(--op-accent),color-mix(in srgb,var(--op-accent) 35%,#dce3e7))!important}
  .ms-page .operation-timeline i:before,.ms-page .operation-timeline i:after{display:none!important}
}

@media (max-width:700px){
  .ms-page .mobile-cards{grid-template-columns:1fr;gap:12px;padding:8px}
  .ms-page .compact-card{border-radius:15px}
  .ms-page .compact-card-head{padding:14px 13px 11px}
  .ms-page .compact-card-head h2{font-size:17px}
  .ms-page .compact-meta{padding:0 11px 11px;gap:6px}
  .ms-page .compact-meta>span{padding:8px 4px;font-size:12px}
  .ms-page .compact-times{margin:0 11px 11px}
  .ms-page .compact-card>.lower-operation{margin:0 11px 11px!important}
  .ms-page .compact-party{margin:0 11px 11px}
  .ms-page .schedule-stack.single .schedule-values{padding:14px 9px 6px}
  .ms-page .schedule-stack.single .schedule-values strong{font-size:13px}
  .ms-page .schedule-stack.single .arrival-system-row>div>span{padding:7px 2px!important}
  .ms-page .schedule-stack.single .arrival-system-row .arrival-source-value{font-size:10px!important}
  .ms-page .lower-operation>header{padding:11px 12px}
  .ms-page .lower-operation>header strong{font-size:14px}
  .ms-page .lower-operation>header span{font-size:11px}
  .ms-page .operation-kpi{padding:13px 12px 4px}
  .ms-page .operation-kpi>strong{font-size:32px}
  .ms-page .operation-kpi>span{font-size:11px}
  .ms-page .operation-standard{font-size:10px}
  .ms-page .operation-timeline .operation-stage .operation-icon{width:32px;height:32px}
  .ms-page .operation-timeline .operation-stage b{font-size:10px}
  .ms-page .operation-timeline .operation-stage small{font-size:9px}
}

@media (prefers-reduced-motion: reduce){
  .ms-page .lower-operation *, .ms-page #filter-summary *{animation:none!important;transition:none!important}
}
`;

function appendPatch(response, patch, contentType) {
  if (!response || !response.ok) return Promise.resolve(response);
  return response.text().then((text) => {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", contentType);
    headers.set("cache-control", "no-store");
    return new Response(text + "\n" + patch, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
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
    event.respondWith(fresh().then((response) => appendPatch(response, MS_JS_HOTFIX, "application/javascript; charset=utf-8")).catch(() => fetch(event.request)));
    return;
  }
  if (url.pathname.endsWith("/style.css")) {
    event.respondWith(fresh().then((response) => appendPatch(response, MS_CSS_HOTFIX, "text/css; charset=utf-8")).catch(() => fetch(event.request)));
    return;
  }
  event.respondWith(fresh().catch(() => fetch(event.request)));
});
