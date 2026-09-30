import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { classifyFleetSignInfo, createTbrProvenance } from "./tbr-provenance-dev.mjs";
import { patchTbrProvenanceDevWorker, TBR_PROVENANCE_MARKER } from "./patch-tbr-provenance-dev.mjs";

const at = "2026-09-30T02:14:00.000Z";
const parse = (value) => {
  const raw = String(value || "").trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? raw.replace(" ", "T") + "+07:00" : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};
const deps = {
  normalizeProofId: (value) => String(value || "").trim().toUpperCase(),
  normalizeAttendance: (value) => String(value || "").trim(),
  matchHub: (value, hub) => String(value || "").includes(hub),
  msDate: parse,
  findBusEnrichment: (map, row) => map.ambiguousKeys?.has(`P:${row.proofId}|A:${row.attendanceType}`)
    ? undefined : map.get(`P:${row.proofId}|A:${row.attendanceType}`) || map.get(`P:${row.proofId}`),
  enrichMsRow: (row, _, map) => {
    const bus = deps.findBusEnrichment(map, row);
    if (bus) row.scheduleTbrArrivalAt = bus.scheduleTbrArrivalAt;
    return row;
  },
};
const origin = { proofId: "PRIVATE_PROOF_928", attendanceType: "ต้นทาง", actualArrivalAt: at, scheduleTbrArrivalAt: "", routeName: "SECRET_ROUTE", plate: "SECRET_PLATE" };
const bus = (field, override = {}) => ({
  proof_id: [{ value: origin.proofId }], next_store_info: [{ value: "HUB_SECRET" }, { value: "ต้นทาง" }],
  fleet_sign_info: field, auth: "SECRET_AUTH", cookie: "SECRET_COOKIE", fbid: "SECRET_FBID",
  driver: "SECRET_DRIVER", line_info: [{ value: "SECRET_LINE" }], ...override,
});
const emptyMap = new Map();
const map = (tbr = at) => new Map([[`P:${origin.proofId}|A:ต้นทาง`, { scheduleTbrArrivalAt: tbr }]]);
let stagePromise;
function stagedSources() {
  if (!stagePromise) stagePromise = (async () => {
    const directory = await mkdtemp(join(tmpdir(), "tbr-provenance-dev-"));
    const assets = join(directory, "assets");
    const runtime = join(directory, "runtime");
    await Promise.all([mkdir(assets), mkdir(runtime)]);
    for (const name of ["ms.js", "style.css", "ms.html", "proof.html", "ms-report.html"])
      await copyFile(new URL(`../../${name}`, import.meta.url), join(assets, name));
    await copyFile(new URL("../../worker/src/index.js", import.meta.url), join(runtime, "index.js"));
    execFileSync(process.execPath, [fileURLToPath(new URL("./stage-dev-runtime.mjs", import.meta.url)), join(assets, "ms.js"), join(runtime, "index.js")], { stdio: "pipe" });
    const [worker, frontend] = await Promise.all([
      readFile(join(runtime, "index.js"), "utf8"), readFile(join(assets, "ms.js"), "utf8"),
    ]);
    await rm(directory, { recursive: true, force: true });
    return { worker, frontend };
  })();
  return stagePromise;
}

test("candidate classes and actual V28 parser selection are bounded and value-free", () => {
  const cases = [
    [[], [], "NONE"],
    [[{ value: at }], ["PARSEABLE_BARE_DATE"], 0],
    [[{ value: `TBR: ${at}` }], ["EXPLICIT_TBR_LABEL_DATE"], 0],
    [[{ value: "-" }, { value: `TBR: ${at}` }], ["EMPTY", "EXPLICIT_TBR_LABEL_DATE"], 1],
    [[{ value: `KIT: ${at}` }], ["EXPLICIT_KIT_LABEL"], "NONE"],
    [[{ value: "OTHER: place" }], ["OTHER_LABEL"], "NONE"],
    [[{ value: "impossible" }], ["INVALID_NONEMPTY"], "NONE"],
    [[{ value: "-" }, { value: `KIT: ${at}` }, { value: at }], ["EMPTY", "EXPLICIT_KIT_LABEL", "PARSEABLE_BARE_DATE"], 2],
  ];
  for (const [input, classes, index] of cases) {
    const result = classifyFleetSignInfo(input, parse);
    assert.deepEqual(result.fleetSignCandidates.map((item) => item.class), classes);
    assert.equal(result.selectedTbrCandidateIndex, index);
    assert.doesNotMatch(JSON.stringify(result), /2026|HUB_SECRET/);
  }
});

