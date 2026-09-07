import worker, * as workerModule from "./index.js";
import { databaseEnv } from "./turso-d1.js";
import { applyDevProofServiceDate } from "./proof-service-date-dev.js";
import { maybeHandleProofRequest, runProofScheduled } from "./proof-control.js";
import { maybeHandleProofLiveV2 } from "./proof-live-v2.js";
import { maybeHandleProofPreview } from "./proof-preview.js";
import { maybeHandleProofEditor } from "./proof-editor.js";
import { maybeHandleProofPlateSearchV5 } from "./proof-plate-search-v5.js";
import { maybeHandleProofUiV5 } from "./proof-ui-v5.js";
import { maybeHandleProofUiV10 } from "./proof-ui-v10.js";
import { maybeHandleProofUiV14 } from "./proof-ui-v14.js";
import { maybeHandleProofUiV15 } from "./proof-ui-v15.js";
import { maybeHandleProofUiV16 } from "./proof-ui-v16.js";
import { enrichProofRoutesV16, captureProofEditorMetaV16 } from "./proof-route-meta-v16.js";
import { maybeHandleProofHistoryV10 } from "./proof-history-v10.js";

const DEV_TABLET_SHELL_CSS = `
/* DEV_TABLET_SHELL_CONTAINMENT_V1 */
@media (min-width:701px) and (max-width:900px) {
  html,body,.ms-page,.ms-page .app-shell { max-width:100% !important; overflow-x:hidden !important; }
  .ms-page .toolbar-panel,.ms-page .ms-toolbar { min-width:0 !important; max-width:100% !important; }
  .ms-page .toolbar-panel { overflow:hidden !important; }
  .ms-page .ms-export-actions { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; width:100% !important; max-width:100% !important; min-width:0 !important; gap:8px !important; }
  .ms-page .ms-export-actions .btn { width:100% !important; min-width:0 !important; max-width:100% !important; white-space:normal !important; overflow-wrap:anywhere !important; }
  .dev-unified-header { position:relative !important; overflow:visible !important; }
  .dev-unified-header .site-header-inner,.dev-unified-header .dev-unified-actions { overflow:visible !important; }
  .dev-unified-header .app-nav { position:static !important; }
  .dev-unified-header .app-nav-menu { position:absolute !important; left:12px !important; right:12px !important; top:calc(100% + 6px) !important; bottom:auto !important; width:auto !important; max-width:none !important; max-height:calc(100dvh - 180px) !important; margin:0 !important; overflow-y:auto !important; overflow-x:hidden !important; overscroll-behavior:contain !important; z-index:999 !important; }
  .proof-page .proof-toolbar.proof-toolbar-v16 { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:10px !important; align-items:start !important; }
  .proof-page .proof-toolbar.proof-toolbar-v16 .proof-search-field-v16 { grid-column:1/-1 !important; order:1 !important; min-width:0 !important; }
  .proof-page .proof-toolbar.proof-toolbar-v16 .proof-hub-field-v16 { grid-column:auto !important; order:2 !important; min-width:0 !important; }
  .proof-page .proof-toolbar.proof-toolbar-v16 .proof-day-field-v16 { grid-column:auto !important; order:3 !important; width:100% !important; min-width:0 !important; }
  .proof-page .proof-toolbar.proof-toolbar-v16 label:not(.proof-search-field-v16):not(.proof-hub-field-v16):not(.proof-day-field-v16) { grid-column:auto !important; order:4 !important; min-width:0 !important; }
  .proof-page .proof-toolbar.proof-toolbar-v16>#clear-filter-btn { grid-column:auto !important; order:5 !important; margin-top:0 !important; min-width:0 !important; width:100% !important; }
}
@media (max-width:700px) {
  .report-page .multi-menu { width:100% !important; max-width:100% !important; min-width:0 !important; overflow-x:hidden !important; }
  .report-page .multi-menu label { min-width:0 !important; white-space:normal !important; overflow-wrap:anywhere !important; }
}
`;

async function appendDevTabletShellCss(response) {
  if (!response?.ok) return response;
  const base = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/css; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (base.includes('DEV_TABLET_SHELL_CONTAINMENT_V1')) {
    return new Response(base, { status: response.status, headers });
  }
  return new Response(`${base.trimEnd()}\n${DEV_TABLET_SHELL_CSS}`, { status: response.status, headers });
}

