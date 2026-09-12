from pathlib import Path

p = Path('style.css')
s = p.read_text()
marker = 'MS_CONNECTION_OUTER_SCROLL_V1'
if marker in s:
    print(f'{marker}=ALREADY_PRESENT')
    raise SystemExit(0)

old = '''.connector-setup-card {
  max-width: 720px;
}
.connector-dialog {
  width: min(94vw, 760px);
  max-height: 92vh;
  overflow: auto;
}
'''
new = '''/* MS_CONNECTION_OUTER_SCROLL_V1
   The modal shell owns viewport scrolling so the scrollbar stays at the far-right
   browser edge instead of living inside the white connection card. */
.connector-setup-card {
  width: min(100%, 720px);
  max-width: 720px;
  margin: 0 auto;
  border: 1px solid #9aa4ad;
  border-radius: 5px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
}
.connector-dialog {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 18px max(10px, env(safe-area-inset-right)) 18px max(10px, env(safe-area-inset-left));
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
html:has(.connector-dialog[open]),
body:has(.connector-dialog[open]) {
  overflow: hidden;
}
'''
if s.count(old) != 1:
    raise SystemExit(f'outer-scroll base anchor count={s.count(old)}')
s = s.replace(old, new, 1)

old_mobile = '''@media (max-width: 700px) {
  .connector-dialog {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
  }
  .connector-dialog .dialog-card { padding: 18px 15px; }
  .setup-steps { padding-left: 22px; }
  .setup-link { width: 100%; justify-content: center; text-align: center; }
}
'''
new_mobile = '''@media (max-width: 700px) {
  .connector-dialog {
    width: 100vw;
    height: 100dvh;
    max-height: none;
    padding: 10px max(6px, env(safe-area-inset-right)) 10px max(6px, env(safe-area-inset-left));
  }
  .connector-dialog .dialog-card { padding: 18px 15px; }
  .setup-steps { padding-left: 22px; }
  .setup-link { width: 100%; justify-content: center; text-align: center; }
}
'''
if s.count(old_mobile) != 1:
    raise SystemExit(f'outer-scroll mobile anchor count={s.count(old_mobile)}')
s = s.replace(old_mobile, new_mobile, 1)

p.write_text(s)
print(f'{marker}=PATCHED')
