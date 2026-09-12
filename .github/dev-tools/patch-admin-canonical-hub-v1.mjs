import fs from "node:fs";

const MARKER = "ADMIN_CANONICAL_HUB_V1";

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${MARKER}: ${label} count=${count}`);
  return source.replace(from, to);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`${MARKER}: ${label} count=${matches.length}`);
  return source.replace(pattern, replacement);
}

function patchWorker(path) {
  let source = fs.readFileSync(path, "utf8");
  if (source.includes(MARKER)) {
    console.log(`${MARKER}_WORKER=ALREADY_APPLIED`);
    return;
  }

  const helper = `// ${MARKER}: user-facing HUB identity is always the short code (EA2, NE1, BAG4, ...).\n// Technical storage keys, full branch labels, spaces, underscores, colons and guessed aliases\n// are not HUB identities and must never enter Admin/selector contracts.\nfunction canonicalHubCode(value) {\n  const hub = String(value ?? "").trim().toUpperCase();\n  return /^(?=.*[A-Z])[A-Z0-9]{2,12}$/.test(hub) ? hub : "";\n}\n\n`;
  source = replaceOnce(source, "function pickBranch(actor, wanted) {", `${helper}function pickBranch(actor, wanted) {`, "canonical helper anchor");

  source = replaceRegexOnce(
    source,
    /function pickBranch\(actor, wanted\) \{\n  const b = text\(\n    wanted \|\| \(actor\.role === "admin" \? "NE1" : actor\.branches\[0\]\),\n    80,\n  \)\.toUpperCase\(\);/,
    `function pickBranch(actor, wanted) {\n  const b = canonicalHubCode(\n    wanted || (actor.role === "admin" ? "NE1" : actor.branches[0]),\n  );\n  if (!b) fail("รหัส HUB ไม่ถูกต้อง ต้องใช้ชื่อย่อ HUB เท่านั้น", "INVALID_BRANCH", 400);`,
    "pickBranch canonicalization",
  );

  source = replaceOnce(
    source,
    "  const hubs = (hubResult.results || []).map((row) => {",
    "  const hubs = (hubResult.results || [])\n    .filter((row) => Boolean(canonicalHubCode(row?.hub)))\n    .map((row) => {",
    "adminOverview catalog filter",
  );

  const overviewStart = source.indexOf("async function adminOverview(env) {");
  const overviewEnd = source.indexOf("\nasync function saveUser", overviewStart);
  if (overviewStart < 0 || overviewEnd <= overviewStart) throw new Error(`${MARKER}: adminOverview section missing`);
  let overview = source.slice(overviewStart, overviewEnd);
  overview = replaceOnce(overview, "      hub: row.hub,", "      hub: canonicalHubCode(row.hub),", "adminOverview normalized hub output");
  source = source.slice(0, overviewStart) + overview + source.slice(overviewEnd);

  const knownStart = source.indexOf("async function knownMsBranches(env) {");
  const knownEnd = source.indexOf("\n}", knownStart);
  if (knownStart < 0 || knownEnd <= knownStart) throw new Error(`${MARKER}: knownMsBranches section missing`);
  let known = source.slice(knownStart, knownEnd + 2);
  known = replaceOnce(
    known,
    "  return [...new Set(rows)].sort();",
    "  return [...new Set(rows.map(canonicalHubCode).filter(Boolean))].sort();",
    "knownMsBranches canonical filter",
  );
  source = source.slice(0, knownStart) + known + source.slice(knownEnd + 2);

  const bodyHubPattern = "text(body.hub, 80).toUpperCase()";
  const bodyHubCount = source.split(bodyHubPattern).length - 1;
  if (bodyHubCount < 3) throw new Error(`${MARKER}: expected HUB write/action normalization anchors, got ${bodyHubCount}`);
  source = source.split(bodyHubPattern).join("canonicalHubCode(body.hub)");

  if (!source.includes(".filter((row) => Boolean(canonicalHubCode(row?.hub)))")) throw new Error(`${MARKER}: Admin filter missing`);
  if (!source.includes("rows.map(canonicalHubCode).filter(Boolean)")) throw new Error(`${MARKER}: known branch filter missing`);
  if (source.includes('const hub = text(body.hub, 80).toUpperCase()')) throw new Error(`${MARKER}: raw body HUB normalization survived`);

  fs.writeFileSync(path, source);
  console.log(`${MARKER}_WORKER=PASS`);
  console.log(`ADMIN_CANONICAL_BODY_HUB_ANCHORS=${bodyHubCount}`);
}

