from pathlib import Path

p = Path('.github/dev-tools/stage-dev-runtime.mjs')
s = p.read_text()

if 'DEV_HEADER_LAYOUT_V5' in s:
    print('DEV_HEADER_LAYOUT_V5=ALREADY_APPLIED')
    raise SystemExit(0)

# 1) Rebuild the visible header order as SYSTEM > TOOLS > ACCOUNT > [STATUS | REFRESH].
status_slot = '<div class="dev-shell-slot dev-shell-status">${meta.status}</div>'
refresh_slot = '<div class="dev-shell-slot dev-shell-refresh">${meta.refresh}</div>'
if status_slot not in s or refresh_slot not in s:
    raise SystemExit('header status/refresh slot anchor missing')
s = s.replace(status_slot, '', 1)
s = s.replace(refresh_slot, '', 1)
old_tail = '</div></details></div></nav></div></header>`;'
new_tail = '</div></details></div><div class="dev-utility-group" aria-label="สถานะระบบและรีเฟรช"><div class="dev-shell-slot dev-shell-status">${meta.status}</div><div class="dev-shell-slot dev-shell-refresh">${meta.refresh}</div></div></nav></div></header>`;'
if old_tail not in s:
    raise SystemExit('header account tail anchor missing')
s = s.replace(old_tail, new_tail, 1)

# 2) Keep the server-side generated-header verifier aligned with the new semantic order.
old_slots = '''  const slots = [
    "dev-shell-status",
    "dev-system-nav",
    "dev-page-tools",
    "dev-shell-refresh",
    "dev-account-menu",
  ];'''
new_slots = '''  const slots = [
    "dev-system-nav",
    "dev-page-tools",
    "dev-account-menu",
    "dev-shell-status",
    "dev-shell-refresh",
  ];'''
if old_slots not in s:
    raise SystemExit('header slot verifier anchor missing')
s = s.replace(old_slots, new_slots, 1)
old_count = '''  if ((header.match(/dev-shell-slot/g) || []).length !== 5) {
    throw new Error(`DEV UI ${currentPage} must have exactly five header slots`);
  }'''
new_count = '''  if ((header.match(/dev-shell-slot/g) || []).length !== 5) {
    throw new Error(`DEV UI ${currentPage} must have exactly five header slots`);
  }
  if (!header.includes('class="dev-utility-group"')) {
    throw new Error(`DEV UI ${currentPage} status and refresh must stay grouped`);
  }'''
if old_count not in s:
    raise SystemExit('header slot count anchor missing')
s = s.replace(old_count, new_count, 1)

# 3) Relabel the live online state without touching the page business logic.
return_anchor = '  return output;\n}\n\nfunction verifyDevUiShellSource'
status_script = '''  if (!output.includes("DEV_STATUS_LABEL_V5")) {
    const statusBehavior = `<script data-dev-status-label="v5">(()=>{const apply=()=>{document.querySelectorAll('.dev-unified-header .dev-shell-status .badge').forEach((badge)=>{if(badge.textContent.trim()==='ออนไลน์')badge.textContent='พร้อมใช้งาน';});};apply();const target=document.querySelector('.dev-unified-header .dev-shell-status');if(target)new MutationObserver(apply).observe(target,{childList:true,subtree:true,characterData:true});})();</script><!-- DEV_STATUS_LABEL_V5 -->`;
    output = output.replace("</body>", `${statusBehavior}</body>`);
  }
'''
if return_anchor not in s:
    raise SystemExit('status-label script anchor missing')
s = s.replace(return_anchor, status_script + return_anchor, 1)

# 4) Give dropdown icons their own fixed column and comfortable breathing room.
old_menu = '.dev-unified-header .app-nav-menu a{display:grid;grid-template-columns:28px 1fr;gap:2px 8px;padding:9px 10px;border-radius:6px;color:#fff;text-decoration:none}'
new_menu = '.dev-unified-header .app-nav-menu a{display:grid;grid-template-columns:40px minmax(0,1fr);column-gap:14px;row-gap:2px;align-items:center;padding:10px 12px;border-radius:7px;color:#fff;text-decoration:none}'
if old_menu not in s:
    raise SystemExit('dropdown grid anchor missing')
