from pathlib import Path

p = Path('.github/dev-tools/stage-dev-runtime.mjs')
s = p.read_text()

if 'DEV_HEADER_INTERACTION_V4' in s:
    print('DEV_HEADER_INTERACTION_V4=ALREADY_APPLIED')
    raise SystemExit(0)

nav_icons = {
    '["ms.html", "🚚"': '["ms.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h10.5v9H3.5zM14 9h4l2.5 3v3.5H14z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/></svg>`',
    '["proof.html", "🧾"': '["proof.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V4h10v4M6 17H4.5V9h15v8H18M7 14h10v6H7z"/><path d="M16.5 11h.01"/></svg>`',
    '["waiting.html", "⏱"': '["waiting.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.8 1.8M9 3h6"/></svg>`',
    '["ms-report.html", "▥"': '["ms-report.html", `<svg class="dev-nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9h3v10M10.5 19V5h3v14M16 19v-7h3v7M4 19h16"/></svg>`',
}
for old, new in nav_icons.items():
    if old not in s:
        raise SystemExit('nav icon anchor missing: ' + old)
    s = s.replace(old, new, 1)

top_icons = {
    '<span class="nav-grid-icon">▦</span>': '<span class="nav-grid-icon" aria-hidden="true"><svg class="dev-nav-svg" viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/></svg></span>',
    '<span class="nav-grid-icon">⚙</span>': '<span class="nav-grid-icon" aria-hidden="true"><svg class="dev-nav-svg" viewBox="0 0 24 24"><path d="M14.5 5.5l4 4M13.5 6.5l-8 8a2.1 2.1 0 0 0 3 3l8-8M16.5 15.5l2 2"/></svg></span>',
    '<span class="nav-grid-icon">●</span>': '<span class="nav-grid-icon" aria-hidden="true"><svg class="dev-nav-svg" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c1.4-3.8 3.8-5.8 6.5-5.8s5.1 2 6.5 5.8"/></svg></span>',
}
for old, new in top_icons.items():
    if old not in s:
        raise SystemExit('top icon anchor missing: ' + old)
    s = s.replace(old, new, 1)

fn = s.index('export function patchDevUiShellSource(source, currentPage) {')
ret = s.index('  return output;', fn)
behavior = '''  if (!output.includes("DEV_EXCLUSIVE_DROPDOWNS_V4")) {
    const behavior = `<script data-dev-exclusive-dropdowns="v4">(()=>{const selector='.dev-unified-header details.app-nav';const close=(keep)=>document.querySelectorAll(selector).forEach((item)=>{if(item!==keep)item.open=false});document.addEventListener('click',(event)=>{const summary=event.target.closest('.dev-unified-header details.app-nav > summary');if(summary){close(summary.parentElement);return;}const action=event.target.closest('.dev-unified-header .app-nav-menu a,.dev-unified-header .app-nav-menu button');if(action){const owner=action.closest('details.app-nav');if(owner)owner.open=false;return;}if(!event.target.closest(selector))close(null);});document.addEventListener('keydown',(event)=>{if(event.key==='Escape')close(null);});})();</script><!-- DEV_EXCLUSIVE_DROPDOWNS_V4 -->`;
    output = output.replace("</body>", `${behavior}</body>`);
  }
'''
s = s[:ret] + behavior + s[ret:]

replacements = {
    '.dev-unified-header .app-nav>summary{min-height:44px;min-width:184px;display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:9px;padding:7px 11px;': '.dev-unified-header .app-nav>summary{position:relative;min-height:52px;min-width:195px;display:grid;grid-template-columns:30px minmax(0,1fr) 18px;align-items:center;gap:10px;padding:7px 12px 15px;',
    '.dev-unified-header .app-nav>summary>span:nth-child(2){font-weight:900;font-size:15px;white-space:nowrap}': '.dev-unified-header .app-nav>summary>span:nth-child(2){font-weight:900;font-size:16px;line-height:1.2;white-space:nowrap}',
    '.dev-unified-header .app-nav>summary small{color:#c9ccce;font-size:11px;white-space:nowrap}': '.dev-unified-header .app-nav>summary small{position:absolute;left:52px;bottom:6px;color:#d2d5d7;font-size:12px;line-height:1.2;white-space:nowrap;max-width:calc(100% - 82px);overflow:hidden;text-overflow:ellipsis}',
    '.dev-unified-header .nav-grid-icon{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;background:#ffd400;color:#111;font-size:15px;font-weight:900}': '.dev-unified-header .nav-grid-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:6px;background:#ffd400;color:#111}.dev-unified-header .dev-nav-svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.dev-unified-header .app-nav-menu a>b{font-size:15px;line-height:1.35}': '.dev-unified-header .app-nav-menu a>b{font-size:16px;line-height:1.35}',
    '.dev-unified-header .app-nav-menu a>small{color:#c5c8ca;font-size:11.5px;line-height:1.4}': '.dev-unified-header .app-nav-menu a>small{color:#cbd0d3;font-size:12.5px;line-height:1.45}',
}
for old, new in replacements.items():
    if old not in s:
        raise SystemExit('CSS anchor missing: ' + old[:80])
    s = s.replace(old, new, 1)

marker = '/* DEV_HEADER_POLISH_V3: status+refresh visual group, readable menus, account password entry. */\\n'
extra = '/* DEV_HEADER_POLISH_V3: status+refresh visual group, readable menus, account password entry. */\\n/* DEV_HEADER_INTERACTION_V4: larger labels, one-open-dropdown behavior, clean SVG icons and dedicated chevron. */\\n.dev-unified-header .app-nav>summary::marker{content:""}\\n.dev-unified-header .app-nav>summary::after{content:"⌄";grid-column:3;display:grid;place-items:center;color:#ffd400;font-size:19px;font-weight:900;line-height:1;transition:transform .16s ease}\\n.dev-unified-header .app-nav[open]>summary::after{transform:rotate(180deg)}\\n'
if marker not in s:
    raise SystemExit('V3 marker missing')
s = s.replace(marker, extra, 1)
s = s.replace('.dev-unified-header .app-nav>summary{grid-template-columns:28px 1fr}', '.dev-unified-header .app-nav>summary{grid-template-columns:30px minmax(0,1fr) 18px}', 1)
p.write_text(s)

t = Path('.github/dev-tools/stage-dev-runtime.test.mjs')
x = t.read_text()
old = 'assert.match(styled, /a>b\\{font-size:15px/);'
if old not in x:
    raise SystemExit('header font test anchor missing')
x = x.replace(old, 'assert.match(styled, /app-nav-menu a>b\\{font-size:16px/);\n  assert.match(styled, /DEV_HEADER_INTERACTION_V4/);\n  assert.match(styled, /summary::after\\{content:"⌄"/);', 1)
t.write_text(x)

print('DEV_HEADER_TEXT_V4=PATCHED')
print('DEV_DROPDOWN_EXCLUSIVE_V4=PATCHED')
print('DEV_HEADER_ICONS_V4=PATCHED')