function patchAdmin(path) {
  let source = fs.readFileSync(path, "utf8");
  if (source.includes(MARKER)) {
    console.log(`${MARKER}_ADMIN=ALREADY_APPLIED`);
    return;
  }

  const helper = `// ${MARKER}: defense-in-depth for Admin. Backend is authoritative,\n// but the UI also refuses technical keys/full labels instead of displaying or guessing them.\nfunction canonicalAdminHubCode(value) {\n  const hub = String(value ?? "").trim().toUpperCase();\n  return /^(?=.*[A-Z])[A-Z0-9]{2,12}$/.test(hub) ? hub : "";\n}\nfunction adminHubs() {\n  const seen = new Set(), result = [];\n  for (const item of state.overview?.hubs || []) {\n    const hub = canonicalAdminHubCode(item?.hub);\n    if (!hub || seen.has(hub)) continue;\n    seen.add(hub);\n    result.push({ ...item, hub });\n  }\n  return result;\n}\n\n`;
  source = replaceOnce(source, "function readAuth() {", `${helper}function readAuth() {`, "Admin helper anchor");
  source = replaceOnce(source, "  const hubs = state.overview.hubs || [], sources = hubs.flatMap(allSources).filter((x) => x?.configured);", "  const hubs = adminHubs(), sources = hubs.flatMap(allSources).filter((x) => x?.configured);", "summary HUB source");
  source = replaceOnce(source, "  el(\"hub-overview\").innerHTML = (state.overview.hubs || []).map((hub) =>", "  el(\"hub-overview\").innerHTML = adminHubs().map((hub) =>", "overview HUB source");
  source = replaceOnce(source, "function selectedHub() { return (state.overview?.hubs || []).find((hub) => hub.hub === state.branch); }", "function selectedHub() { return adminHubs().find((hub) => hub.hub === state.branch); }", "selected HUB source");
  source = replaceOnce(source, "  const hubs = state.overview.hubs || []; if (!hubs.some((x) => x.hub === state.branch)) state.branch = hubs[0]?.hub || \"\";", "  const hubs = adminHubs(); if (!hubs.some((x) => x.hub === state.branch)) state.branch = hubs[0]?.hub || \"\";", "dropdown HUB source");
  source = replaceOnce(source, "  const hubs = state.overview?.hubs?.length || 0;", "  const hubs = adminHubs().length;", "repair HUB count");

  if (!source.includes("const hubs = adminHubs();")) throw new Error(`${MARKER}: dropdown guard missing`);
  if (source.includes("state.overview?.hubs?.length || 0")) throw new Error(`${MARKER}: raw repair count survived`);
  fs.writeFileSync(path, source);
  console.log(`${MARKER}_ADMIN=PASS`);
}

function patchSelfHeal(path) {
  let source = fs.readFileSync(path, "utf8");
  if (source.includes("ADMIN_CANONICAL_REPAIR_HUB_V1")) {
    console.log("ADMIN_CANONICAL_REPAIR_HUB_V1=ALREADY_APPLIED");
    return;
  }
  source = replaceOnce(
    source,
    "    const hub = text(row?.hub, 80).toUpperCase();\\n    if (!hub) return null;\\n",
    "    // ADMIN_CANONICAL_REPAIR_HUB_V1: never run repair against technical/full-label keys.\\n    const hub = canonicalHubCode(row?.hub);\\n    if (!hub) return null;\\n",
    "Admin repair HUB normalization",
  );
  fs.writeFileSync(path, source);
  console.log("ADMIN_CANONICAL_REPAIR_HUB_V1=PASS");
}

function patchTests(path) {
  let source = fs.readFileSync(path, "utf8");
  if (source.includes("Admin HUB catalog accepts only canonical short HUB codes")) {
    console.log(`${MARKER}_TEST=ALREADY_APPLIED`);
    return;
  }
  source += `\n\ntest("Admin HUB catalog accepts only canonical short HUB codes", async () => {\n  const [admin, worker, selfHeal] = await Promise.all([\n    read("admin.js"),\n    read("worker/src/index.js"),\n    read(".github/dev-tools/patch-ms-self-healing-supervisor.mjs"),\n  ]);\n  const canonical = (value) => {\n    const hub = String(value ?? "").trim().toUpperCase();\n    return /^(?=.*[A-Z])[A-Z0-9]{2,12}$/.test(hub) ? hub : "";\n  };\n  assert.equal(canonical("EA2"), "EA2");\n  assert.equal(canonical("ne1"), "NE1");\n  assert.equal(canonical("BAG4"), "BAG4");\n  assert.equal(canonical("02 NE1_HUB-นครราชสีมา"), "");\n  assert.equal(canonical("__LH_MANIFEST__:NE1"), "");\n  assert.equal(canonical("NE1_HUB"), "");\n  assert.match(worker, /ADMIN_CANONICAL_HUB_V1/);\n  assert.match(worker, /filter\\(\\(row\\) => Boolean\\(canonicalHubCode\\(row\\?\\.hub\\)\\)\\)/);\n  assert.match(worker, /rows\\.map\\(canonicalHubCode\\)\\.filter\\(Boolean\\)/);\n  assert.match(admin, /ADMIN_CANONICAL_HUB_V1/);\n  assert.match(admin, /const hubs = adminHubs\\(\\);/);\n  assert.match(selfHeal, /ADMIN_CANONICAL_REPAIR_HUB_V1/);\n  assert.match(selfHeal, /const hub = canonicalHubCode\\(row\\?\\.hub\\)/);\n});\n`;
  fs.writeFileSync(path, source);
  console.log(`${MARKER}_TEST=PASS`);
}

patchWorker("worker/src/index.js");
patchAdmin("admin.js");
patchSelfHeal(".github/dev-tools/patch-ms-self-healing-supervisor.mjs");
patchTests("worker/tests/admin-page.test.mjs");
console.log(`${MARKER}=PASS`);
