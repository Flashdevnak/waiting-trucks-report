# Task Ledger

| Task | สถานะ ณ 2026-11-19 | ผู้รับผิดชอบ | Dependency / Ref | Deliverable |
| --- | --- | --- | --- | --- |
| WTR-BRAIN-001 | **BLOCKED ที่การเผยแพร่**; เอกสารครบใน ZIP ดู [Handoff](HANDOFF_CURRENT_TH.md) และ receipt | Work เตรียม, Owner ตรวจรับ | DEV source `e6fe36b01b34866f6f90294df572f0dd015913d5`; preflight + remote verification | เอกสาร 13 ไฟล์, manifest, ZIP, รายงาน trigger และ handoff |
| WTR-011 | **PENDING / NOT RUN** | Work เมื่อได้รับ Work Order เต็ม, Owner ตรวจรับ | ยืนยัน source HEAD, baseline และขอบเขต local-only ก่อนเริ่ม | Local candidate, exact staged runtime evidence, Node 22 logs และ manifest ตาม Work Order เต็ม |
| WTR-011R | **NOT STARTED — WAITING ON ACCEPTED WTR-011 CANDIDATE** | Reviewer, Owner ตัดสินใจ | ต้องมี WTR-011 candidate และหลักฐานที่ยอมรับแล้ว | Independent review ตาม Work Order WTR-011R |
| WTR-012, AI Skills, FLASHKIT | แยก Work Order | Owner กำหนด | อยู่นอก scope WTR-011 | รอ scope และอนุมัติแยกสำหรับแต่ละงาน |

เพิ่ม SHA, ผู้ตรวจรับ และลิงก์หลักฐานเมื่อเปลี่ยนสถานะ คำว่า prepared, accepted, pushed และ deployed ใช้ตามเหตุการณ์ที่มีหลักฐานของตัวเอง
