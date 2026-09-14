import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  SUPERVISOR_SNAPSHOT_MARKER,
  SUPERVISOR_SOURCE_HEALTH_MARKER,
  patchSupervisorSharedSnapshot as patchSupervisorSharedSnapshotV6,
} from "./patch-supervisor-shared-snapshot-v6-base.mjs";
import {
  SUPERVISOR_QUEUE_LIFECYCLE_MARKER,
  patchSupervisorQueueLifecycle,
} from "./patch-supervisor-queue-lifecycle.mjs";
import {
  SUPERVISOR_EVENT_CONSOLE_MARKER,
  patchSupervisorEventConsole,
} from "./patch-supervisor-event-console.mjs";

export {
  SUPERVISOR_SNAPSHOT_MARKER,
  SUPERVISOR_SOURCE_HEALTH_MARKER,
  SUPERVISOR_QUEUE_LIFECYCLE_MARKER,
  SUPERVISOR_EVENT_CONSOLE_MARKER,
};

// Forward-only layering keeps every accepted Supervisor contract intact.
// SUP-08 runs last and only derives bounded ephemeral events from the sanitized
// shared state already being ingested by the existing Supervisor singleton.
export function patchSupervisorSharedSnapshot(source) {
  return patchSupervisorEventConsole(
    patchSupervisorQueueLifecycle(
      patchSupervisorSharedSnapshotV6(String(source || "")),
    ),
  );
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-shared-snapshot.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorSharedSnapshot(await readFile(target, "utf8")), "utf8");
}
