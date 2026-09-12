from pathlib import Path

p = Path('cloudflare-browser-test/src/tbr-intelligence-entry.js')
s = p.read_text()
old = '''async function configuredHubs(env) {
  if (!env?.STATE) return [];
  try {
    const hubs = JSON.parse((await env.STATE.get("hubs")) || "[]");
    return [...new Set((Array.isArray(hubs) ? hubs : []).map(cleanHub))];
  } catch {
    return [];
  }
}
'''
new = '''// TBR_INTELLIGENCE_HUB_CATALOG_V4: same read-only Browser-KV HUB catalog as Error Intelligence.
// No Turso reads/writes and no extra MS polling. Cache prevents repeated KV list scans per page load.
const TBR_HUB_CATALOG_CACHE_MS = 10 * 60 * 1000;
let tbrHubCatalogCache = { until: 0, hubs: [] };
async function configuredHubs(env, currentHub = "") {
  const hubs = [];
  const add = (value) => {
    const hub = cleanHub(value);
    if (hub && !hubs.includes(hub)) hubs.push(hub);
  };
  if (currentHub) add(currentHub);
  if (!env?.STATE) return hubs.sort((a, b) => a.localeCompare(b));

  const now = Date.now();
  if (tbrHubCatalogCache.until > now) {
    for (const value of tbrHubCatalogCache.hubs) add(value);
    return hubs.sort((a, b) => a.localeCompare(b));
  }

  try {
    const stored = JSON.parse((await env.STATE.get("hubs")) || "[]");
    for (const value of Array.isArray(stored) ? stored : []) add(value);
  } catch {}
  for (const value of String(env?.CONNECTOR_BOOTSTRAP_HUBS || "").split(",")) {
    if (String(value || "").trim()) add(value);
  }
  try {
    const prefixes = ["connector:", "connection:error:v1:", "connection:history:v2:", "shadow:tbr:v1:"];
    const pages = await Promise.all(prefixes.map((prefix) => env.STATE.list({ prefix, limit: 1000 })));
    pages.forEach((page, index) => {
      const prefix = prefixes[index];
      for (const item of page?.keys || []) add(String(item?.name || "").slice(prefix.length));
    });
  } catch {}

  tbrHubCatalogCache = { until: now + TBR_HUB_CATALOG_CACHE_MS, hubs: [...hubs] };
  return hubs.sort((a, b) => a.localeCompare(b));
}
'''
if 'TBR_INTELLIGENCE_HUB_CATALOG_V4' in s:
    print('TBR_INTELLIGENCE_HUB_CATALOG_V4=ALREADY_PRESENT')
elif s.count(old) != 1:
    raise SystemExit(f'configuredHubs anchor count={s.count(old)}')
else:
    s = s.replace(old, new, 1)
    old_call = '  const hubs = await configuredHubs(env);\n'
    new_call = '  const hubs = await configuredHubs(env, hub);\n'
    if s.count(old_call) < 1:
        raise SystemExit('intelligencePage configuredHubs call anchor missing')
    s = s.replace(old_call, new_call, 1)
    p.write_text(s)
    print('TBR_INTELLIGENCE_HUB_CATALOG_V4=PATCHED')
