from pathlib import Path

stage = Path('.github/dev-tools/stage-dev-runtime.mjs')
s = stage.read_text()

old = '''  if (!output.includes("DEV_TOOLS_EMPTY_STATE_V6")) {
    const toolsBehavior = `<script data-dev-tools-empty-state="v6">(()=>{const selector='.dev-unified-header .dev-page-tools .dev-tools-menu';const sync=()=>document.querySelectorAll(selector).forEach((menu)=>{let empty=menu.querySelector('.dev-tools-auto-empty');if(!empty){empty=document.createElement('span');empty.className='dev-tools-empty dev-tools-auto-empty';empty.textContent='ยังไม่มีเครื่องมือที่พร้อมใช้ในหน้านี้';menu.appendChild(empty);}const visible=[...menu.querySelectorAll('a,button')].some((item)=>!item.hidden&&!item.classList.contains('hidden')&&getComputedStyle(item).display!=='none');const info=[...menu.querySelectorAll('.dev-tools-empty:not(.dev-tools-auto-empty)')].some((item)=>!item.hidden&&getComputedStyle(item).display!=='none');empty.hidden=visible||info;});sync();const header=document.querySelector('.dev-unified-header');if(header)new MutationObserver(sync).observe(header,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});})();</script><!-- DEV_TOOLS_EMPTY_STATE_V6 -->`;
    output = output.replace("</body>", `${toolsBehavior}</body>`);
  }
'''
new = '''  if (!output.includes("DEV_TOOLS_SAFE_EMPTY_V7")) {
    const toolsBehavior = `<script data-dev-tools-empty-state="v7">(()=>{const details=document.querySelector('.dev-unified-header .dev-page-tools details.app-nav');if(!details)return;const menu=details.querySelector('.dev-tools-menu');if(!menu)return;let empty=menu.querySelector('.dev-tools-auto-empty');if(!empty){empty=document.createElement('span');empty.className='dev-tools-empty dev-tools-auto-empty';empty.textContent='ยังไม่มีเครื่องมือที่พร้อมใช้ในหน้านี้';menu.appendChild(empty);}const sync=()=>{const visible=[...menu.querySelectorAll('a,button')].some((item)=>!item.hidden&&!item.classList.contains('hidden')&&getComputedStyle(item).display!=='none');const info=[...menu.querySelectorAll('.dev-tools-empty:not(.dev-tools-auto-empty)')].some((item)=>!item.hidden&&getComputedStyle(item).display!=='none');const shouldShow=!visible&&!info;if(empty.hidden===shouldShow)empty.hidden=!shouldShow;};const schedule=()=>queueMicrotask(sync);sync();details.addEventListener('toggle',()=>{if(details.open)schedule();});details.querySelector('summary')?.addEventListener('click',schedule);})();</script><!-- DEV_TOOLS_SAFE_EMPTY_V7 -->`;
    output = output.replace("</body>", `${toolsBehavior}</body>`);
  }
'''

if 'DEV_TOOLS_SAFE_EMPTY_V7' in s:
    print('DEV_TOOLS_SAFE_EMPTY_V7=ALREADY_APPLIED')
elif old not in s:
    raise SystemExit('V6 observer block not found')
else:
    s = s.replace(old, new, 1)
    stage.write_text(s)
    print('DEV_TOOLS_SAFE_EMPTY_V7=PATCHED')

# Add a regression that specifically forbids an attribute-observing MutationObserver in the tools helper.
test_file = Path('.github/dev-tools/stage-dev-runtime.test.mjs')
t = test_file.read_text()
marker = 'DEV tools empty-state is event-driven and cannot self-trigger an attribute observer loop'
if marker not in t:
    t += f'''\n\ntest("{marker}", async () => {{\n  const source = await readFile(new URL(".github/dev-tools/stage-dev-runtime.mjs", root), "utf8");\n  assert.match(source, /DEV_TOOLS_SAFE_EMPTY_V7/);\n  assert.match(source, /details\\.addEventListener\\('toggle'/);\n  assert.doesNotMatch(source, /new MutationObserver\\(sync\\)\\.observe\\(header/);\n  assert.doesNotMatch(source, /attributeFilter:\\['class','style','hidden'\\]/);\n}});\n'''
    test_file.write_text(t)
    print('DEV_TOOLS_SAFE_EMPTY_V7_REGRESSION=ADDED')
else:
    print('DEV_TOOLS_SAFE_EMPTY_V7_REGRESSION=ALREADY_PRESENT')

print('DEV_HEADER_ALIGNMENT_V6=PRESERVED')
print('DEV_EXCLUSIVE_DROPDOWNS_V4=PRESERVED')
print('DEV_HEADER_LAYOUT_V5=PRESERVED')
print('POLLING_CHANGED=NO')
print('TBR_PROOF_CHANGED=NO')
print('PRODUCTION_TOUCHED=NO')
