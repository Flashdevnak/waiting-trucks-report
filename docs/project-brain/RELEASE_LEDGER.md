# Release Ledger

| รายการ | ค่าที่สังเกตหรือสถานะ | หลักฐาน |
| --- | --- | --- |
| Source branch | `codex/dev-recovery-contract-v2` @ `e6fe36b01b34866f6f90294df572f0dd015913d5` (WTR-009-DEV-009C) | [GitHub source commit](https://github.com/Flashdevnak/waiting-trucks-report/commit/e6fe36b01b34866f6f90294df572f0dd015913d5) |
| Default branch | `main` @ `39df260b214526c398e92e12444b5e144510812b` ณ preflight | [GitHub main snapshot](https://github.com/Flashdevnak/waiting-trucks-report/commit/39df260b214526c398e92e12444b5e144510812b) |
| DEV reference | `waiting-trucks-report-api-dev`, Version `650` ตรวจยืนยันแล้ว | Cloudflare Versions API ตรงกับ Work Order WTR-BRAIN-001 |
| DEV deploy identity | `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637`; Cloudflare รายงานรับ traffic 100% ณ preflight; deployment timestamp `2026-11-18T22:01:38.025692Z` | Cloudflare Deployments API แบบอ่านอย่างเดียวและ UUID ตรงกับ log ของ [GitHub job](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44407280473/job/135165771805) |
| DEV CI และ deployment | Deploy Worker DEV #778, manual dispatch ที่ source SHA ข้างต้น, `completed / success` รวม pinned SHA/Node 22, deploy, active D1 bindings step และ smoke ณ run เดิม | [GitHub Actions run #778](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44407280473) |
| Identity manifest | SHA-256 `7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30` | [Manifest ที่ source SHA](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/wtr009-dev-identity.json) |
| Manifest asset tree | `acdb8de0fac4f8cef4fd8c9ea4e17655062a7d9f4771a671fa8d07aa60edd1b4` | Expected identity ใน manifest |
| Manifest runtime tree | `856050787802465955c4ce55c557414c4746391ba39d1daa82c9c7008c6d8a9b` | Expected identity ใน manifest |
| Manifest cache / served asset | `20261119-wtr009-dev009b-excel365-in-cell-v1`; `ms.js` SHA-256 หลัง Origin Manifest composition `ed8a823eead4d71e92417806210ca9067fbf6f8505ed056f2093f14012440c2c` | Expected identity ใน manifest; งาน bootstrap ไม่ได้ยิง live smoke ซ้ำ |
| WTR-011 candidate SHA / gate | `PENDING / NOT RUN`, candidate และ Node 22 evidence `NOT ACCEPTED` | [WTR-011 status](work-orders/WTR-011_STATUS.md) |
| WTR-011R | `NOT STARTED` | [WTR-011R status](work-orders/WTR-011R_STATUS.md) |
| Rollback | งานนี้ไม่มี rollback เป้าหมาย rollback ของงาน deploy ครั้งต่อไปต้องมี UUID, exact source, asset/cache identity, approval และ smoke plan ที่ตรวจใหม่ | [Recovery Playbook](RECOVERY_PLAYBOOK_TH.md) |
| Production | **RELEASE HOLD** | Work Order WTR-BRAIN-001 |

Manifest ระบุ predeploy identity และ I03 ว่า `NOT FIXED` ใช้ run/job และ provider deployment สำหรับหลักฐานการ deploy แยกจากสถานะใน manifest การตรวจรับ Excel บนเครื่องผู้ใช้และตัวอย่าง `39/70` นาที / TBR `12:37` ต้องใช้หลักฐานเฉพาะกรณี
