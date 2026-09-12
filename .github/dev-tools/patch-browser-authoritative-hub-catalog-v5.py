from pathlib import Path

WORKER = Path('worker/src/index.js')
BROWSER = Path('cloudflare-browser-test/src/index.js')


def patch_worker():
    s = WORKER.read_text()
    marker = 'BROWSER_HUB_CATALOG_AUTH_V1'
    if marker in s:
        print(f'{marker}=ALREADY_PRESENT')
        return

    post_anchor = '''  if (action === "completeMsPairing") return ok(await completeMsPairing(body, env));\n  if (action === "connectorSync") return ok(await connectorSync(body, env));\n  const actor = await verify(body.token, env);\n'''
    post_repl = '''  if (action === "completeMsPairing") return ok(await completeMsPairing(body, env));\n  if (action === "connectorSync") return ok(await connectorSync(body, env));\n  // BROWSER_HUB_CATALOG_AUTH_V1: connector-authenticated, read-only HUB discovery for Browser TEST.\n  if (action === "connectorHubCatalog") return ok(await connectorHubCatalog(body, env));\n  const actor = await verify(body.token, env);\n'''
    if s.count(post_anchor) != 1:
        raise SystemExit(f'worker post anchor count={s.count(post_anchor)}')
    s = s.replace(post_anchor, post_repl, 1)

    fn_anchor = '''async function connectorSync(body, env) {\n  const hub = text(body.hub, 80).toUpperCase(), tokenHash = await sha256(text(body.connectorToken, 500));\n'''
    fn_repl = '''// BROWSER_HUB_CATALOG_AUTH_V1\n// Called at most once/hour by Browser cron. It never calls MS and never writes Turso.\nasync function connectorHubCatalog(body, env) {\n  const hub = text(body.hub, 80).toUpperCase();\n  const tokenHash = await sha256(text(body.connectorToken, 500));\n  const row = await env.DB.prepare(\n    "SELECT hub FROM ms_connector_tokens WHERE hub=? AND token_hash=? AND active=1",\n  ).bind(hub, tokenHash).first();\n  if (!row) fail("ตัวเชื่อมต่อไม่ถูกต้อง", "INVALID_CONNECTOR", 401);\n  const hubs = [...new Set((await knownMsBranches(env)).map((value) => text(value, 80).toUpperCase()).filter(Boolean))].sort();\n  return {\n    hub,\n    hubs,\n    quota: { tursoStatementsMax: 2, tursoWrites: 0, upstreamMsCalls: 0 },\n  };\n}\n\nasync function connectorSync(body, env) {\n  const hub = text(body.hub, 80).toUpperCase(), tokenHash = await sha256(text(body.connectorToken, 500));\n'''
    if s.count(fn_anchor) != 1:
        raise SystemExit(f'worker connectorSync anchor count={s.count(fn_anchor)}')
    s = s.replace(fn_anchor, fn_repl, 1)
    WORKER.write_text(s)
    print(f'{marker}=PATCHED')


def patch_browser():
    s = BROWSER.read_text()
    marker = 'BROWSER_AUTHORITATIVE_HUB_CATALOG_V5'
    if marker in s:
        print(f'{marker}=ALREADY_PRESENT')
        return

    main_api_anchor = '''async function mainApiFetch(env, payload) {\n  if (!env?.DEV_API?.fetch) throw new Error("DEV service binding missing");\n  const request = new Request(MAIN_API, {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify(payload),\n  });\n  return env.DEV_API.fetch(request);\n}\n\n'''
    main_api_repl = main_api_anchor + '''// BROWSER_AUTHORITATIVE_HUB_CATALOG_V5\n// Refresh only from Browser cron, at most once/hour. This adds no MS polling and no Turso writes.\nconst HUB_CATALOG_LEASE_KEY = "hub-catalog:lease:v1";\nconst HUB_CATALOG_LEASE_SECONDS = 60 * 60;\nfunction normalizeCatalogHub(value) {\n  const hub = String(value || "").trim().toUpperCase();\n  return /^[A-Z0-9_-]{2,20}$/.test(hub) ? hub : "";\n}\nasync function refreshAuthoritativeHubCatalog(env, storedHubs = []) {\n  if (!env?.STATE || !env?.DEV_API?.fetch) return storedHubs;\n  if (await env.STATE.get(HUB_CATALOG_LEASE_KEY)) return storedHubs;\n\n  const current = [...new Set((Array.isArray(storedHubs) ? storedHubs : []).map(normalizeCatalogHub).filter(Boolean))].sort();\n  for (const hub of current) {\n    const connectorToken = await env.STATE.get(`connector:${hub}`);\n    if (!connectorToken) continue;\n    try {\n      const response = await mainApiFetch(env, {\n        action: "connectorHubCatalog",\n        hub,\n        connectorToken,\n      });\n      const payload = await response.json().catch(() => ({}));\n      if (response.status === 401 && payload?.code === "INVALID_CONNECTOR") continue;\n      if (!response.ok || payload?.ok === false) continue;\n      const discovered = (Array.isArray(payload?.data?.hubs) ? payload.data.hubs : [])\n        .map(normalizeCatalogHub)\n        .filter(Boolean);\n      const merged = [...new Set([...current, ...discovered])].sort();\n      if (JSON.stringify(merged) !== JSON.stringify(current))\n        await env.STATE.put("hubs", JSON.stringify(merged));\n      await env.STATE.put(HUB_CATALOG_LEASE_KEY, new Date().toISOString(), { expirationTtl: HUB_CATALOG_LEASE_SECONDS });\n      return merged;\n    } catch {}\n  }\n  return current;\n}\n\n'''
    if s.count(main_api_anchor) != 1:
        raise SystemExit(f'browser mainApiFetch anchor count={s.count(main_api_anchor)}')
    s = s.replace(main_api_anchor, main_api_repl, 1)

    sync_anchor = '''async function syncConfiguredHubs(env) {\n  const storedHubs = JSON.parse((await env.STATE.get("hubs")) || "[]");\n  const bootstrapHubs = env.CONNECTOR_BOOTSTRAP_SECRET\n'''
    sync_repl = '''async function syncConfiguredHubs(env) {\n  let storedHubs = JSON.parse((await env.STATE.get("hubs")) || "[]");\n  storedHubs = await refreshAuthoritativeHubCatalog(env, storedHubs);\n  const bootstrapHubs = env.CONNECTOR_BOOTSTRAP_SECRET\n'''
    if s.count(sync_anchor) != 1:
        raise SystemExit(f'browser syncConfiguredHubs anchor count={s.count(sync_anchor)}')
    s = s.replace(sync_anchor, sync_repl, 1)
    BROWSER.write_text(s)
    print(f'{marker}=PATCHED')


patch_worker()
patch_browser()
