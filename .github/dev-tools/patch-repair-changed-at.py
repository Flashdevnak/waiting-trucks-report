from pathlib import Path

p = Path('.github/dev-tools/patch-ms-self-healing-supervisor.mjs')
s = p.read_text()
old = '        code: text(repair.code, 80),\\n        retryInMs: Math.max(0, Number(repair.retryInMs || 0)),\\n'
new = '        code: text(repair.code, 80),\\n        changedAt: text(repair.changedAt, 100),\\n        retryInMs: Math.max(0, Number(repair.retryInMs || 0)),\\n'
if new in s:
    raise SystemExit(0)
if s.count(old) != 1:
    raise SystemExit(f'repair changedAt anchor count={s.count(old)}')
p.write_text(s.replace(old, new, 1))
