from pathlib import Path

hbi_path = Path('worker/tests/hbi-truck-photos.test.mjs')
hbi = hbi_path.read_text()
hbi_old = '''  assert.match(front, /apiGetOnce\\(\"msTruckPhotos\"/);\n  assert.doesNotMatch(front, /apiGet\\(\"msTruckPhotos\"/);\n  assert.match(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);'''
hbi_new = '''  assert.match(front, /apiGetOnce\\(\"msTruckPhotos\"/);\n  assert.doesNotMatch(front, /apiGet\\(\"msTruckPhotos\"/);\n  // HBI remains click-only; realtime Route transport is now WebSocket-first at\n  // the same 4-second visible cadence instead of direct HTTP polling.\n  assert.match(front, /pollMs:\\s*4000/);\n  assert.match(front, /setInterval\\(realtimeTick, CONFIG\\.pollMs\\)/);\n  assert.doesNotMatch(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);'''
if hbi.count(hbi_old) != 1:
    raise SystemExit(f'HBI realtime assertion anchor count={hbi.count(hbi_old)}')
hbi_path.write_text(hbi.replace(hbi_old, hbi_new, 1))

frontend_path = Path('worker/tests/frontend-requirements.test.mjs')
frontend = frontend_path.read_text()
frontend_old = 'assert.match(source, /DEV: archive stays lazy; live polling must never auto-read msArchive/);'
frontend_new = 'assert.match(source, /DEV: archive stays lazy; realtime transport never auto-reads msArchive/);'
if frontend.count(frontend_old) != 1:
    raise SystemExit(f'archive realtime assertion anchor count={frontend.count(frontend_old)}')
frontend_path.write_text(frontend.replace(frontend_old, frontend_new, 1))

print('REALTIME_REGRESSION_ALIGNMENT=PASS')
