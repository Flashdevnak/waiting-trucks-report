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

export {
  SUPERVISOR_SNAPSHOT_MARKER,
  SUPERVISOR_SOURCE_HEALTH_MARKER,
  SUPERVISOR_QUEUE_LIFECYCLE_MARKER,
};

// SUP-07 is deliberately layered after the byte-for-byte SUP-06 implementation.
// This keeps every previously accepted snapshot/source-health contract intact and
// adds only a pure aggregate over rows already held by the existing refresh.
export function patchSupervisorSharedSnapshot(source) {
  return patchSupervisorQueueLifecycle(
    patchSupervisorSharedSnapshotV6(String(source || "")),
  );
}

const invokedPath = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedPath) {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: node patch-supervisor-shared-snapshot.mjs <worker-index.js>");
  await writeFile(target, patchSupervisorSharedSnapshot(await readFile(target, "utf8")), "utf8");
}
