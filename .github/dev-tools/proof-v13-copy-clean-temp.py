from pathlib import Path
p=Path('proof.html')
s=p.read_text()
repls={
  'MS state 7':'รถมาถึงต้นทาง',
  'MS state 3':'รถออกจากต้นทาง',
  'lineMode รถเสริม':'รถเสริม',
  'ชื่อบนใบปริ้นจะยึดจาก MS Session นี้':'ชื่อบนใบปริ้นยึดตามบัญชี MS',
  'ชื่อบนใบปริ้นยึดจาก MS Session นี้':'ชื่อบนใบปริ้นยึดตามบัญชี MS',
}
for a,b in repls.items(): s=s.replace(a,b)
start=s.find("<p class='privacy-note'>")
if start>=0:
    end=s.find('</p>',start)
    if end>=0:s=s[:start]+s[end+4:]
p.write_text(s)
print('PROOF_V13_COPY_CLEAN=READY')
