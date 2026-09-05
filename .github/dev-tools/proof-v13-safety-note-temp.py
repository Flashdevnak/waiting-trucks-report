from pathlib import Path
p=Path('proof.html')
s=p.read_text()
marker="ปุ่มยกเลิกรถยังปิดไว้"
if marker in s:
    print('PROOF_V13_SAFETY_NOTE=ALREADY_PRESENT')
    raise SystemExit(0)
needle="</main>"
note="<p class='proof-safety-note-v13'>ปุ่มยกเลิกรถยังปิดไว้</p>     </main>"
if needle not in s: raise SystemExit('main close missing')
s=s.replace(needle,note,1)
p.write_text(s)
print('PROOF_V13_SAFETY_NOTE=READY')
