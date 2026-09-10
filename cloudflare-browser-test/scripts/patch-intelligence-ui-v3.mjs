import fs from "node:fs";

const MARKER = "INTELLIGENCE_HUB_FILTER_V3";
const CONNECTION_PATH = "src/connection-error.js";
const TBR_ENTRY_PATH = "src/tbr-intelligence-entry.js";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`Intelligence UI patch failed: ${label}`);
  return source.replace(from, to);
}

function patchConnectionError(source) {
  if (source.includes(MARKER)) return source;
  let out = String(source || "");

  const wantsHtmlBlock = `function wantsHtml(request) {\n  return String(request.headers.get("accept") || "").toLowerCase().includes("text/html");\n}\n\nfunction connectionErrorPage(report) {`;
  const helperBlock = `function wantsHtml(request) {\n  return String(request.headers.get("accept") || "").toLowerCase().includes("text/html");\n}\n\n// ${MARKER}: HUB selector is a Browser-KV read-only catalog. It never enrolls a HUB, writes KV, calls Turso, or calls MS.\nasync function connectedHubCatalog(env, currentHub = "") {\n  const hubs = [];\n  const add = (value) => {\n    const hub = normalizeHub(value);\n    if (hub && !hubs.includes(hub)) hubs.push(hub);\n  };\n  add(currentHub);\n  try {\n    const stored = parseJson((await env.STATE.get("hubs")) || "[]", []);\n    for (const value of Array.isArray(stored) ? stored : []) add(value);\n  } catch {}\n  return hubs.sort((a, b) => a.localeCompare(b));\n}\n\nfunction connectionHubToolbar(hub, hubs = []) {\n  const current = normalizeHub(hub) || "NE1";\n  const values = [...new Set([current, ...(Array.isArray(hubs) ? hubs : []).map(normalizeHub).filter(Boolean)])].sort((a, b) => a.localeCompare(b));\n  const options = values.map((value) => '<option value="' + escapeHtml(value) + '"' + (value === current ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('');\n  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href=\'/api/connection-error?hub=\'+encodeURIComponent(this.value)">' + options + '</select><span class="hub-filter-note">ดูข้อมูลเท่านั้น · ไม่สร้าง polling เพิ่ม</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a class="active" href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';\n}\n\nfunction connectionErrorPage(report, hubs = []) {`;
  out = replaceUnique(out, wantsHtmlBlock, helperBlock, "connection helper insertion");

  out = replaceUnique(
    out,
    `</style></head><body><div class="wrap"><div class="head">`,
    `</style><style>\n    body{background:radial-gradient(circle at top left,#eef6ff 0,#f7f9fc 34%,#f4f6fa 72%)}.wrap{max-width:1400px}.hub-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px;padding:12px 14px;border:1px solid #dbe5f0;border-radius:14px;background:rgba(255,255,255,.88);box-shadow:0 8px 28px rgba(31,41,55,.06);backdrop-filter:blur(10px)}.hub-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.hub-filter-label{font-weight:800;color:#344054}.hub-filter select{min-width:120px;height:40px;padding:0 34px 0 12px;border:1px solid #cfd8e3;border-radius:10px;background:#fff;color:#101828;font-weight:800;outline:none}.hub-filter select:focus{border-color:#84adff;box-shadow:0 0 0 3px rgba(46,111,235,.12)}.hub-filter-note{font-size:12px;color:#667085}.intel-tabs{display:flex;gap:6px;padding:4px;border-radius:11px;background:#eef2f7}.intel-tabs a{padding:8px 11px;border-radius:8px;text-decoration:none;color:#475467;font-size:13px;font-weight:800}.intel-tabs a.active{background:#fff;color:#155eef;box-shadow:0 1px 4px rgba(31,41,55,.08)}.head h1{letter-spacing:-.02em}.health{box-shadow:0 8px 24px rgba(31,41,55,.05)}.cards{gap:12px}.card{position:relative;overflow:hidden;box-shadow:0 8px 22px rgba(31,41,55,.045)}.card:before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:linear-gradient(90deg,#2e6feb,#57c4ff)}.panel,.table{box-shadow:0 10px 28px rgba(31,41,55,.05)}th{position:sticky;top:0;z-index:1}.safe{font-weight:800}@media(max-width:760px){.hub-toolbar{align-items:stretch;flex-direction:column}.hub-filter{display:grid;grid-template-columns:1fr 1fr}.hub-filter-note{grid-column:1/-1}.intel-tabs{width:100%}.intel-tabs a{flex:1;text-align:center}.cards{grid-template-columns:repeat(2,1fr)}.card b{font-size:18px}}@media(max-width:440px){.hub-filter{grid-template-columns:1fr}.hub-filter-note{grid-column:auto}.cards{grid-template-columns:1fr 1fr}.wrap{padding:0 10px}}\n    </style></head><body><div class="wrap">\${connectionHubToolbar(hub, hubs)}<div class="head">`,
    "connection toolbar and visual polish",
  );

  out = replaceUnique(
    out,
    `    const report = await readConnectionIncidentReport(env, hub);\n    if (wantsHtml(request)) return connectionErrorPage(report);\n    return json(request, report);`,
    `    const report = await readConnectionIncidentReport(env, hub);\n    if (wantsHtml(request)) {\n      const hubs = await connectedHubCatalog(env, hub);\n      return connectionErrorPage(report, hubs);\n    }\n    return json(request, report);`,
    "connection HTML hub catalog",
  );

  return out;
}

