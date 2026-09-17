import { applyExactUnifiedDiff } from "./patch-pno-unified-v1.mjs";

const MARKER = "PNO_SHARED_DURABLE_V1";
const CORE_MARKER = "PNO_ULTRA_LOW_QUOTA_V1";
const WORKER_DIFF =
  "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";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoUltraLowQuotaWorker(source) {
  let output = String(source || "");
  if (!output.includes(CORE_MARKER))
    output = applyExactUnifiedDiff(output, WORKER_DIFF, "worker-core");
  if (output.includes(MARKER)) return output;
  if (!output.includes("export class MsRefreshCoordinator")) return output;
  const anchor = `    if (url.pathname === "/stream") return this.openStream(request, branch);`;
  const replacement = `    if (url.pathname === "/stream") return this.openStream(request, branch);\n    // ${MARKER}: PNO detail stays click-only but shares cache/inflight state inside\n    // the same per-HUB Durable Object used by realtime. It does not join refresh().\n    if (url.pathname === "/pno") {\n      try {\n        const locator = normalizePnoLocator({\n          hub: branch, day: url.searchParams.get("day"), proofId: url.searchParams.get("proofId"),\n          type: url.searchParams.get("type"), page: url.searchParams.get("page"), count: url.searchParams.get("count"),\n          lineId: url.searchParams.get("lineId"), vanLineId: url.searchParams.get("vanLineId"),\n          storeId: url.searchParams.get("storeId"), nextStoreId: url.searchParams.get("nextStoreId"),\n          force: url.searchParams.get("force"),\n        }, branch);\n        return Response.json(await readSharedPnoPage(this, this.env, locator));\n      } catch (error) {\n        return Response.json({ ok: false, code: error?.code || "PNO_SHARED_ERROR", message: error?.message || "โหลด PNO ไม่สำเร็จ" }, { status: Number(error?.status) || 502 });\n      }\n    }`;
  return replaceUnique(output, anchor, replacement, "coordinator /stream route");
}