test("anonymous Origin KIT/missing TBR and valid TBR traverse actual injected matcher/enrichment", () => {
  const trace = createTbrProvenance([origin], deps);
  trace.observeItem(bus([{ value: `TBR: ${at}` }]), "HUB_SECRET");
  const [row] = trace.result(map(), [{ proof_id: origin.proofId, attendance_type: "ต้นทาง", schedule_tbr_arrival_at: "" }], [origin]);
  assert.equal(row.label, "TBR-A");
  assert.equal(row.routeKitState, "VALID");
  assert.equal(row.routeTbrState, "EMPTY");
  assert.equal(row.parsedTbrState, "VALID");
  assert.equal(row.busMapKeyCreated, "YES");
  assert.equal(row.findBusEnrichmentMatch, "YES");
  assert.equal(row.enrichedTbrState, "VALID");
  assert.equal(row.persistedTbrState, "EMPTY");
  assert.equal(row.workerResponseTbrState, "EMPTY");
  assert.equal(row.frontendExpectedRender, "DASH");
  assert.equal(row.rejectionLayer, "UNKNOWN", "one-shot read must not call stale DB an application defect");
  assert.equal(trace.result(map(), [], [{ ...origin, scheduleTbrArrivalAt: at }])[0].frontendExpectedRender, "VALUE");
  assert.equal(trace.result(map(), [{ proof_id: origin.proofId, attendance_type: "ต้นทาง", schedule_tbr_arrival_at: at }], [{ ...origin, scheduleTbrArrivalAt: at }])[0].rejectionLayer, "NONE");
});

test("source, HUB, attendance, map, and ambiguity boundaries remain distinguishable", () => {
  const scenarios = [
    [bus([]), emptyMap, "SOURCE_ABSENT"],
    [bus([{ value: "TBR: not-a-date" }]), emptyMap, "SOURCE_PARSE"],
    [bus([{ value: at }], { next_store_info: [{ value: "OTHER_HUB" }, { value: "ต้นทาง" }] }), emptyMap, "HUB_FILTER"],
    [bus([{ value: at }], { next_store_info: [{ value: "HUB_SECRET" }, { value: "ปลายทาง" }] }), emptyMap, "ATTENDANCE_MATCH"],
    [bus([{ value: at }]), emptyMap, "BUS_MAP"],
    [bus([{ value: at }]), Object.assign(map(), { ambiguousKeys: new Set([`P:${origin.proofId}|A:ต้นทาง`]) }), "BUS_MAP"],
    [bus([{ value: at }]), map(""), "ENRICHMENT"],
  ];
  for (const [source, data, expected] of scenarios) {
    const trace = createTbrProvenance([origin], deps);
    trace.observeItem(source, "HUB_SECRET");
    assert.equal(trace.result(data)[0].rejectionLayer, expected);
  }
  const absent = createTbrProvenance([origin], deps).result(emptyMap)[0];
  assert.equal(absent.busCandidateFound, "NO");
  assert.equal(absent.rejectionLayer, "UNKNOWN", "unseen candidate is not proof of source absence");
  const duplicate = createTbrProvenance([origin], deps);
  duplicate.observeItem(bus([{ value: at }]), "HUB_SECRET");
  duplicate.observeItem(bus([{ value: "-" }]), "HUB_SECRET");
  const duplicateResult = duplicate.result(map())[0];
  assert.equal(duplicateResult.exactMatchedSourceRows, 2);
  assert.equal(duplicateResult.rejectionLayer, "UNKNOWN", "competing source rows cannot be attributed to the last candidate");
});