async function appendProofV16ShellSwitchFix(response) {
  const base = await response.text();
  const shellSwitch = `\n;(()=>{if(window.__PROOF_V16_DROPDOWN_SWITCH_FIX__)return;window.__PROOF_V16_DROPDOWN_SWITCH_FIX__=true;const selector='.dev-unified-header details.app-nav';let sequence=0;const snapshot=(owner,shouldOpen,phase)=>{const items=[...document.querySelectorAll(selector)];items.forEach((item)=>{item.open=item===owner?shouldOpen:false;});window.__PROOF_V16_DROPDOWN_SWITCH_LAST__={phase,shouldOpen,states:items.map((item)=>item.open),label:String(owner?.querySelector('summary')?.innerText||'').trim().replace(/\\s+/g,' ').slice(0,80)};};document.addEventListener('click',(event)=>{const token=++sequence;const target=event.target;const summary=target&&typeof target.closest==='function'?target.closest(selector+' > summary'):null;if(!summary)return;event.preventDefault();event.stopImmediatePropagation();const owner=summary.parentElement;const shouldOpen=!owner.open;const apply=(phase)=>{if(token!==sequence)return;snapshot(owner,shouldOpen,phase);};apply('sync');queueMicrotask(()=>apply('microtask'));setTimeout(()=>apply('timeout0'),0);setTimeout(()=>apply('timeout32'),32);},true);})();`;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/javascript; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(base + shellSwitch, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = databaseEnv(env);
    const proofUiV16Response = await maybeHandleProofUiV16(request, runtimeEnv, ctx, worker);
    if (proofUiV16Response) return appendProofV16ShellSwitchFix(proofUiV16Response);
    const proofUiV15Response = await maybeHandleProofUiV15(request, runtimeEnv, ctx, worker);
    if (proofUiV15Response) return proofUiV15Response;
    const proofUiV14Response = await maybeHandleProofUiV14(request, runtimeEnv, ctx, worker);
    if (proofUiV14Response) return proofUiV14Response;
    const proofUiV10Response = await maybeHandleProofUiV10(request, runtimeEnv, ctx, worker);
    if (proofUiV10Response) {
      const url = new URL(request.url);
      if (url.pathname === "/proof-v10.js") {
        const base = await proofUiV10Response.text();
        const loader = `\n;(()=>{const add=(src,key)=>{if(document.querySelector('script[data-'+key+']'))return;const s=document.createElement('script');s.dataset[key]='1';s.src=src;s.defer=true;document.head.appendChild(s);};add('/proof-v14.js?v=20260907-01','proofV14Loader');add('/proof-v15.js?v=20260907-03','proofV15Loader');add('/proof-v16.js?v=20260907-06','proofV16Loader');})();`;
        return new Response(base + loader, {
          status: proofUiV10Response.status,
          headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      return proofUiV10Response;
    }
    const proofUiV5Response = await maybeHandleProofUiV5(request, runtimeEnv, ctx, worker);
    if (proofUiV5Response) return proofUiV5Response;
    const proofHistoryV10Response = await maybeHandleProofHistoryV10(request, runtimeEnv, ctx, worker);
    if (proofHistoryV10Response) return proofHistoryV10Response;
    const proofPlateV5Response = await maybeHandleProofPlateSearchV5(request, runtimeEnv, ctx, worker);
    if (proofPlateV5Response) return proofPlateV5Response;
    const proofEditorResponse = await maybeHandleProofEditor(request, runtimeEnv, ctx, worker);
    if (proofEditorResponse) return captureProofEditorMetaV16(request, proofEditorResponse, runtimeEnv);
    const proofPreviewResponse = await maybeHandleProofPreview(request, runtimeEnv, ctx, worker);
    if (proofPreviewResponse) return proofPreviewResponse;
    const proofV2Response = await maybeHandleProofLiveV2(request, runtimeEnv, ctx, worker, maybeHandleProofRequest);
    if (proofV2Response) return enrichProofRoutesV16(request, proofV2Response, runtimeEnv, ctx);
    const proofResponse = await maybeHandleProofRequest(request, runtimeEnv, ctx, worker);
    if (proofResponse) return proofResponse;
    const response = await worker.fetch(request, runtimeEnv, ctx);
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/proof.html' || url.pathname === '/proof-v2-core.js')) {
      return applyDevProofServiceDate(request, response);
    }
    if (request.method === 'GET' && url.pathname === '/style.css') return appendDevTabletShellCss(response);
    return response;
  },

  async scheduled(controller, env, ctx) {
    const runtimeEnv = databaseEnv(env);
    ctx.waitUntil(runProofScheduled(runtimeEnv));
  },
};

// The DEV staging step injects this Durable Object class into index.js.
// Wrap its environment too, otherwise refreshes coordinated through the DO
// would silently keep using the original D1 binding.
export class MsRefreshCoordinator {
  constructor(ctx, env) {
    const Coordinator = workerModule.MsRefreshCoordinator;
    if (typeof Coordinator !== "function") {
      const error = new Error("DEV MS refresh coordinator is not staged");
      error.code = "MS_COORDINATOR_NOT_STAGED";
      throw error;
    }
    this.inner = new Coordinator(ctx, databaseEnv(env));
  }

  fetch(request) {
    return this.inner.fetch(request);
  }
}
