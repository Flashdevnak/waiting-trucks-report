// Triggered only to apply and validate the complete accumulated archive fix.
import "./apply-ms-archive-completeness.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const path = "worker/src/index.js";
let worker = readFileSync(path, "utf8");

function replaceUnique(from, to, label) {
  const first = worker.indexOf(from);
  const last = worker.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${label}: expected one match, got first=${first} last=${last}`);
  worker = worker.slice(0, first) + to + worker.slice(first + from.length);
}

replaceUnique(
  "async function msArchive(env, actor, hub) {",
  "// MS_ARCHIVE_COMPLETE_V1: all distinct routes, latest snapshot per route.\nasync function msArchive(env, actor, hub) {",
  "archive completeness marker",
);

replaceUnique(
  "          SELECT route_id,synced_by,\n            ROW_NUMBER() OVER (",
  "          SELECT route_id,payload_json,event_type AS action,synced_by,\n            ROW_NUMBER() OVER (",
  "completion query carries event semantics",
);

replaceUnique(
  `  const completionObserved = new Map(\n    completionResult.results.map((item) => [\n      item.route_id,\n      item.synced_by !== "MS_RANGE",\n    ]),\n  );`,
  `  const completionObserved = new Map(\n    completionResult.results.map((item) => {\n      let explicit;\n      try {\n        explicit = JSON.parse(item.payload_json || "{}")?.completionObservedLive;\n      } catch {}\n      return [\n        item.route_id,\n        explicit === true ||\n          (typeof explicit !== "boolean" &&\n            item.action !== "FIRST_SEEN" &&\n            item.synced_by !== "MS_RANGE"),\n      ];\n    }),\n  );`,
  "preserve observed completion semantics",
);

writeFileSync(path, worker, "utf8");
console.log("MS_ARCHIVE_COMPLETENESS_V2=APPLIED");
