# WTR System Knowledge Base — จุดเริ่มต้นสำหรับผู้รับช่วง

**สถานะ:** เอกสารความรู้ ไม่ใช่รหัสโปรแกรม ไม่ใช่คำสั่ง Deploy และไม่ใช่ผลการตรวจรับ Release  
**ฐาน Source:** `codex/dev-recovery-contract-v2` @ `e6fe36b01b34866f6f90294df572f0dd015913d5`  
**ฐาน Project Brain ก่อน Sync:** `docs/wtr-main-brain-v1` @ `f90b3bb2d2a5496c47ebd8775c1f1cdbc4fafa6a`  
**บันทึก:** 20 พฤศจิกายน 2026 (Asia/Bangkok)

## จะเข้าใจเว็บไซต์นี้อย่างไร

1. [SYSTEM_MAP_TH.md](SYSTEM_MAP_TH.md) — เว็บทำอะไร หน้าจอใดรับผิดชอบอะไร ใช้ Cloudflare, Turso, Durable Object และ Browser Connector อย่างไร
2. [SOURCE_OF_TRUTH_TH.md](SOURCE_OF_TRUTH_TH.md) — Route/KIT, BusTime/TBR และแหล่งข้อมูลประกอบ ขอบเขต authority และการ matching
3. [QUEUE_LIFECYCLE_RULES_TH.md](QUEUE_LIFECYCLE_RULES_TH.md) — กฎรถต้นทาง ปลายทาง จุดดรอป คิว เวลา SLA การออกจากคิว Business Day และ History
4. [RUNTIME_BUILD_RELEASE_TH.md](RUNTIME_BUILD_RELEASE_TH.md) — source canonical ≠ final staged runtime; builder, deployment, Node 22, identity pin, Turso/D1, quota, gates
5. [CURRENT_STATUS_TH.md](CURRENT_STATUS_TH.md) — สถานะล่าสุดของ WTR-011E, Blockers และสิ่งที่ต้องตรวจต่อ
6. [System Deep Study — ฉบับหลักฐาน](../references/SYSTEM_DEEP_STUDY_READONLY_20261120_TH.md) — รายงานยาวพร้อม Source References และข้อจำกัด

**ลำดับอำนาจ:** คำอนุมัติ Owner/Work Order ล่าสุดที่ผูก task → normative [MS Operational Contract](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/docs/MS_OPERATIONAL_CONTRACT_V1.md) และ Owner decisions → Source/Final Staged Hash ที่ระบุ SHA → ผล Test Log ที่มี manifest → Cloudflare Live Deployment ณ เวลาที่ตรวจ. อย่าใช้ข้อความใน Project Brain มาแทนการตรวจ Source/Live ล่าสุด.

**ห้าม:** ยกความสำเร็จของ Synthetic Test ไปอ้างว่า Live ผ่าน; สร้าง Trip ID; ใช้ proof/plate/ชื่อเส้นทาง/ETA-day เป็น identity ที่ไม่มีหลักฐาน; เผยแพร่ HAR, token, cookie, session, ข้อมูลผู้ขับหรือทะเบียน; หรือเปลี่ยนระบบโดยไม่มีสิทธิ์.

หลังเปิดงานทุกครั้ง ตรวจ remote DEV/docs/main HEAD ล่าสุด และแยก *SOURCE VERIFIED / TESTED / LIVE VERIFIED / NOT PROVEN* ให้ชัด.