s = s.replace(old_menu, new_menu, 1)
old_icon = '.dev-unified-header .app-nav-menu a>span{grid-row:1/3;display:grid;place-items:center}'
new_icon = '.dev-unified-header .app-nav-menu a>span{grid-row:1/3;display:grid;place-items:center;width:40px;height:40px;border-radius:8px;background:#292929;color:#ffd400}'
if old_icon not in s:
    raise SystemExit('dropdown icon cell anchor missing')
s = s.replace(old_icon, new_icon, 1)

# 5) Replace V3 visual ordering with a dedicated far-right utility group.
old_order = '''.dev-unified-header .dev-shell-refresh{order:2;margin-left:-2px}\\n.dev-unified-header .dev-shell-status{order:1}\\n.dev-unified-header .dev-system-nav{order:3}\\n.dev-unified-header .dev-page-tools{order:4}\\n.dev-unified-header .dev-account-menu{order:5}\\n'''
new_order = '''.dev-unified-header .dev-system-nav{order:1}\\n.dev-unified-header .dev-page-tools{order:2}\\n.dev-unified-header .dev-account-menu{order:3}\\n.dev-unified-header .dev-utility-group{order:4;display:flex;align-items:stretch;gap:0;margin-left:8px;border:1px solid #414141;border-radius:9px;overflow:hidden;background:#1b1b1b}\\n'''
if old_order not in s:
    raise SystemExit('desktop header order anchor missing')
s = s.replace(old_order, new_order, 1)

# 6) Override status/refresh details as one visual control and add an online state dot.
marker = '/* DEV_HEADER_INTERACTION_V4: larger labels, one-open-dropdown behavior, clean SVG icons and dedicated chevron. */\\n'
v5 = '''/* DEV_HEADER_INTERACTION_V4: larger labels, one-open-dropdown behavior, clean SVG icons and dedicated chevron. */\\n/* DEV_HEADER_LAYOUT_V5: spacious dropdown icons plus a far-right status/refresh utility group. */\\n.dev-unified-header .dev-utility-group .dev-shell-status>.badge{display:flex;align-items:center;justify-content:center;min-width:118px;min-height:50px;padding:8px 13px;border:0;border-radius:0}\\n.dev-unified-header .dev-utility-group .dev-shell-refresh>.btn{min-width:96px;min-height:50px;padding:8px 13px;border:0;border-left:1px solid #d8b300;border-radius:0}\\n.dev-unified-header .dev-utility-group .dev-shell-status>.badge-online{border:0;background:#e9f8ef;color:#09683a}\\n.dev-unified-header .dev-shell-status>.badge-online::before{content:"";width:8px;height:8px;margin-right:8px;border-radius:50%;background:#19a75a;box-shadow:0 0 0 3px rgba(25,167,90,.14);flex:0 0 auto}\\n'''
if marker not in s:
    raise SystemExit('V4 marker anchor missing')
s = s.replace(marker, v5, 1)

# 7) Tablet/mobile layout: utility group is a coherent block; phone gets it above menus.
old_tablet = '@media(max-width:1100px){.dev-unified-header{position:relative}.dev-unified-header .site-header-inner{align-items:stretch;flex-wrap:wrap}.dev-unified-header .header-brand{width:100%;min-width:0}.dev-unified-header .dev-unified-actions{width:100%;margin-left:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.dev-unified-header .dev-shell-slot,.dev-unified-header .dev-shell-slot>*{width:100%}.dev-unified-header .app-nav>summary{width:100%;min-width:0}}'
new_tablet = '@media(max-width:1100px){.dev-unified-header{position:relative}.dev-unified-header .site-header-inner{align-items:stretch;flex-wrap:wrap}.dev-unified-header .header-brand{width:100%;min-width:0}.dev-unified-header .dev-unified-actions{width:100%;margin-left:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.dev-unified-header .dev-shell-slot,.dev-unified-header .dev-shell-slot>*{width:100%}.dev-unified-header .dev-utility-group{width:100%;margin-left:0}.dev-unified-header .app-nav>summary{width:100%;min-width:0}}'
if old_tablet not in s:
    raise SystemExit('tablet layout anchor missing')
