from pathlib import Path

html_path = Path('ms.html')
css_path = Path('style.css')
js_path = Path('ms.js')

html = html_path.read_text()
start_anchor = '    <dialog id="ms-connection-dialog" class="connector-dialog">\n      <form class="dialog-card connector-setup-card" id="ms-connection-form">'
if html.count(start_anchor) != 1:
    raise SystemExit(f'ms.html start anchor count={html.count(start_anchor)}')
html = html.replace(
    start_anchor,
    '    <dialog id="ms-connection-dialog" class="connector-dialog">\n      <div class="connector-dialog-stage">\n        <form class="dialog-card connector-setup-card" id="ms-connection-form">',
    1,
)
dialog_start = html.index('    <dialog id="ms-connection-dialog" class="connector-dialog">')
dialog_end = html.index('    <dialog id="pending-parcels-dialog"', dialog_start)
block = html[dialog_start:dialog_end]
close_anchor = '      </form>\n    </dialog>\n\n'
if block.count(close_anchor) != 1:
    raise SystemExit(f'ms.html close anchor count={block.count(close_anchor)}')
block = block.replace(close_anchor, '        </form>\n      </div>\n    </dialog>\n\n', 1)
html = html[:dialog_start] + block + html[dialog_end:]
html_path.write_text(html)

css = css_path.read_text()
marker = '/* MS_CONNECTION_OUTER_SCROLL_V1'
end_marker = '.setup-steps {'
if css.count(marker) != 1:
    raise SystemExit(f'old outer-scroll marker count={css.count(marker)}')
start = css.index(marker)
end = css.index(end_marker, start)
new_block = '''/* MS_CONNECTION_OUTER_SCROLL_V2
   Three-layer contract: viewport dialog owns scroll, stage owns centering,
   white card owns content only. Native dialog sizing is overridden explicitly. */
dialog.connector-dialog {
  position: fixed !important;
  inset: 0 !important;
  width: 100% !important;
  max-width: none !important;
  height: 100dvh !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  box-sizing: border-box !important;
}
dialog.connector-dialog[open] {
  display: block !important;
}
.connector-dialog::backdrop {
  background: rgba(15, 15, 15, 0.62);
}
.connector-dialog-stage {
  width: 100%;
  min-height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 16px max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left));
  box-sizing: border-box;
}
.connector-dialog-stage > .connector-setup-card {
  position: relative;
  flex: 0 1 720px;
  width: min(720px, 100%);
  max-width: 720px;
  margin: 0;
  overflow: visible;
  border: 1px solid #9aa4ad;
  border-radius: 5px;
  background: #fff;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
  box-sizing: border-box;
}
html:has(.connector-dialog[open]),
body:has(.connector-dialog[open]) {
  overflow: hidden;
}
'''
css = css[:start] + new_block + css[end:]

old_mobile = '''@media (max-width: 700px) {
  .connector-dialog {
    width: 100vw;
    height: 100dvh;
    max-height: none;
    padding: 10px max(6px, env(safe-area-inset-right)) 10px max(6px, env(safe-area-inset-left));
  }
  .connector-dialog .dialog-card { padding: 18px 15px; }
  .setup-steps { padding-left: 22px; }
  .setup-link { width: 100%; justify-content: center; text-align: center; }
}'''
new_mobile = '''@media (max-width: 700px) {
  .connector-dialog-stage {
    padding: 10px max(8px, env(safe-area-inset-right)) 16px max(8px, env(safe-area-inset-left));
  }
  .connector-dialog .dialog-card { padding: 18px 15px; }
  .setup-steps { padding-left: 22px; }
  .setup-link { width: 100%; justify-content: center; text-align: center; }
}'''
if css.count(old_mobile) != 1:
    raise SystemExit(f'old mobile connector block count={css.count(old_mobile)}')
css = css.replace(old_mobile, new_mobile, 1)
css_path.write_text(css)

# Contract validation. JS remains layout-neutral: it only opens/closes the dialog.
html = html_path.read_text()
css = css_path.read_text()
js = js_path.read_text()
assert html.count('class="connector-dialog-stage"') == 1
assert '<dialog id="ms-connection-dialog" class="connector-dialog">\n      <div class="connector-dialog-stage">\n        <form class="dialog-card connector-setup-card" id="ms-connection-form">' in html
assert 'MS_CONNECTION_OUTER_SCROLL_V2' in css
assert 'MS_CONNECTION_OUTER_SCROLL_V1' not in css
for token in (
    'dialog.connector-dialog {',
    'inset: 0 !important;',
    'width: 100% !important;',
    'max-width: none !important;',
    'height: 100dvh !important;',
    'overflow-y: auto !important;',
    'overflow-x: hidden !important;',
    '.connector-dialog-stage {',
    'justify-content: center;',
    'flex: 0 1 720px;',
    'width: min(720px, 100%);',
):
    assert token in css, token
assert '.connector-setup-card {\n  width: min(100%, 720px);' not in css
assert 'el("ms-connection-dialog").showModal();' in js
assert 'el("ms-connection-close").onclick = () => el("ms-connection-dialog").close();' in js
assert 'ms-connection-dialog").style.' not in js

print('MS_CONNECTION_LAYOUT_V2=PASS')
print('SCROLL_OWNER=VIEWPORT_DIALOG')
print('CENTER_OWNER=CONNECTOR_DIALOG_STAGE')
print('WHITE_CARD_SCROLL_OWNER=NO')
print('MS_JS_LAYOUT_OVERRIDE=0')
