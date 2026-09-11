from pathlib import Path

p = Path('.github/dev-tools/stage-dev-runtime.mjs')
s = p.read_text()
old = '''export function patchDevRootEntryWorker(source) {\n  const text = String(source || "");\n  if (text.includes("DEV_ROOT_ENTRY_V1")) return text;\n  const needle = `const url = new URL(request.url);\\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`;\n  if (!text.includes(needle)) {\n    throw new Error("DEV root entry anchor not found in worker source");\n  }\n  return text.replace(\n    needle,\n    `const url = new URL(request.url);\\n      // DEV_ROOT_ENTRY_V1: DEV-only staged entry route; canonical worker source is unchanged.\\n      if (url.pathname === "/") return Response.redirect(new URL("/ms.html", request.url), 302);\\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`,\n  );\n}\n'''
new = '''export function patchDevRootEntryWorker(source) {\n  const text = String(source || "");\n  if (text.includes("DEV_ROOT_ENTRY_V1")) return text;\n  // DEV_ROOT_ENTRY_ANCHOR_V2: anchor on the static-asset gate itself so a\n  // transport check may sit between URL parsing and the gate without creating\n  // another staging patch or changing canonical runtime behavior.\n  const needle = `if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`;\n  if (!text.includes(needle)) {\n    throw new Error("DEV root entry anchor not found in worker source");\n  }\n  return text.replace(\n    needle,\n    `// DEV_ROOT_ENTRY_V1: DEV-only staged entry route; canonical worker source is unchanged.\\n      if (url.pathname === "/") return Response.redirect(new URL("/ms.html", request.url), 302);\\n      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);`,\n  );\n}\n'''
if s.count(old) != 1:
    raise SystemExit(f'DEV root staging source anchor count={s.count(old)}')
p.write_text(s.replace(old, new, 1))
print('DEV_ROOT_ENTRY_ANCHOR_V2=PASS')
