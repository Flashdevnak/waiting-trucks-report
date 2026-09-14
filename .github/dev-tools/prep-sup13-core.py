from pathlib import Path

path = Path("worker/tests/supervisor-core-shell.test.mjs")
text = path.read_text(encoding="utf-8")
old = "20260915-sup12"
new = "20260915-sup13"
if text.count(old) != 1:
    raise RuntimeError(f"expected exactly one core-shell JS cache token, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("SUP13_CORE_CACHE_PREP=PASS")
