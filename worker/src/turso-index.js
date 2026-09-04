import worker, * as workerModule from "./index.js";
import { databaseEnv } from "./turso-d1.js";
import { maybeHandleProofRequest, runProofScheduled } from "./proof-control.js";
import { maybeHandleProofLiveV2 } from "./proof-live-v2.js";

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = databaseEnv(env);
    const proofV2Response = await maybeHandleProofLiveV2(request, runtimeEnv, ctx, worker, maybeHandleProofRequest);
    if (proofV2Response) return proofV2Response;
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
