from pathlib import Path

p = Path('.tmp/realtime_quota_hardening.py')
s = p.read_text()
old = r'''durable = replace_once(
    durable,
    ''' + "'''" + r'''      `  async fetch(request, env) {\\n    try {\\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\\n      env = wrapOriginManifestAssets(env);\\n      const url = new URL(request.url);`,''' + "'''" + r''',
    ''' + "'''" + r'''      `  async fetch(request, env) {\\n    try {\\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\\n      env = wrapOriginManifestAssets(env);\\n      const url = new URL(request.url);\\n      // MS_REALTIME_WS_V1: upgrade before the normal JSON GET wrapper.\\n      if (request.method === "GET" && url.searchParams.get("action") === "msStream" && String(request.headers.get("Upgrade") || "").toLowerCase() === "websocket")\\n        return msRealtimeStream(request, url, env);`,''' + "'''" + r''',
    "worker websocket route",
)'''
new = r'''durable = replace_once(
    durable,
    ''' + "'''" + r'''      `  async fetch(request, env) {\\n    try {\\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\\n      env = wrapOriginManifestAssets(env);\\n      const url = new URL(request.url);\\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`,''' + "'''" + r''',
    ''' + "'''" + r'''      `  async fetch(request, env) {\\n    try {\\n      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.\\n      env = wrapOriginManifestAssets(env);\\n      const url = new URL(request.url);\\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);\\n      // MS_REALTIME_WS_V1: upgrade after the static-asset gate and before JSON GET handling.\\n      if (request.method === "GET" && url.searchParams.get("action") === "msStream" && String(request.headers.get("Upgrade") || "").toLowerCase() === "websocket")\\n        return msRealtimeStream(request, url, env);`,''' + "'''" + r''',
    "worker websocket route",
)'''
if s.count(old) != 1:
    raise SystemExit(f'quota transform websocket anchor count={s.count(old)}')
p.write_text(s.replace(old, new, 1))
print('QUOTA_TRANSFORM_STAGING_ANCHOR_FIXED=PASS')