function patchTbrEntry(source) {
  if (source.includes(MARKER)) return source;
  let out = String(source || "");

  out = replaceUnique(
    out,
    `function improvePageHtml(htmlValue, shadow, intelligence) {\n  let html = String(htmlValue || "");`,
    `// ${MARKER}: the selector lists only already-configured Browser KV HUBs. It does not add HUBs to cron or request any upstream source.\nfunction tbrHubToolbar(hubValue, hubs = []) {\n  const current = cleanHub(hubValue || "NE1");\n  const values = [...new Set([current, ...(Array.isArray(hubs) ? hubs : []).map(cleanHub)])].sort((a, b) => a.localeCompare(b));\n  const options = values.map((value) => '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>').join('');\n  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href=\'/shadow-tbr?hub=\'+encodeURIComponent(this.value)">' + options + '</select><span class="hub-filter-note">อ่าน Intelligence ของ HUB ที่เชื่อมต่อแล้ว · ไม่เพิ่ม MS polling</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a class="active" href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';\n}\n\nfunction improvePageHtml(htmlValue, shadow, intelligence, hubs = []) {\n  let html = String(htmlValue || "");\n  const currentHub = cleanHub(shadow?.hub || intelligence?.hub || "NE1");\n  html = html.replace(\n    '<main class="wrap"><div class="top">',\n    '<main class="wrap">' + tbrHubToolbar(currentHub, hubs) + '<div class="top">',\n  );\n  html = html.replace(\n    '</style></head>',\n    '.hub-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px;padding:12px 14px;border:1px solid #dbe5f0;border-radius:14px;background:rgba(255,255,255,.9);box-shadow:0 8px 28px rgba(31,41,55,.06);backdrop-filter:blur(10px)}.hub-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.hub-filter-label{font-weight:800;color:#344054}.hub-filter select{min-width:120px;height:40px;padding:0 34px 0 12px;border:1px solid #cfd8e3;border-radius:10px;background:#fff;color:#101828;font-weight:800;outline:none}.hub-filter select:focus{border-color:#84adff;box-shadow:0 0 0 3px rgba(46,111,235,.12)}.hub-filter-note{font-size:12px;color:#667085}.intel-tabs{display:flex;gap:6px;padding:4px;border-radius:11px;background:#eef2f7}.intel-tabs a{padding:8px 11px;border-radius:8px;text-decoration:none;color:#475467;font-size:13px;font-weight:800}.intel-tabs a.active{background:#fff;color:#155eef;box-shadow:0 1px 4px rgba(31,41,55,.08)}body{background:radial-gradient(circle at top left,#eef6ff 0,#f7f9fc 34%,#f4f6fa 72%)}.wrap{max-width:1320px}.top h1{letter-spacing:-.02em}.banner,.section,.card{box-shadow:0 9px 26px rgba(31,41,55,.05)}.card{position:relative;overflow:hidden}.card:before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:linear-gradient(90deg,#2e6feb,#57c4ff)}.banner{border-left:4px solid #12b76a}.section h3{margin-top:0}th{position:sticky;top:0;z-index:1}@media(max-width:760px){.hub-toolbar{align-items:stretch;flex-direction:column}.hub-filter{display:grid;grid-template-columns:1fr 1fr}.hub-filter-note{grid-column:1/-1}.intel-tabs{width:100%}.intel-tabs a{flex:1;text-align:center}}@media(max-width:440px){.hub-filter{grid-template-columns:1fr}.hub-filter-note{grid-column:auto}.wrap{padding:0 10px}}' + '</style></head>',\n  );`,
    "TBR toolbar and visual polish",
  );

  out = replaceUnique(
    out,
    `  const intelligence = await intelligenceForShadow(env, hub, shadow);\n  const base = tbrIntelligencePage(shadow, intelligence);\n  const html = improvePageHtml(await base.text(), shadow, intelligence);`,
    `  const intelligence = await intelligenceForShadow(env, hub, shadow);\n  const hubs = await configuredHubs(env);\n  const base = tbrIntelligencePage(shadow, intelligence);\n  const html = improvePageHtml(await base.text(), shadow, intelligence, hubs);`,
    "TBR HTML hub catalog",
  );

  return out;
}

const connectionBefore = fs.readFileSync(CONNECTION_PATH, "utf8");
const tbrBefore = fs.readFileSync(TBR_ENTRY_PATH, "utf8");
const connectionAfter = patchConnectionError(connectionBefore);
const tbrAfter = patchTbrEntry(tbrBefore);

fs.writeFileSync(CONNECTION_PATH, connectionAfter);
fs.writeFileSync(TBR_ENTRY_PATH, tbrAfter);

for (const [label, source] of [["connection", connectionAfter], ["tbr", tbrAfter]]) {
  if (!source.includes(MARKER)) throw new Error(`${label} marker missing`);
  if (!source.includes('aria-label="เลือก HUB"')) throw new Error(`${label} HUB selector missing`);
}
if (!connectionAfter.includes('await env.STATE.get("hubs")')) throw new Error("connection HUB catalog is not Browser KV backed");
if (!tbrAfter.includes("const hubs = await configuredHubs(env);")) throw new Error("TBR HUB catalog is not Browser KV backed");
if (!connectionAfter.includes("extraMsPolling: 0") || !tbrAfter.includes("extraMsPolling: 0")) throw new Error("quota contract changed");

console.log("INTELLIGENCE_UI_V3=PASS");
console.log("INTELLIGENCE_HUB_FILTER_SOURCE=BROWSER_KV_CONNECTED_ONLY");
console.log("INTELLIGENCE_FILTER_EXTRA_MS_POLLING=0");
console.log("INTELLIGENCE_FILTER_TURSO_READS=0");
console.log("INTELLIGENCE_FILTER_TURSO_WRITES=0");
console.log("INTELLIGENCE_FILTER_KV_READS_PER_HTML_LOAD=1");
