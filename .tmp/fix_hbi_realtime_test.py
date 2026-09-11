from pathlib import Path
p = Path('worker/tests/hbi-truck-photos.test.mjs')
s = p.read_text()
old = '''  assert.match(front, /apiGetOnce\\(\"msTruckPhotos\"/);\n  assert.doesNotMatch(front, /apiGet\\(\"msTruckPhotos\"/);\n  assert.match(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);'''
new = '''  assert.match(front, /apiGetOnce\\(\"msTruckPhotos\"/);\n  assert.doesNotMatch(front, /apiGet\\(\"msTruckPhotos\"/);\n  // HBI remains click-only; realtime Route transport is now WebSocket-first at\n  // the same 4-second visible cadence instead of direct HTTP polling.\n  assert.match(front, /pollMs:\\s*4000/);\n  assert.match(front, /setInterval\\(realtimeTick, CONFIG\\.pollMs\\)/);\n  assert.doesNotMatch(front, /setInterval\\(\\(\\) => state\\.auth && loadData\\(true\\), CONFIG\\.pollMs\\)/);'''
if s.count(old) != 1:
    raise SystemExit(f'HBI realtime assertion anchor count={s.count(old)}')
p.write_text(s.replace(old, new, 1))
print('HBI_REALTIME_REGRESSION_ALIGNMENT=PASS')
