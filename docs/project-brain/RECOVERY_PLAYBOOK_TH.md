# Recovery Playbook

## เปิดแชทธรรมดาใหม่

1. ส่งชื่อ repo, `docs/wtr-main-brain-v1`, `codex/dev-recovery-contract-v2`, task ID และ Work Order ฉบับเต็ม ขอให้เปิด [GitHub repository](https://github.com/Flashdevnak/waiting-trucks-report) แล้วตรวจทั้งสอง refs และ `main`
2. ถ้า docs ref ยังไม่มีหรือเข้าไม่ถึง ให้แนบ ZIP และ ZIP SHA-256 จากผลส่งมอบ อ่าน `WTR_BRAIN_001_RECEIPT_TH.md` และตรวจ `SHA256SUMS.txt` หลังแตกไฟล์ในโฟลเดอร์ใหม่ ให้เริ่มจาก AGENTS, Index และ Handoff แล้วชี้กลับไปที่ GitHub source SHA ที่ตรวจสด
3. แชทสรุป decisions และจัดทำ Work Order ต่อได้ การเปลี่ยน repo ต้องตรวจ remote และใช้สิทธิ์ที่ Owner ให้สำหรับงานนั้น

## เริ่ม Work session ใหม่

ใช้ clone/new worktree แยกจาก workspace ที่มีงานค้าง ยืนยัน origin เป็น repository ที่ถูกต้อง แล้วใช้ read-only preflight ต่อไปนี้จาก clone ของ repo

```bash
git remote get-url origin
git ls-remote --symref origin HEAD refs/heads/main refs/heads/codex/dev-recovery-contract-v2 refs/heads/docs/wtr-main-brain-v1
git fetch --no-tags origin main codex/dev-recovery-contract-v2
git status --short --branch
```

ถ้า docs ref มีอยู่ ให้ fetch แล้วเปิดด้วย SHA ที่ตรวจแล้ว

```bash
git fetch --no-tags origin refs/heads/docs/wtr-main-brain-v1:refs/remotes/origin/docs/wtr-main-brain-v1
git rev-parse origin/docs/wtr-main-brain-v1
git show origin/docs/wtr-main-brain-v1:AGENTS.md
git show origin/docs/wtr-main-brain-v1:docs/project-brain/HANDOFF_CURRENT_TH.md
```

ก่อนเริ่ม implementation ตรวจ base, remote drift, existing staged changes, model/Node 22 และ scope ของ task ทดสอบบน temporary worktree ที่ exact base และเก็บหลักฐานทุกรอบที่มีผล ตาม Work Order ของงานนั้น

## Session ล่มหรือ worktree หาย

1. รักษา workspace เดิมเป็นหลักฐาน ตรวจ status, staged diff, unstaged diff, untracked files และ Git refs/reflog ที่เข้าถึงได้ก่อนเดินหน้าต่อ จด base SHA กับ artifact SHA แยกกัน
2. ตรวจ SHA-256 ของ ZIP เทียบค่าจากผู้ส่ง แสดงรายการสมาชิกก่อนแตกไฟล์ ตรวจ path traversal, absolute paths, symlinks และ duplicate entries แล้วแตกในโฟลเดอร์ว่าง ตรวจ manifest, allowance และความครบของ files ก่อนเปิดหรือรันไฟล์จากชุดกู้คืน
3. ตรวจ diff ของ workspace เทียบกับ manifest/patch หากงานอยู่ใน staged tree แล้ว ให้ตรวจ byte identity ก่อนตัดสินใจ ขั้นตอน apply ใช้ได้กับ clean exact-base worktree ที่ diff ยังไม่มี ต้องตรวจ applicability และ scope ก่อนใช้
4. ถ้าฐานหรือ byte identity พิสูจน์ไม่ได้ ให้เก็บ artifacts แล้วบันทึกส่วนที่ recover ไม่ได้ ห้ามสร้างประวัติ commit จากคำบรรยาย ให้หยิบ checkpoint ที่ตรวจยืนยันได้ล่าสุด
5. บันทึก new handoff พร้อม base/target SHA, patch hash, affected files, approved actions, ทำแล้ว/ค้าง, test command/log/count และ blocker ปัจจุบัน แยกสถานะ local, remote กับ deployed

## ตรวจ release หรือ rollback

1. ตรวจ exact source SHA, workflow definition/guard, ordered staging, runtime/asset/cache hashes และ live Worker UUID/traffic แยกกัน ห้ามใช้ source HEAD สรุป deployed identity
2. ตรวจการอนุมัติที่ผูก environment และ exact UUID ก่อน rollback ยืนยัน known-good UUID และ compatibility โดยเฉพาะ database, bindings, assets และ cache
3. หลังการกระทำที่ได้รับอนุมัติ ให้ยืนยัน provider deployment/traffic และ smoke แบบที่ Work Order อนุญาต เก็บ incident timeline และ provenance Production ถือ `RELEASE HOLD`
4. หาก publish เอกสาร ให้ตรวจ branch collision, GitHub Actions push/create/workflow-run filters, Pages และ Git-linked builds ที่พบ เช่น Cloudflare Workers Builds แล้วตรวจ remote commit/file list หลังเผยแพร่ ห้ามใช้ force push หรือทดลอง publish เพื่อดูว่า trigger ทำงานหรือไม่