s = s.replace(old_tablet, new_tablet, 1)
old_mobile = '@media(max-width:700px){.dev-unified-header .site-header-inner{padding:9px 10px 10px}.dev-unified-header .brand-copy strong{font-size:15px;white-space:normal}.dev-unified-header .brand-copy span{white-space:normal}.dev-unified-header .dev-unified-actions{grid-template-columns:1fr 1fr}.dev-unified-header .dev-shell-status{grid-column:1/-1}.dev-unified-header .dev-account-menu{grid-column:2}.dev-unified-header .app-nav>summary{grid-template-columns:30px minmax(0,1fr) 18px}.dev-unified-header .app-nav>summary small{display:none}.dev-unified-header .app-nav-menu{position:fixed;left:10px;right:10px;top:auto;width:auto;margin-top:6px}}'
new_mobile = '@media(max-width:700px){.dev-unified-header .site-header-inner{padding:9px 10px 10px}.dev-unified-header .brand-copy strong{font-size:15px;white-space:normal}.dev-unified-header .brand-copy span{white-space:normal}.dev-unified-header .dev-unified-actions{grid-template-columns:1fr 1fr;gap:7px}.dev-unified-header .dev-utility-group{grid-column:1/-1;grid-row:1;display:grid;grid-template-columns:minmax(0,1fr) auto;margin:0 0 1px}.dev-unified-header .dev-system-nav{grid-column:1;grid-row:2}.dev-unified-header .dev-page-tools{grid-column:2;grid-row:2}.dev-unified-header .dev-account-menu{grid-column:1/-1;grid-row:3}.dev-unified-header .app-nav>summary{grid-template-columns:30px minmax(0,1fr) 18px}.dev-unified-header .app-nav>summary small{display:none}.dev-unified-header .app-nav-menu{position:fixed;left:10px;right:10px;top:auto;width:auto;margin-top:6px}.dev-unified-header .dev-utility-group .dev-shell-status>.badge{min-width:0}.dev-unified-header .dev-utility-group .dev-shell-refresh>.btn{min-width:96px}}'
if old_mobile not in s:
    raise SystemExit('mobile layout anchor missing')
s = s.replace(old_mobile, new_mobile, 1)

p.write_text(s)

# Permanent regression: assert spacing, utility grouping and live-label contract.
t = Path('.github/dev-tools/stage-dev-runtime.test.mjs')
x = t.read_text()
old_test = '''test("DEV header polish keeps refresh beside online, readable menus, password and HAR entry", () => {
  const styled = stageStyle(styleSource);
  assert.match(styled, /DEV_HEADER_POLISH_V3/);
  assert.match(styled, /dev-shell-refresh\\{order:2/);
  assert.match(styled, /dev-shell-status\\{order:1/);
  assert.match(styled, /app-nav-menu a>b\\{font-size:16px/);
  assert.match(styled, /DEV_HEADER_INTERACTION_V4/);
  assert.match(styled, /summary::after\\{content:"⌄"/);
  assert.match(styled, /badge-online/);
});'''
new_test = '''test("DEV header V5 keeps spacious menu icons and groups status with refresh at the far right", () => {
  const styled = stageStyle(styleSource);
  assert.match(styled, /DEV_HEADER_POLISH_V3/);
  assert.match(styled, /DEV_HEADER_INTERACTION_V4/);
  assert.match(styled, /DEV_HEADER_LAYOUT_V5/);
  assert.match(styled, /grid-template-columns:40px minmax\\(0,1fr\\);column-gap:14px/);
  assert.match(styled, /app-nav-menu a>span\\{grid-row:1\\/3;display:grid;place-items:center;width:40px;height:40px/);
  assert.match(styled, /dev-utility-group\\{order:4;display:flex/);
  assert.match(styled, /dev-shell-status>\\.badge-online::before/);
  assert.match(styled, /summary::after\\{content:"⌄"/);
});'''
if old_test not in x:
    raise SystemExit('V4 header test anchor missing')
x = x.replace(old_test, new_test, 1)
t.write_text(x)

print('DEV_HEADER_SPACING_V5=PATCHED')
print('DEV_STATUS_LABEL_V5=PATCHED')
print('DEV_UTILITY_GROUP_V5=PATCHED')
print('PRODUCTION_TOUCHED=NO')
