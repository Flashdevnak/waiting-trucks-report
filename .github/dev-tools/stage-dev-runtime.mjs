import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  patchDevMsArchive,
  patchDevMsMobileStyle,
  patchDevWorkerCompletedSummary,
} from "../../worker/scripts/patch-dev-ms-archive.mjs";
import {
  patchDevRealtimeFrontend,
  patchDevRealtimeWorker,
} from "./patch-ms-realtime-recovery.mjs";
import { patchDevSummaryFilter } from "./patch-ms-summary-filter.mjs";
import { patchDevDurableCoordinator } from "./patch-ms-durable-coordinator.mjs";
import { patchDevConnectorAdoption } from "./patch-ms-connector-adoption.mjs";
import { patchDevMultiClientWorker } from "./patch-ms-multiclient-dedupe.mjs";
import {
  patchMsRouteCancellationFrontend,
  patchMsRouteCancellationStyle,
  patchMsRouteCancellationWorker,
} from "./patch-ms-route-cancellation-compat.mjs";
import {
  patchMsNonDestinationCancellationFrontend,
  patchMsNonDestinationCancellationWorker,
} from "./patch-ms-cancel-nondestination.mjs";
import { patchMsFastAllCancelledFrontend } from "./patch-ms-fast-all-cancelled-card.mjs";
import {
  patchMsSummaryPerformanceFrontend,
  patchMsSummaryPerformanceStyle,
} from "./patch-ms-summary-performance.mjs";

export function frontendHasIntegratedDevRuntime(source) {
  const text = String(source || "");
  return (
    text.includes("requestTimeoutMs: 32000") &&
    text.includes('apiGet("msCompletedToday"') &&
    text.includes("queueMode = state.queue") &&
    text.includes("DEV: archive stays lazy")
  );
}

export function stageFrontend(source) {
  let output = String(source || "");
  if (!frontendHasIntegratedDevRuntime(output)) {
    output = patchDevMsArchive(output);
    output = patchDevRealtimeFrontend(output);
    output = patchDevSummaryFilter(output);
  }
  output = patchMsRouteCancellationFrontend(output);
  output = patchMsNonDestinationCancellationFrontend(output);
  output = patchMsFastAllCancelledFrontend(output);
  output = patchMsSummaryPerformanceFrontend(output);
  return output;
}

export function stageStyle(source) {
  return patchMsSummaryPerformanceStyle(
    patchMsRouteCancellationStyle(patchDevMsMobileStyle(source)),
  );
}

export function stageWorker(source) {
  let output = patchDevWorkerCompletedSummary(String(source || ""));
  output = patchDevRealtimeWorker(output);
  output = patchDevDurableCoordinator(output);
  output = patchDevConnectorAdoption(output);
  output = patchDevMultiClientWorker(output);
  output = patchMsRouteCancellationWorker(output);
  output = patchMsNonDestinationCancellationWorker(output);
  return output;
}

export async function stageDevRuntime(frontendTarget, workerTarget) {
  const styleTarget = join(dirname(frontendTarget), "style.css");
  const [frontend, style, worker] = await Promise.all([
    readFile(frontendTarget, "utf8"),
    readFile(styleTarget, "utf8"),
    readFile(workerTarget, "utf8"),
  ]);
  await Promise.all([
    writeFile(frontendTarget, stageFrontend(frontend), "utf8"),
    writeFile(styleTarget, stageStyle(style), "utf8"),
    writeFile(workerTarget, stageWorker(worker), "utf8"),
  ]);
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const frontendTarget = process.argv[2];
  const workerTarget = process.argv[3];
  if (!frontendTarget || !workerTarget)
    throw new Error(
      "Usage: node stage-dev-runtime.mjs <staged-ms.js> <worker-index.js>",
    );
  await stageDevRuntime(frontendTarget, workerTarget);
  console.log(`Staged idempotent DEV frontend: ${frontendTarget}`);
  console.log(`Staged DEV worker runtime: ${workerTarget}`);
}
