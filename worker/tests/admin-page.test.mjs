import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("Admin is a standalone full page with manual refresh only", async () => {
  const [html, js, css] = await Promise.all([read("admin.html"), read("admin.js"), read("admin.css")]);
  assert.match(html, /<main>/);
  assert.match(html, /Quota \/ System Health/);
  assert.match(html, /HUB &amp; Source/);
  assert.match(html, /Users/);
  assert.match(html, /Standards/);
  assert.match(js, /ADMIN_STANDALONE_V1/);
  assert.match(js, /request\("adminOverview"\)/);
  assert.doesNotMatch(js, /setInterval\s*\(|new WebSocket\s*\(|EventSource\s*\(/);
  assert.doesNotMatch(html + js + css, /waiting\.html/);
});

test("Admin authorization is enforced by Worker, including operator rejection", async () => {
  const worker = await read("worker/src/index.js");
  assert.match(worker, /if \(action === "adminOverview"\) \{\s*mustAdmin\(actor\);\s*return ok\(await adminOverview\(env\)\);/);
  assert.match(worker, /function mustAdmin\([^)]+\)[\s\S]*?"ADMIN_REQUIRED"[\s\S]*?403/);
  assert.match(worker, /ADMIN_OVERVIEW_V1/);
  assert.doesNotMatch(worker.slice(worker.indexOf("async function adminOverview"), worker.indexOf("async function saveUser")), /refreshMsIfStale\(|readMsRoutes\(|readPreEntry|readBusPage|readHbiTruckPhotos/);
});

test("Admin diagnostics are sanitized and do not expose credentials", async () => {
  const [admin, worker, adapter] = await Promise.all([read("admin.js"), read("worker/src/index.js"), read("worker/src/turso-d1.js")]);
  assert.match(adapter, /TURSO_RUNTIME_DIAGNOSTICS_V1/);
  assert.match(adapter, /current-worker-isolate/);
  assert.match(worker, /d1BindingCount: null/);
  assert.match(worker, /accountUsageTrend: null/);
  assert.doesNotMatch(admin, /TURSO_AUTH_TOKEN|AUTH_SECRET|PASSWORD_PEPPER|credentials_cipher|session_cipher|device_cipher/);
});

test("waiting page is absent from active navigation and central management targets Admin", async () => {
  const files = ["ms.html", "proof.html", "ms-report.html", "ms.js", "proof-v2-core.js", "proof-v2-actions.js", "ms-report.js", ".github/dev-tools/stage-dev-runtime.mjs"];
  const sources = await Promise.all(files.map(read));
  for (let i = 0; i < sources.length; i += 1) {
    assert.doesNotMatch(sources[i], /href=["']waiting\.html(?:#[^"']*)?["']/, `${files[i]} exposes waiting page`);
    assert.doesNotMatch(sources[i], /waiting\.html#settings/, `${files[i]} retains old settings route`);
  }
  assert.match(await read("ms.html"), /href="admin\.html"[^>]*>จัดการกลาง/);
  await assert.rejects(read("main.js"), /ENOENT/);
});

test("HBI remains click-only and Admin overview performs no HBI request", async () => {
  const [ms, worker, admin] = await Promise.all([read("ms.js"), read("worker/src/index.js"), read("admin.js")]);
  assert.match(ms, /HBI_TRUCK_PHOTO_LAZY_V1/);
  assert.match(worker, /HBI_PHOTO_ON_DEMAND_V1/);
  assert.match(worker, /no status heartbeat writes/);
  assert.doesNotMatch(admin, /msTruckPhotos|readHbiTruckPhotos|loadInfoList/);
});


test("Admin HUB catalog accepts only canonical short HUB codes", async () => {
  const [admin, worker, selfHeal] = await Promise.all([
    read("admin.js"),
    read("worker/src/index.js"),
    read(".github/dev-tools/patch-ms-self-healing-supervisor.mjs"),
  ]);
  const canonical = (value) => {
    const hub = String(value ?? "").trim().toUpperCase();
    return /^(?=.*[A-Z])[A-Z0-9]{2,12}$/.test(hub) ? hub : "";
  };
  assert.equal(canonical("EA2"), "EA2");
  assert.equal(canonical("ne1"), "NE1");
  assert.equal(canonical("BAG4"), "BAG4");
  assert.equal(canonical("02 NE1_HUB-นครราชสีมา"), "");
  assert.equal(canonical("__LH_MANIFEST__:NE1"), "");
  assert.equal(canonical("NE1_HUB"), "");
  assert.match(worker, /ADMIN_CANONICAL_HUB_V1/);
  assert.match(worker, /filter\(\(row\) => Boolean\(canonicalHubCode\(row\?\.hub\)\)\)/);
  assert.match(worker, /rows\.map\(canonicalHubCode\)\.filter\(Boolean\)/);
  assert.match(admin, /ADMIN_CANONICAL_HUB_V1/);
  assert.match(admin, /const hubs = adminHubs\(\);/);
  assert.match(selfHeal, /ADMIN_CANONICAL_REPAIR_HUB_V1/);
  assert.match(selfHeal, /const hub = canonicalHubCode\(row\?\.hub\)/);
});
