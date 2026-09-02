import worker, * as workerModule from "./index.js";
import { databaseEnv } from "./turso-d1.js";

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, databaseEnv(env), ctx);
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
