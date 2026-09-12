from pathlib import Path

# 1) DEV staged backend: add the repair state's changedAt to the already-sanitized
# diagnostic. This does not add Turso reads/writes or MS upstream calls.
p = Path('.github/dev-tools/patch-ms-self-healing-supervisor.mjs')
s = p.read_text()
if 'changedAt: text(repair.changedAt, 100),' not in s:
    marker = 'repair.code, 80)'
    if s.count(marker) != 1:
        raise SystemExit(f'backend diagnostic marker count={s.count(marker)}')
    start = s.index(marker)
    line_end = s.index('\n', start)
    s = s[:line_end + 1] + '        changedAt: text(repair.changedAt, 100),\\\n' + s[line_end + 1:]
p.write_text(s)

# 2) Main MS connection dialog: truth-safe stale status + small 401 helper.
p = Path('ms.js')
s = p.read_text()
old = '    const status = await apiGet("msConnectionStatus", { branch: hub });\n'
new = '''    const status = await apiGet("msConnectionStatus", { branch: hub });
    let repairStatus = null;
    try { repairStatus = await apiGet("msRepairHealthDev", { branch: hub }); }
    catch { repairStatus = null; }
    const routeRepair = repairStatus?.repair || {};
'''
if old in s and 'const routeRepair = repairStatus?.repair || {};' not in s:
    s = s.replace(old, new, 1)

old = '''      const item = status[key];
      if (!node) continue;
      node.className = item?.configured
        ? (item.lastError ? "source-error" : "source-ok")
        : "source-missing";
'''
new = '''      const item = status[key];
      if (!node) continue;
      const row = node.closest("[data-source-status]");
      const latestAt = Date.parse(item?.lastSuccessAt || item?.updatedAt || "");
      const isStale = item?.configured && Number.isFinite(latestAt) && Date.now() - latestAt > 20 * 60 * 1000;
      const source401 = key === "routes"
        ? routeRepair?.code === "MS_SESSION_HTTP_401"
        : /(^|\\D)401(\\D|$)/.test(String(item?.lastError || ""));
      node.className = item?.configured
        ? (item.lastError || source401 ? "source-error" : isStale ? "source-stale" : "source-ok")
        : "source-missing";
'''
if old in s and 'const source401 = key === "routes"' not in s:
    s = s.replace(old, new, 1)

old = '''            : `พร้อมใช้งาน · อัปเดตล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)}`;
    }
'''
new = '''            : isStale
              ? `มีการเชื่อมต่อที่บันทึกไว้ · สำเร็จล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)} · สถานะปัจจุบันยังไม่ยืนยัน`
              : `พร้อมใช้งาน · อัปเดตล่าสุด ${shortDateTime(item.lastSuccessAt || item.updatedAt)}`;

      if (row) {
        let hint = row.querySelector(".source-expiry-hint");
        if (!hint) {
          hint = document.createElement("small");
          hint.className = "source-expiry-hint";
          row.appendChild(hint);
        }
        const sourceNames = {
          routes: "สถานะเส้นทางเดินรถ",
          preEntry: "พัสดุที่คาดว่าจะเข้าคลัง",
          busTime: "การจัดการตารางเวลา (KIT/TBR)",
          hbiPhotos: "รูปท้ายรถ (HBI)",
        };
        const detectedAt = key === "routes" ? routeRepair?.changedAt : "";
        if (source401) {
          hint.textContent = `ตรวจพบ 401${detectedAt ? ` · ${shortDateTime(detectedAt)}` : ""} — MS ปฏิเสธ Session ปัจจุบัน · กรุณาเชื่อมต่อ MS ใหม่ และอัปโหลด HAR “${sourceNames[key] || "แหล่งข้อมูลนี้"}” ใหม่อีกครั้ง`;
          hint.hidden = false;
          row.classList.add("has-source-expiry-hint");
        } else {
          hint.textContent = "";
          hint.hidden = true;
          row.classList.remove("has-source-expiry-hint");
        }
      }
    }
'''
if old in s and 'source-expiry-hint' not in s:
    s = s.replace(old, new, 1)
