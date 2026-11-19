# Project Brain — Waiting Trucks Report

เอกสารหลักระยะยาวของ WTR บน branch `docs/wtr-main-brain-v1` (ต้องตรวจ GitHub SHA สดก่อนใช้). Document branch ไม่ใช่ DEV runtime และไม่ถูกโหลดโดย AI โดยอัตโนมัติ: **ทุก Work Order ต้องสั่งให้อ่าน Index/AGENTS/Handoff ที่ exact ref**.

## อ่านตามลำดับ

1. [AGENTS.md](../../AGENTS.md) → [Current Handoff](HANDOFF_CURRENT_TH.md) → [สถานะล่าสุด](system/CURRENT_STATUS_TH.md)
2. [System Knowledge Base](system/README_TH.md) → [System Map](system/SYSTEM_MAP_TH.md) → [Source of Truth](system/SOURCE_OF_TRUTH_TH.md) → [Queue/Lifecycle Rules](system/QUEUE_LIFECYCLE_RULES_TH.md) → [Runtime/Release](system/RUNTIME_BUILD_RELEASE_TH.md)
3. [Project Brain Contract](PROJECT_BRAIN_TH.md) → [Owner Decision Log](DECISION_LOG.md)
4. [Task Ledger](TASK_LEDGER.md), [Release Ledger — historical](RELEASE_LEDGER.md) + [2026-11-20 release status](system/RELEASE_STATUS_20261120_TH.md), [Evidence Index — historical](EVIDENCE_INDEX.md) + [2026-11-20 evidence register](system/EVIDENCE_REGISTER_20261120_TH.md), [WTR-011 status](work-orders/WTR-011_STATUS.md), [WTR-011R status](work-orders/WTR-011R_STATUS.md)
5. [Recovery Playbook](RECOVERY_PLAYBOOK_TH.md), [Work Order Template](WORK_ORDER_TEMPLATE_TH.md), [Review Template](REVIEW_TEMPLATE_TH.md)
6. [System Deep Study (source-grounded reference)](references/SYSTEM_DEEP_STUDY_READONLY_20261120_TH.md)

## อำนาจและความใหม่ของหลักฐาน

- **สิทธิ์และการเปลี่ยนแปลง:** Work Order + Owner approval เฉพาะงาน เฉพาะ action. การอนุมัติ docs-only ไม่อนุมัติ WTR patch/deploy.
- **กฎธุรกิจ:** Normative Operational Contract, Owner Decision Log, exact source/candidate patch ไม่ใช่คำสรุปที่ไม่ได้พิสูจน์.
- **Code/Final Staged:** Git SHA, ordered patches, generated hash, results/logs โดยระบุ Node, fixtures และ source exact.
- **Runtime ปัจจุบัน:** Cloudflare deployments/traffic at check time; docs/latest code SHA ไม่ใช่ deployed version โดยอัตโนมัติ.
- **ความไม่แน่นอน:** บันทึก SOURCE VERIFIED / TESTED / LIVE VERIFIED / UNKNOWN / NOT PROVEN แยกกัน. หาก conflict ให้ใช้หลักฐานล่าสุดที่มี provenance และคงข้อความเก่าไว้ใน ledger เป็นประวัติ.

**บันทึกใหม่:** HAR ดิบกับข้อมูลส่วนบุคคล/Session ห้ามอยู่ใน GitHub นี้. WTR-011E ยัง LOCAL ONLY; WTR-011R HOLD; Production RELEASE HOLD.
