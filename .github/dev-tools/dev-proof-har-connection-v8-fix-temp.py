from pathlib import Path
p=Path('.github/dev-tools/stage-dev-runtime.mjs')
s=p.read_text()
old='''    toast(`เชื่อมต่อปริ้นบาร์โค้ดรถ ${hub} สำเร็จ · ตรวจพบ request MS ${nf.format(msRequestCount)} รายการ`);'''
new='''    toast("เชื่อมต่อปริ้นบาร์โค้ดรถ " + hub + " สำเร็จ · ตรวจพบ request MS " + nf.format(msRequestCount) + " รายการ");'''
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    raise SystemExit('nested toast anchor not found')
p.write_text(s)
print('DEV_PROOF_HAR_NESTED_TEMPLATE_FIX=PASS')
