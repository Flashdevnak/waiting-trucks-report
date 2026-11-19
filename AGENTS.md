# Waiting Trucks Report — คู่มือเริ่มงานสำหรับ AI

Repository: `Flashdevnak/waiting-trucks-report`

**อ่านก่อนทุกงาน:** [Project Brain Index](docs/project-brain/INDEX.md), [System Knowledge Base](docs/project-brain/system/README_TH.md), [Current Handoff](docs/project-brain/HANDOFF_CURRENT_TH.md), และ Work Order/Owner approval ปัจจุบัน.

1. ตรวจ remote refs `docs/wtr-main-brain-v1`, `codex/dev-recovery-contract-v2`, `main` และ `git status` worktree ทุกครั้ง บันทึก SHA เต็ม อย่าเดาว่า expected HEAD ยังใหม่. หาก docs branch อยู่คนละ ref ให้เปิดอย่างชัดเจน; `AGENTS.md` ที่ root ของ DEV branch อาจไม่ใช่ฉบับนี้.
2. เข้าใจเว็บก่อนแก้: [System Map](docs/project-brain/system/SYSTEM_MAP_TH.md), [Source Truth](docs/project-brain/system/SOURCE_OF_TRUTH_TH.md), [Queue Lifecycle](docs/project-brain/system/QUEUE_LIFECYCLE_RULES_TH.md), [Runtime/Release](docs/project-brain/system/RUNTIME_BUILD_RELEASE_TH.md). KIT=Route, TBR=BusTime; Destination และ Drop ใช้ arrival rule ร่วมกัน; exact trip ยังไม่พิสูจน์บางกรณี.
3. เลือกโมเดลและระดับตาม Owner หากยืนยัน model จริงไม่ได้ให้รายงาน ไม่ทำเกิน scope, ห้ามโยก branch / apply patch ซ้ำโดยไม่ตรวจ diff/manifest.
4. สำหรับ DEV ต้องใช้ **Final Staged** ที่ build จาก exact builder และ ordered patch chain; canonical source ไม่ใช่ runtime. DEV Turso-only, active D1 binding ต้อง 0; Shared Coordinator/quotas ไม่เพิ่ม polling.
5. Source identity ไม่ใช่ release identity: แยก source SHA, candidate patch/asset hashes, Node version, functional Gate A, matching/admission Gate B, security, CI, Cloudflare Worker UUID/traffic, live acceptance.
6. WTR-011E ณ 20 Nov 2026: Gate A 17/17 synthetic + optional local patch; Gate B 6/8 and NOT PROVEN; Node22/Live Drop NOT VERIFIED; WTR-011R HOLD, I03 NOT FIXED, builder root cause unknown, Production RELEASE HOLD. ตรวจ [Current Status](docs/project-brain/system/CURRENT_STATUS_TH.md) กับ evidence ล่าสุดก่อนย้ำ.
7. ห้ามเผยแพร่ raw HAR, credentials, cookie, sessions, driver/plate, private provider payload หรือข้อมูลส่วนบุคคล. เผยแพร่ได้เฉพาะ sanitized fields, counts, hashes, Source References.
8. ปิดงานด้วยหลักฐาน: tests/logs/manifest/diff, approved actions, actual remote/deploy state, recovery handoff. **ห้าม Commit/Push/Actions/Deploy โดยไม่มี Owner approval ระบุชัด**; docs-only approval ไม่ใช่ deployment approval.
