# Waiting Trucks Report — คู่มือเริ่มงานสำหรับ AI

Repository: `Flashdevnak/waiting-trucks-report`

- อ่าน [Project Brain Index](docs/project-brain/INDEX.md) และ [Handoff ปัจจุบัน](docs/project-brain/HANDOFF_CURRENT_TH.md) ก่อนวางแผนหรือแก้ไฟล์
- ตรวจ remote refs ของ `docs/wtr-main-brain-v1`, `codex/dev-recovery-contract-v2` และ `main` จาก GitHub ทุกครั้ง บันทึก SHA เต็ม เวลา UTC และ `git status --short --branch` ของ worktree ที่จะใช้ อ่านเอกสารและ Work Order จาก SHA ที่ตรวจแล้ว
- `docs/wtr-main-brain-v1` เก็บ Project Brain แยกจาก DEV source branch ต้องเปิดหรือ fetch โดยระบุ ref เอง ถ้าสาขาเอกสารยังเข้าไม่ได้ ให้ใช้ ZIP พร้อม manifest ที่ตรวจแล้วและบันทึกข้อจำกัด
- ถ้า source HEAD ต่างจาก Work Order ให้ตรวจ diff และเทียบหลักฐานกับผู้รับผิดชอบก่อนย้ายฐาน เก็บงานค้างจาก workspace เดิมไว้ก่อน checkout หรือ apply ซ้ำ
- ระบุโมเดลและระดับที่ Owner เลือก แจ้งเมื่อยืนยันหรือใช้ค่านั้นไม่ได้ ทำเฉพาะงานและ mutation ที่ Work Order อนุญาต การอนุมัติของงานหนึ่งใช้ได้กับงานนั้นเท่านั้น
- DEV-only ตามขอบเขตที่อนุมัติ Production อยู่สถานะ **RELEASE HOLD** ตรวจ staged runtime จาก builder และ ordered patch chain ทุกครั้งที่งานต้องพิสูจน์ runtime identity
- ปิดงานด้วย diff, รายการทดสอบและผลจริง, refs, artifact SHA-256 และ handoff การเผยแพร่ขึ้น GitHub ต้องตรวจ remote SHA และไฟล์จริงหลังเขียน
- ห้ามเก็บข้อมูลปฏิบัติการจริง, HAR ดิบ, credentials, session tokens, ข้อมูลส่วนบุคคล หรือภาพ sensitive ใน repo สาธารณะ