if 'ผ่าน QR' in s and 'source-expiry-hint' in s:
    s = s.replace('กรุณาเชื่อมต่อ MS ผ่าน QR ใหม่ และอัปโหลด HAR', 'กรุณาเชื่อมต่อ MS ใหม่ และอัปโหลด HAR')
p.write_text(s)

# 3) Small bottom-right visual helper.
p = Path('style.css')
s = p.read_text()
if '.source-expiry-hint' not in s:
    anchor = '.connection-source-status .source-missing { color: #6b6b66; }\n'
    addition = '''.connection-source-status .source-missing { color: #6b6b66; }
.connection-source-status .source-stale { color: #8a5a00; font-weight: 700; }
.connection-source-status > div.has-source-expiry-hint { position: relative; padding-bottom: 34px; }
.connection-source-status .source-expiry-hint {
  position: absolute;
  right: 12px;
  bottom: 7px;
  max-width: calc(100% - 24px);
  color: #8a4b00;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.35;
  text-align: right;
}
'''
    if s.count(anchor) != 1:
        raise SystemExit(f'css anchor count={s.count(anchor)}')
    s = s.replace(anchor, addition, 1)
p.write_text(s)

# 4) Connection Intelligence: build the selector from every HUB already known in
# Browser KV (connector, incident, history, shadow) plus configured bootstrap HUBs.
# This is read-only, cached for 10 minutes, and adds zero Turso/MS calls.
p = Path('cloudflare-browser-test/src/connection-error.js')
s = p.read_text()
old = '''// INTELLIGENCE_HUB_FILTER_V3: HUB selector is a Browser-KV read-only catalog. It never enrolls a HUB, writes KV, calls Turso, or calls MS.
async function connectedHubCatalog(env, currentHub = "") {
  const hubs = [];
  const add = (value) => {
    const hub = normalizeHub(value);
    if (hub && !hubs.includes(hub)) hubs.push(hub);
  };
  add(currentHub);
  try {
    const stored = parseJson((await env.STATE.get("hubs")) || "[]", []);
    for (const value of Array.isArray(stored) ? stored : []) add(value);
  } catch {}
  return hubs.sort((a, b) => a.localeCompare(b));
}
'''
new = '''// INTELLIGENCE_HUB_FILTER_V4: merge every Browser-KV-known HUB without Turso/MS reads.
// The discovery list is cached in-memory for 10 minutes; the page remains read-only.
const HUB_CATALOG_CACHE_MS = 10 * 60 * 1000;
let hubCatalogCache = { until: 0, hubs: [] };
async function connectedHubCatalog(env, currentHub = "") {
  const hubs = [];
  const add = (value) => {
    const hub = normalizeHub(value);
    if (hub && !hubs.includes(hub)) hubs.push(hub);
  };
  add(currentHub);
  const now = Date.now();
  if (hubCatalogCache.until > now) {
    for (const value of hubCatalogCache.hubs) add(value);
    return hubs.sort((a, b) => a.localeCompare(b));
  }
  try {
    const stored = parseJson((await env.STATE.get("hubs")) || "[]", []);
    for (const value of Array.isArray(stored) ? stored : []) add(value);
  } catch {}
  for (const value of String(env?.CONNECTOR_BOOTSTRAP_HUBS || "").split(",")) add(value);
  try {
    const prefixes = ["connector:", "connection:error:v1:", "connection:history:v2:", "shadow:tbr:v1:"];
    const pages = await Promise.all(prefixes.map((prefix) => env.STATE.list({ prefix, limit: 1000 })));
    pages.forEach((page, index) => {
      const prefix = prefixes[index];
      for (const item of page?.keys || []) add(String(item?.name || "").slice(prefix.length));
    });
  } catch {}
  hubCatalogCache = { until: now + HUB_CATALOG_CACHE_MS, hubs: [...hubs] };
  return hubs.sort((a, b) => a.localeCompare(b));
}
'''
if old in s:
    s = s.replace(old, new, 1)
elif 'INTELLIGENCE_HUB_FILTER_V4' not in s:
    raise SystemExit('connection intelligence catalog anchor not found')
p.write_text(s)
