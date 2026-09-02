import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV Durable Object coordinator patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchDevDurableCoordinator(source) {
  let output = String(source || "");
  output = replaceUnique(
    output,
    `async function refreshMsIfStale(env, actor, branch, force = false) {
  if (!access(branch, actor)) return { status: "forbidden" };
  const nowMs = Date.now(), recent = recentMsSync.get(branch);
  if (!force && recent?.until > nowMs) return recent.result;
  if (activeMsSync.has(branch)) return activeMsSync.get(branch);
  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));
  activeMsSync.set(branch, task);
  return task;
}`,
    `async function refreshMsIfStale(env, actor, branch, force = false) {
  if (!access(branch, actor)) return { status: "forbidden" };
  const nowMs = Date.now(), recent = recentMsSync.get(branch);
  if (!force && recent?.until > nowMs) return recent.result;
  if (activeMsSync.has(branch)) return activeMsSync.get(branch);

  if (env.MS_REFRESH_COORDINATOR) {
    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);
    const stub = env.MS_REFRESH_COORDINATOR.get(id);
    const url = new URL("https://ms-refresh.internal/refresh");
    url.searchParams.set("branch", branch);
    if (force) url.searchParams.set("force", "1");
    const response = await stub.fetch(new Request(url));
    if (!response.ok) {
      const error = new Error("ตัวประสานการอัปเดต MS ตอบกลับผิดพลาด");
      error.code = "MS_COORDINATOR_ERROR";
      throw error;
    }
    const result = await response.json();
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  }

  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));
  activeMsSync.set(branch, task);
  return task;
}

export class MsRefreshCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.active = null;
    this.lastResult = null;
    this.recentUntil = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();
    const force = url.searchParams.get("force") === "1";
    if (!branch)
      return Response.json(
        { status: "error", error: "missing branch" },
        { status: 400 },
      );
    return Response.json(await this.refresh(branch, force));
  }

  async refresh(branch, force = false) {
    const nowMs = Date.now();
    if (!force && this.lastResult && this.recentUntil > nowMs)
      return this.lastResult;

    if (this.active) {
      if (!force && this.lastResult) return this.lastResult;
      try {
        await this.active;
      } catch {}
      if (!force && this.lastResult && this.recentUntil > Date.now())
        return this.lastResult;
    }

    const task = runMsRefresh(this.env, branch)
      .then((result) => {
        this.lastResult = result;
        this.recentUntil = Date.now() + MS_SYNC_TTL;
        return result;
      })
      .finally(() => {
        if (this.active === task) this.active = null;
      });
    this.active = task;
    return task;
  }
}`,
    "route refresh through a per-HUB Durable Object",
  );
  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const workerTarget = process.argv[2];
  if (!workerTarget)
    throw new Error(
      "Usage: node patch-ms-durable-coordinator.mjs <worker-index.js>",
    );
  const worker = await readFile(workerTarget, "utf8");
  await writeFile(workerTarget, patchDevDurableCoordinator(worker), "utf8");
  console.log(`Patched DEV Durable Object MS coordinator: ${workerTarget}`);
}
