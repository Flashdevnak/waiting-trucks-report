from pathlib import Path
p=Path('worker/src/proof-ui-v10.js')
s=p.read_text()
repls={
  'lineMode รถเสริม':'รถเสริม',
  'อ่านเฉพาะเมื่อเปิด • cache 5 นาที':'ข้อมูลจาก MS',
  'กดรายละเอียดเพื่ออ่านจาก MS':'—',
  'กำลังอ่านประวัติจาก Turso…':'กำลังโหลดประวัติ…',
  'Session MS ยังไม่พร้อม':'บัญชี MS ยังไม่พร้อม',
  'ชื่อบนใบปริ้นจะยึดจาก MS Session นี้':'ชื่อบนใบปริ้นยึดตามบัญชี MS',
}
for a,b in repls.items(): s=s.replace(a,b)
p.write_text(s)
print('PROOF_V13_VISIBLE_COPY=READY')
