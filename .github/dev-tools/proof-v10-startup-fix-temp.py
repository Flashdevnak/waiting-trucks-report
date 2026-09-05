from pathlib import Path

for path, runtime in [
    ('worker/src/proof-ui-v5.js', 'proofV6Runtime'),
    ('worker/src/proof-ui-v10.js', 'proofCommandCenterV10'),
]:
    p = Path(path)
    s = p.read_text()
    old = f"return new Response(`(${{{runtime}.toString()}})();`, {{"
    new = f"return new Response(`const __name=(target,value)=>target;(${{{runtime}.toString()}})();`, {{"
    if old in s:
        s = s.replace(old, new, 1)
    elif new not in s:
        raise SystemExit(f'browser bundle response anchor missing in {path}')
    p.write_text(s)

ui = Path('worker/src/proof-ui-v10.js')
s = ui.read_text()
old_gate = "if (!P || !window.__PROOF_V8_READY__ || typeof P.render !== 'function' || typeof P.searchEditorOptions !== 'function') {"
new_gate = "if (!P || typeof P.render !== 'function' || typeof P.searchEditorOptions !== 'function' || typeof P.installProofEditor !== 'function') {"
if old_gate in s:
    s = s.replace(old_gate, new_gate, 1)
elif new_gate not in s:
    raise SystemExit('Proof V10 startup dependency anchor missing')
ui.write_text(s)

test = Path('worker/tests/proof-command-center-v10.test.mjs')
t = test.read_text()
anchor = "  assert.match(ui, /PROOF_COMMAND_CENTER_V10/);\n"
checks = "  assert.match(ui, /PROOF_COMMAND_CENTER_V10/);\n  assert.doesNotMatch(ui, /__PROOF_V8_READY__/);\n  assert.match(ui, /typeof P\\.installProofEditor !== 'function'/);\n"
if checks not in t:
    if anchor not in t: raise SystemExit('V10 test anchor missing')
    t = t.replace(anchor, checks, 1)
extra_anchor = "  assert.match(control, /const PROOF_REFRESH_MS = 60_000/);\n"
extra = "  assert.match(control, /const PROOF_REFRESH_MS = 60_000/);\n  const v5 = await read('worker/src/proof-ui-v5.js');\n  assert.match(v5, /const __name=\\(target,value\\)=>target/);\n  assert.match(ui, /const __name=\\(target,value\\)=>target/);\n"
if extra not in t:
    if extra_anchor not in t: raise SystemExit('V10 self-contained asset test anchor missing')
    t = t.replace(extra_anchor, extra, 1)
test.write_text(t)

print('PROOF_V5_BROWSER_ASSET_SELF_CONTAINED=YES')
print('PROOF_V10_BROWSER_ASSET_SELF_CONTAINED=YES')
print('PROOF_V10_STARTUP_GHOST_FLAG_REMOVED=YES')
print('PROOF_POLLING_CHANGED=NO')
print('HISTORY_QUOTA_CHANGED=NO')
print('TBR_CHANGED=NO')
print('PRODUCTION_TOUCHED=NO')