test("read-only persistence, cache, response and frontend states never claim a fresh write", () => {
  const trace = createTbrProvenance([origin], deps);
  trace.observeItem(bus([{ value: at }]), "HUB_SECRET");
  const persisted = [{ proof_id: origin.proofId, attendance_type: "ต้นทาง", schedule_tbr_arrival_at: at }];
  const [cachedMissing] = trace.result(map(), persisted, [origin]);
  assert.equal(cachedMissing.persistedTbrState, "VALID");
  assert.equal(cachedMissing.liveCacheTbrState, "EMPTY");
  assert.equal(cachedMissing.workerResponseTbrState, "EMPTY");
  assert.equal(cachedMissing.frontendExpectedRender, "DASH");
  assert.equal(cachedMissing.rejectionLayer, "UNKNOWN");
  const [allValid] = trace.result(map(), persisted, [{ ...origin, scheduleTbrArrivalAt: at }]);
  assert.equal(allValid.workerResponseTbrState, "VALID");
  assert.equal(allValid.frontendExpectedRender, "VALUE");
  assert.equal(allValid.rejectionLayer, "NONE");
});

test("strictly whitelisted output excludes synthetic identifiers and secret fields", () => {
  const trace = createTbrProvenance([origin, origin, origin, origin], deps);
  trace.observeItem(bus([{ value: `TBR: ${at}` }]), "HUB_SECRET");
  const serialized = JSON.stringify(trace.result(map(), [{ proof_id: origin.proofId, attendance_type: "ต้นทาง", schedule_tbr_arrival_at: at }], [origin]));
  assert.equal(trace.count, 3);
  for (const forbidden of ["PRIVATE_PROOF_928", "SECRET_ROUTE", "SECRET_PLATE", "SECRET_AUTH", "SECRET_COOKIE", "SECRET_FBID", "SECRET_DRIVER", "SECRET_LINE", "HUB_SECRET", at, "proofId", "routeName", "next_store_info", "fleet_sign_info", "schedule_tbr_arrival_at"])
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
});

