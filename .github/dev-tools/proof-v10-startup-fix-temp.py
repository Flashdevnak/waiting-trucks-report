from pathlib import Path

ui = Path('worker/src/proof-ui-v10.js')
s = ui.read_text()
old = "if (!P || !window.__PROOF_V8_READY__ || typeof P.render !== 'function' || typeof P.searchEditorOptions !== 'function') {"
new = "if (!P || typeof P.render !== 'function' || typeof P.searchEditorOptions !== 'function' || typeof P.installProofEditor !== 'function') {"
if old not in s:
    if new not in s:
        raise SystemExit('Proof V10 startup anchor missing')
else:
    s = s.replace(old, new, 1)
ui.write_text(s)

test = Path('worker/tests/proof-command-center-v10.test.mjs')
t = test.read_text()
anchor = "  assert.match(ui, /PROOF_COMMAND_CENTER_V10/);\n"
insert = "  assert.match(ui, /PROOF_COMMAND_CENTER_V10/);\n  assert.doesNotMatch(ui, /__PROOF_V8_READY__/);\n  assert.match(ui, /typeof P\\.installProofEditor !== 'function'/);\n"
if insert not in t:
    if anchor not in t:
        raise SystemExit('Proof V10 startup test anchor missing')
    t = t.replace(anchor, insert, 1)
test.write_text(t)

print('PROOF_V10_STARTUP_GHOST_FLAG_REMOVED=YES')
print('PROOF_V10_STARTUP_DEPENDENCIES=ProofV2+render+searchEditorOptions+installProofEditor')
print('PROOF_POLLING_CHANGED=NO')
print('HISTORY_QUOTA_CHANGED=NO')
print('TBR_CHANGED=NO')
print('PRODUCTION_TOUCHED=NO')
