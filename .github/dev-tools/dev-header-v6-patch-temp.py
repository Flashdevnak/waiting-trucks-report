from pathlib import Path

p = Path('.github/dev-tools/stage-dev-runtime.mjs')
s = p.read_text()

if 'DEV_HEADER_ALIGNMENT_V6' in s:
    print('DEV_HEADER_ALIGNMENT_V6=ALREADY_APPLIED')
    raise SystemExit(0)

# 1) Center the primary summary label in the full control by balancing icon/chevron columns.
old_summary = '.dev-unified-header .app-nav>summary{position:relative;min-height:52px;min-width:195px;display:grid;grid-template-columns:30px minmax(0,1fr) 18px;align-items:center;gap:10px;padding:7px 12px 15px;border:1px solid #434343;border-radius:6px;background:#222;color:#fff;cursor:pointer;list-style:none}'
new_summary = '.dev-unified-header .app-nav>summary{position:relative;min-height:52px;min-width:195px;display:grid;grid-template-columns:30px minmax(0,1fr) 30px;align-items:center;gap:10px;padding:7px 12px 15px;border:1px solid #434343;border-radius:6px;background:#222;color:#fff;cursor:pointer;list-style:none}'
if old_summary not in s:
    raise SystemExit('summary grid anchor missing')
s = s.replace(old_summary, new_summary, 1)

old_title = '.dev-unified-header .app-nav>summary>span:nth-child(2){font-weight:900;font-size:16px;line-height:1.2;white-space:nowrap}'
new_title = '.dev-unified-header .app-nav>summary>span:nth-child(2){min-width:0;font-weight:900;font-size:16px;line-height:1.2;white-space:nowrap;text-align:center;overflow:hidden;text-overflow:ellipsis}'
if old_title not in s:
    raise SystemExit('summary title anchor missing')
s = s.replace(old_title, new_title, 1)

old_small = '.dev-unified-header .app-nav>summary small{position:absolute;left:52px;bottom:6px;color:#d2d5d7;font-size:12px;line-height:1.2;white-space:nowrap;max-width:calc(100% - 82px);overflow:hidden;text-overflow:ellipsis}'
new_small = '.dev-unified-header .app-nav>summary small{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);color:#d2d5d7;font-size:12px;line-height:1.2;white-space:nowrap;width:calc(100% - 92px);max-width:calc(100% - 92px);text-align:center;overflow:hidden;text-overflow:ellipsis}'
if old_small not in s:
    raise SystemExit('summary subtitle anchor missing')
s = s.replace(old_small, new_small, 1)

# Keep the mobile symmetric grid too.
s = s.replace('grid-template-columns:30px minmax(0,1fr) 18px}.dev-unified-header .app-nav>summary small{display:none}', 'grid-template-columns:30px minmax(0,1fr) 30px}.dev-unified-header .app-nav>summary small{display:none}', 1)

# 2) A page whose permission-gated tools are all hidden must never open an empty dropdown.
return_anchor = '  return output;\n}\n\nfunction verifyDevUiShellSource'
tools_script = '''  if (!output.includes("DEV_TOOLS_EMPTY_STATE_V6")) {
    const toolsBehavior = `<script data-dev-tools-empty-state="v6">(()=>{const selector='.dev-unified-header .dev-page-tools .dev-tools-menu';const sync=()=>document.querySelectorAll(selector).forEach((menu)=>{let empty=menu.querySelector('.dev-tools-auto-empty');if(!empty){empty=document.createElement('span');empty.className='dev-tools-empty dev-tools-auto-empty';empty.textContent='ยังไม่มีเครื่องมือที่พร้อมใช้ในหน้านี้';menu.appendChild(empty);}const visible=[...menu.querySelectorAll('a,button')].some((item)=>!item.hidden&&!item.classList.contains('hidden')&&getComputedStyle(item).display!=='none');const info=[...menu.querySelectorAll('.dev-tools-empty:not(.dev-tools-auto-empty)')].some((item)=>!item.hidden&&getComputedStyle(item).display!=='none');empty.hidden=visible||info;});sync();const header=document.querySelector('.dev-unified-header');if(header)new MutationObserver(sync).observe(header,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});})();</script><!-- DEV_TOOLS_EMPTY_STATE_V6 -->`;
    output = output.replace("</body>", `${toolsBehavior}</body>`);
  }
'''
if return_anchor not in s:
    raise SystemExit('tools empty-state insertion anchor missing')
s = s.replace(return_anchor, tools_script + return_anchor, 1)

# 3) Add a durable release marker and polish the empty-state presentation.
marker = '/* DEV_HEADER_LAYOUT_V5: spacious dropdown icons plus a far-right status/refresh utility group. */\\n'
v6 = '''/* DEV_HEADER_LAYOUT_V5: spacious dropdown icons plus a far-right status/refresh utility group. */\\n/* DEV_HEADER_ALIGNMENT_V6: symmetric summary columns, centered labels and non-empty tools dropdowns. */\\n.dev-unified-header .dev-tools-auto-empty{min-height:46px;display:flex;align-items:center;justify-content:center;padding:10px 14px;border:1px dashed #4b4b4b;border-radius:7px;background:#232323;color:#cfd2d4;font-size:12.5px;line-height:1.4;text-align:center}\\n.dev-unified-header .dev-tools-auto-empty[hidden]{display:none!important}\\n'''
if marker not in s:
    raise SystemExit('V5 marker anchor missing')
s = s.replace(marker, v6, 1)

p.write_text(s)

t = Path('.github/dev-tools/stage-dev-runtime.test.mjs')
x = t.read_text()
needle = '''  assert.match(styled, /DEV_HEADER_LAYOUT_V5/);
  assert.match(styled, /grid-template-columns:40px minmax\\(0,1fr\\);column-gap:14px/);'''
replacement = '''  assert.match(styled, /DEV_HEADER_LAYOUT_V5/);
  assert.match(styled, /DEV_HEADER_ALIGNMENT_V6/);
  assert.match(styled, /grid-template-columns:30px minmax\\(0,1fr\\) 30px/);
  assert.match(styled, /text-align:center;overflow:hidden;text-overflow:ellipsis/);
  assert.match(styled, /grid-template-columns:40px minmax\\(0,1fr\\);column-gap:14px/);'''
if needle not in x:
    raise SystemExit('V5 test anchor missing')
x = x.replace(needle, replacement, 1)
t.write_text(x)

print('DEV_HEADER_CENTER_V6=PATCHED')
print('DEV_TOOLS_EMPTY_STATE_V6=PATCHED')
print('PRODUCTION_TOUCHED=NO')