test("DEV-only stage is authenticated, one-shot and absent from base/Production source", async () => {
  const base = await readFile(new URL("../../worker/src/index.js", import.meta.url), "utf8");
  assert.equal(base.includes(TBR_PROVENANCE_MARKER), false);
  const { worker: staged, frontend } = await stagedSources();
  assert.match(staged, /const actor = await verify\(body\.token, env\);\s+if \(action === "tbrProvenanceDev"\)/);
  assert.match(staged, /pickBranch\(actor, body\.branch\)/);
  assert.match(staged, /if \(!acquire\) return \{ marker: "TBR_PROVENANCE_DEV_V1", status: "EXPLICIT_ONE_SHOT_REQUIRED"/);
  assert.match(staged, /busTimeProbeLane\.probeOneSourceCycle\(env, hub, liveSourceDays\(\), rows, trace\.observeItem\)/);
  assert.equal((staged.match(/busTimeProbeLane\.probeOneSourceCycle\(env, hub, liveSourceDays\(\), rows, trace\.observeItem\)/g) || []).length, 1);
  assert.doesNotMatch(staged.slice(staged.indexOf(`// ${TBR_PROVENANCE_MARKER}`), staged.indexOf("async function preEntryTrips", staged.indexOf(`// ${TBR_PROVENANCE_MARKER}`))), /setInterval|setTimeout|\.run\(\)|\.put\(/);
  assert.match(staged, /SHADOW_READONLY_SPLIT_V2/);
  assert.match(staged, /BUS_TIME_HOT_LANE_V14/);
  assert.match(frontend, /flag\.get\("tbrProvenanceDiag"\) !== "1"/);
  assert.match(frontend, /button\.addEventListener\("click", async \(\) => \{/);
  assert.match(frontend, /apiPost\("tbrProvenanceDev", \{ branch: state\.branch, acquire: true \}\)/);
  assert.match(frontend, /\{ once: true \}/);
  assert.equal((frontend.match(/apiPost\("tbrProvenanceDev"/g) || []).length, 1);
});

test("staged POST gate rejects an expired session before any diagnostic invocation", async () => {
  const { worker: staged } = await stagedSources();
  const start = staged.indexOf("async function post(body, env) {");
  const end = staged.indexOf("\nasync function login(", start);
  assert.ok(start >= 0 && end > start);
  let invoked = 0;
  const context = {
    verify: async () => { throw new Error("AUTH_REQUIRED"); },
    tbrProvenanceDev: async () => { invoked++; return {}; },
    pickBranch: () => "NE1", ok: (value) => value,
  };
  runInNewContext(`${staged.slice(start, end)}\nglobalThis.postForTest = post;`, context);
  await assert.rejects(context.postForTest({ action: "tbrProvenanceDev", token: "INVALID" }, {}), /AUTH_REQUIRED/);
  assert.equal(invoked, 0);
  context.verify = async () => ({ role: "operator", branches: ["NE1"] });
  await context.postForTest({ action: "tbrProvenanceDev", token: "VALID", branch: "NE1", acquire: true }, {});
  assert.equal(invoked, 1);
});

test("staged request composes at most three anonymous rows with zero debug writes", async () => {
  const { worker: staged } = await stagedSources();
  const start = staged.indexOf("// TBR_PROVENANCE_DEV_V1: one explicit authenticated DEV-only read.");
  const end = staged.indexOf("async function preEntryTrips(", start);
  assert.ok(start >= 0 && end > start);
  const rows = Array.from({ length: 4 }, (_, index) => ({
    ...origin, proofId: `PRIVATE_PROOF_${index}`, actualArrivalAt: at,
  }));
  let acquisitions = 0;
  let writes = 0;
  const context = {
    access: () => true,
    date: parse,
    normalizeProofId: deps.normalizeProofId,
    normalizeMsAttendance: deps.normalizeAttendance,
    scheduleStoreMatchesHub: deps.matchHub,
    msDate: parse,
    findBusEnrichment: deps.findBusEnrichment,
    enrichMsRow: deps.enrichMsRow,
    liveSourceDays: () => ["2026-09-30"],
    createTbrProvenance,
    busTimeProbeLane: {
      async probeOneSourceCycle(_env, _hub, _days, selected, observe) {
        acquisitions++;
        observe(bus([{ value: `TBR: ${at}` }], { proof_id: [{ value: selected[0].proofId }] }), "HUB_SECRET");
        return { data: new Map([[`P:${selected[0].proofId}|A:ต้นทาง`, { scheduleTbrArrivalAt: at }]]), attempted: true, reason: "SOURCE_PAGES_COMPLETE" };
      },
    },
  };
  const env = { DB: { prepare(sql) { return {
    bind() { return {
      async first() { assert.match(sql, /ms_live_cache/); return { rows_json: JSON.stringify(rows) }; },
      async all() { assert.match(sql, /ms_routes/); return { results: [] }; },
      async run() { writes++; throw Error("diagnostic write"); },
    }; },
  }; } } };
  runInNewContext(`${staged.slice(start, end)}\nglobalThis.inspectForTest = tbrProvenanceDev;`, context);
  const output = await context.inspectForTest(env, { role: "operator" }, "HUB_SECRET", true);
  assert.equal(acquisitions, 1);
  assert.equal(writes, 0);
  assert.equal(output.rows.length, 3);
  assert.equal(output.rows[0].label, "TBR-A");
  assert.equal(output.logicalAcquisitions, 1);
  const serialized = JSON.stringify(output);
  for (const forbidden of ["PRIVATE_PROOF", "SECRET_ROUTE", "SECRET_PLATE", "HUB_SECRET", at, "fleet_sign_info", "SECRET_AUTH"])
    assert.equal(serialized.includes(forbidden), false);
  const idle = await context.inspectForTest(env, { role: "operator" }, "HUB_SECRET", false);
  assert.equal(idle.logicalAcquisitions, 0);
  assert.equal(acquisitions, 1);
});
