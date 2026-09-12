from pathlib import Path

p = Path('cloudflare-browser-test/src/connection-error.js')
s = p.read_text()
if 'INTELLIGENCE_HUB_FILTER_V3' not in s:
    marker = '// INTELLIGENCE_HUB_FILTER_V4: merge every Browser-KV-known HUB without Turso/MS reads.'
    if s.count(marker) != 1:
        raise SystemExit(f'V4 marker count={s.count(marker)}')
    compat = '// INTELLIGENCE_HUB_FILTER_V3: compatibility marker; V4 below is the active implementation.\n' + marker
    s = s.replace(marker, compat, 1)
p.write_text(s)
