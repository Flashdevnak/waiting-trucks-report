# Project Brain — Waiting Trucks Report

เอกสารบนสาขา `docs/wtr-main-brain-v1` เป็นจุดเริ่มของการส่งต่องาน ให้เปิด GitHub ที่ ref นี้โดยระบุชัดเจนและบันทึก commit SHA ที่เปิดจริง สำหรับ ZIP ให้ตรวจ manifest ก่อนอ่าน

## ลำดับการอ่าน

1. [AGENTS.md](../../AGENTS.md) และ [Handoff ปัจจุบัน](HANDOFF_CURRENT_TH.md)
2. [Project Brain และ contracts](PROJECT_BRAIN_TH.md) และ [Decision Log](DECISION_LOG.md)
3. [Task Ledger](TASK_LEDGER.md), [Release Ledger](RELEASE_LEDGER.md) และ [Evidence Index](EVIDENCE_INDEX.md)
4. สถานะ [WTR-011](work-orders/WTR-011_STATUS.md) และ [WTR-011R](work-orders/WTR-011R_STATUS.md) แล้วเปิด Work Order ฉบับเต็มที่ Owner อนุมัติ
5. [Recovery Playbook](RECOVERY_PLAYBOOK_TH.md), [Work Order Template](WORK_ORDER_TEMPLATE_TH.md) และ [Review Template](REVIEW_TEMPLATE_TH.md)

## อำนาจและหลักฐาน

| เรื่องที่ตัดสิน | แหล่งที่ใช้ |
| --- | --- |
| ขอบเขต สิทธิ์ และ release hold | Work Order และคำอนุมัติ Owner ที่ระบุ task, target, SHA และการกระทำ |
| พฤติกรรมที่ต้องรักษา | Operational Contract และการตัดสินใจ Owner ที่ผูกกับหลักฐาน |
| พฤติกรรมที่เกิดขึ้นใน source | ไฟล์หรือ diff ที่ Git SHA เต็ม และผลทดสอบบน source/exact staged artifact ที่ระบุ |
| การ deploy และสถานะ runtime | GitHub run/job ที่ผูก exact SHA, Cloudflare version/traffic และ smoke สำหรับเวลาที่ตรวจ |
| ประวัติและการส่งต่อ | Decision/Task/Release/Evidence ledgers และ timestamp ของหลักฐาน |

เก็บข้อขัดแย้งไว้ทั้งสองฝั่งพร้อม provenance และวันเวลา เมื่อข้อมูลไม่ครบใช้สถานะ `NOT RUN`, `NOT STARTED`, `NOT ACCEPTED`, `UNKNOWN` หรือ `OWNER-REPORTED / NOT INDEPENDENTLY VERIFIED` ตามจริง ผู้รับช่วงต้องตรวจความใหม่ของ refs อีกครั้งก่อนใช้ค่าจาก handoff
