from pathlib import Path

# Keep the zero-DB lexical guard strict: UI explains the local circuit generically
# instead of naming the DB provider. This changes wording only, not runtime I/O.
js_path = Path("supervisor.js")
js = js_path.read_text(encoding="utf-8")
old_note = "circuit/backoff เป็น guard ที่บล็อกก่อน Turso fetch"
new_note = "circuit/backoff เป็น guard ที่บล็อกก่อน provider fetch"
if js.count(old_note) != 1:
    raise RuntimeError(f"SUP-12 regression fix failed: UI provider wording count={js.count(old_note)}")
js_path.write_text(js.replace(old_note, new_note, 1), encoding="utf-8")

# SUP-12 intentionally changes the cache key. Align all historical Supervisor
# harness assertions to the new canonical asset version without weakening tests.
changed = []
for path in Path("worker/tests").glob("supervisor-*.test.mjs"):
    source = path.read_text(encoding="utf-8")
    output = source.replace("20260915-sup11", "20260915-sup12")
    if output != source:
        path.write_text(output, encoding="utf-8")
        changed.append(str(path))

if not changed:
    raise RuntimeError("SUP-12 regression fix failed: no historical cache assertions updated")
print("SUP12_REGRESSION_FIX=PASS")
print("SUP12_CACHE_ASSERTIONS_UPDATED=" + ",".join(changed))
