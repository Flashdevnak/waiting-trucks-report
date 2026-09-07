import worker, * as workerModule from "./index.js";
import { databaseEnv } from "./turso-d1.js";
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

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = databaseEnv(env);
    const proofUiV16Response = await maybeHandleProofUiV16(request, runtimeEnv, ctx, worker);
    if (proofUiV16Response) return proofUiV16Response;
    const proofUiV15Response = await maybeHandleProofUiV15(request, runtimeEnv, ctx, worker);
    if (proofUiV15Response) return proofUiV15Response;
    const proofUiV14Response = await maybeHandleProofUiV14(request, runtimeEnv, ctx, worker);
    if (proofUiV14Response) return proofUiV14Response;
    const proofUiV10Response = await maybeHandleProofUiV10(request, runtimeEnv, ctx, worker);
    if (proofUiV10Response) {
      const url = new URL(request.url);
      if (url.pathname === "/proof-v10.js") {
        const base = await proofUiV10Response.text();
        const loader = `\n;(()=>{const add=(src,key)=>{if(document.querySelector('script[data-'+key+']'))return;const s=document.createElement('script');s.dataset[key]='1';s.src=src;s.defer=true;document.head.appendChild(s);};add('/proof-v14.js?v=20260907-01','proofV14Loader');add('/proof-v15.js?v=20260907-03','proofV15Loader');add('/proof-v16.js?v=20260907-04','proofV16Loader');})();`;
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
    return worker.fetch(request, runtimeEnv, ctx);
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
