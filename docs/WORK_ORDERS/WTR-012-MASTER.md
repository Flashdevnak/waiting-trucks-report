# WTR-012 MASTER — Permanent Online Project Brain, Complete Task Registry & DEV Recovery

**Project:** Waiting Trucks Report (WTR)  
**Repository:** https://github.com/Flashdevnak/waiting-trucks-report  
**DEV Branch:** `codex/dev-recovery-contract-v2`  
**Expected Starting HEAD:** `afbe6e0e57b5d0a752303e39846538a439dda27d`

**Preferred Model:** GPT-6.2 Sol — High  
**Fallback:** GPT-6 — High  
**Prohibited:** Astra / Astra Pro

**Execution:** ONE INTEGRATED WORK ORDER  
**Production:** RELEASE HOLD  
**DEV Deployment:** Explicit Owner Approval Required

คำสั่งนี้ใช้แทน WTR-012 และพรอม Project Brain / Recovery ที่ยังไม่ได้รันก่อนหน้านี้ทั้งหมด

Owner ต้องการแก้ปัญหาความต่อเนื่องของโครงการอย่างถาวร ไม่ต้องการการ Audit วนซ้ำหรือการสร้างระบบใหม่ที่ทำให้ระบบเดิมเสีย

---

# MISSION 0 — หลักการบังคับ

**PRESERVE FIRST. IMPROVE SECOND. REPLACE ONLY WHEN PROVEN BETTER.**

ระบบที่ทำงานได้ถูกต้องต้องได้รับการรักษาไว้ก่อน

AI ทุกตัวต้อง:

- ตรวจ Remote GitHub จริงก่อนเริ่ม
- อ่านระบบเดิมก่อนแก้ไข
- ไม่ใช้ Chat Memory เป็นหลักฐานแทน Source
- ไม่ออกแบบทับระบบเดิมโดยไม่มีเหตุผล
- เปลี่ยนเฉพาะจุดที่จำเป็น
- ทดสอบผลกระทบก่อนยอมรับการเปลี่ยนแปลง
- ไม่ตรวจสิ่งที่มีผล PASS อยู่แล้วซ้ำโดยไร้เหตุผล
- บันทึกงานกลับระบบกลางก่อนจบ
- ไม่ประกาศว่างานเสร็จหากหลักฐานยังไม่รองรับ

**เป้าหมายคือระบบพัฒนาต่อได้อย่างต่อเนื่อง แม้เปลี่ยนแชท Work หรือ AI ทั้งหมด**

---

# MISSION 1 — Establish Permanent Online Source of Truth

สร้าง GitHub ให้เป็นศูนย์กลางความรู้และสถานะงาน WTR อย่างถาวร

## 1.1 ตรวจและรักษา Baseline

อ่านข้อมูลจาก GitHub จริง:

- Source Code และ Branches
- Commits และ Git History
- Pull Requests ทั้ง Open, Closed, Merged และ Draft
- GitHub Issues ที่เกี่ยวข้อง
- Releases, Deployment Records และ CI Evidence ที่ยังเข้าถึงได้
- Recovery/Supervisor Checkpoints
- Operational Contract
- DEV Runtime Builder และ Patch Chain
- Security/Release Decisions
- Existing Work Orders

ตรวจ HEAD ก่อนทำงาน หากแตกต่างจาก Expected HEAD ให้ใช้สถานะล่าสุดที่ตรวจพบ พร้อมอธิบายความแตกต่างก่อนดำเนินการ

ห้าม Force Push หรือย้อน HEAD

## 1.2 สร้าง Canonical Project Brain Branch

ใช้ Branch:

`project-brain/wtr`

หาก Branch ยังไม่มี ให้สร้างจาก DEV HEAD ที่ตรวจแล้ว หากมีอยู่ให้ตรวจความต่อเนื่องและใช้ของเดิม ห้ามเขียนทับประวัติ

Project Brain Branch นี้จะเก็บเอกสารกลางโดยไม่เปลี่ยน Source SHA ที่ล็อกสำหรับ DEV Release

ก่อน Push ให้ตรวจ Workflow Triggers ว่าไม่มีการ Deploy Production หรือ DEV โดยอัตโนมัติจากการเปลี่ยนแปลงเอกสาร

อนุญาตให้ Commit และ Push เฉพาะ Branch กลางและ Branch งานที่แยกออกมา

## 1.3 สร้างโครงสร้างเอกสารกลาง

สร้างหรือปรับปรุงโดยไม่ลบหลักฐานเดิม:

**Root:**

- `AGENTS.md`
- `PROJECT_BRAIN.md`
- `DECISION_LOG.md`
- `NEXT_TASK.md`

**docs/:**

- `ARCHITECTURE.md`
- `OPERATIONAL_CONTRACT.md` หรืออ้างอิง Contract เดิมที่เป็นทางการ
- `RELEASE_STATUS.md`
- `EVIDENCE_INDEX.md`
- `NEW_AI_HANDOFF.md`
- `TASK_SYSTEM.md`
- `SYSTEM_BASELINE.md`

**docs/tasks/:**

- `TASK_REGISTRY.json`
- `TASK_INDEX.md`
- `ACTIVE_TASKS.md`
- `BACKLOG.md`
- `COMPLETED_TASKS.md`
- `BLOCKED_TASKS.md`
- `HISTORICAL_TASKS.md`
- `RECOVERY_GAPS.md`

**docs/WORK_ORDERS/:**

เก็บ Work Orders รายรหัส พร้อม Links ไปยังหลักฐานหรือ PR ที่เกี่ยวข้อง

สามารถปรับโครงสร้างย่อยได้หากมีเหตุผล แต่ต้องรักษา Entry Point กลางและความสามารถค้นคืนครบทุกประเภทงาน

**ห้ามสร้างเอกสารหลายชุดที่อ้างว่าตนเองเป็น Source of Truth พร้อมกัน**

---

# MISSION 2 — Complete Historical & Future Task Recovery

นี่คือภารกิจสำคัญที่สุด

Owner ต้องสามารถค้นหาและกลับมาทำงานใดก็ได้ ไม่ว่าจะเป็น:

**งานเก่า / งานเสร็จแล้ว / งานค้าง / งานใหม่ / งานยกเลิก / งานที่ถูกแทนที่ / งานที่ Deploy แล้ว / งานที่ยังไม่ Deploy**

## 2.1 สร้าง Universal Task Registry

กำหนด Task ID ที่ไม่ซ้ำกันและคงที่

แต่ละ Task ต้องบันทึกข้อมูลเท่าที่มีหลักฐานจริงดังนี้:

- Task ID และชื่อ
- คำอธิบายและวัตถุประสงค์
- ประเภทงาน
- สถานะปัจจุบัน
- ประวัติการเปลี่ยนสถานะที่มีหลักฐาน
- วันที่บันทึก/ตรวจล่าสุด
- Source / Base Branch
- Base SHA และ Implementation SHA
- Working Branch
- PR / Issue Links
- Work Order Links
- ผู้รับผิดชอบหรือ Owner Approval ที่เกี่ยวข้อง
- Dependencies และ Blockers
- Test Results
- Evidence References
- Merge Status
- Deployment Status
- Runtime Verification Status
- Remaining Risks
- Next Action
- Handoff Instructions

ห้ามสร้าง SHA, Test Result, วันที่ หรือ Owner Approval ขึ้นเอง

ไม่จำเป็นต้องมีข้อมูลครบทุก Field สำหรับ Historical Task แต่ต้องระบุ `UNKNOWN` หรือ `NOT RECOVERED` เมื่อหลักฐานไม่มี

## 2.2 นิยามสถานะมาตรฐาน

สถานะการดำเนินงาน:

`PROPOSED`  
`BACKLOG`  
`READY`  
`IN_PROGRESS`  
`BLOCKED`  
`IMPLEMENTED`  
`TESTED`  
`IN_REVIEW`  
`ACCEPTED`  
`COMPLETED`  
`CANCELLED`  
`SUPERSEDED`  
`UNKNOWN`

สถานะ Release ต้องแยกต่างหาก:

`NOT_DEPLOYED`  
`DEPLOY_PENDING`  
`DEPLOYED_DEV`  
`DEV_RUNTIME_VERIFIED`  
`PRODUCTION_HOLD`  
`DEPLOYED_PRODUCTION`  
`UNKNOWN`

ห้ามตีความว่า PR Merged เท่ากับ Deploy แล้ว

ห้ามตีความว่าผ่าน Tests เท่ากับ Runtime Verified แล้ว

## 2.3 กู้ทะเบียนงานจาก GitHub

ใช้ GitHub API/Connector หรือเครื่องมือที่มีสิทธิ์เข้าถึงจริง สืบค้นพร้อม Pagination:

- Open/Closed/Merged PR ทั้งหมดที่เข้าถึงได้
- Issues
- Branches
- Commits ที่เกี่ยวข้อง
- CI/Workflow Runs
- Release Tags และ Deployment Evidence
- Documents และ Work Orders เดิม

ค้นความสัมพันธ์ระหว่าง Task ID, PR, SHA, Branch และหลักฐาน

ต้องครอบคลุมรหัสงานเก่า เช่น WTR-001 ถึง WTR-011P และงานต่อยอดที่มีหลักฐาน รวมถึงรหัสอื่นที่พบจริง

**อย่าถือว่าการกล่าวถึงรหัสงานเท่ากับงานนั้นเสร็จแล้ว**

กรณีงานมีหลาย PR หรือหลาย Recovery Branch ต้องเชื่อมโยงเป็นงานเดียวกันตามหลักฐาน ไม่สร้าง Duplicate Records โดยไม่จำเป็น

หาก GitHub มีข้อมูลจำนวนมาก ให้สร้างระบบ Indexing/Import ที่ทำงานซ้ำได้ รองรับ Pagination และการอัปเดตแบบ Incremental ไม่ใช้การสรุปจาก PR เพียงหน้าแรก

ต้องรายงาน Coverage ตามจริงว่าอ่านครบแหล่งใด และแหล่งใดยังไม่ครบ

ข้อมูลจาก ZIP หรือ Local Session ที่ไม่ได้ Push ต้องระบุเป็น Recovery Gap และเชื่อมโยงกลับเมื่อสามารถกู้ไฟล์ต้นฉบับได้

## 2.4 รองรับการค้นและทำต่อ

ระบบต้องตอบคำถามเหล่านี้จาก GitHub ได้:

- งาน WTR-009 ทำถึงไหนแล้ว?
- WTR-011P มีโค้ดอะไรที่ Merge แล้ว แต่ยังไม่ Deploy?
- งานอะไร Blocked อยู่?
- งานอะไรทำเสร็จแต่ยังไม่ได้ตรวจ Runtime?
- งานที่เคยยกเลิกกลับมาทำต่อได้หรือไม่?
- งานใดเกี่ยวข้องกับ PNO, QR, Excel, KIT/TBR, Turso?
- งานใดต้องทำก่อนงานอื่น?
- งานล่าสุดอยู่ Branch ไหน และมี SHA อะไร?
- งานใหม่ควรตั้งต้นจาก Source ใด?

ทำให้ข้อมูลเหล่านี้มีโครงสร้างที่ค้นด้วย ID, ชื่อ, ประเภท, สถานะ และความสัมพันธ์ได้ ไม่ใช่ฝากไว้ในบทสนทนาอย่างเดียว

---

# MISSION 3 — Permanent New Work Lifecycle

ตั้งแต่สร้างระบบนี้สำเร็จ **ทุกงานใหม่ต้องเข้าระบบกลางตั้งแต่เริ่ม จนถึงการส่งมอบหรือปิดงาน**

## 3.1 Before Starting

AI ต้อง:

1. เปิด `docs/NEW_AI_HANDOFF.md`
2. อ่าน `AGENTS.md`
3. ตรวจ Branch และ HEAD ล่าสุด
4. อ่าน `PROJECT_BRAIN.md`
5. อ่าน `NEXT_TASK.md`
6. ค้น Task Registry เพื่อป้องกันงานซ้ำ
7. อ่าน Operational Contract ที่เกี่ยวข้อง
8. ตรวจ Work Order และ Evidence ที่เคยมี
9. ตรวจว่า Task เดียวกันถูก AI หรือ Work อื่นดำเนินการอยู่หรือไม่
10. ยืนยันขอบเขตที่ Owner อนุมัติ

ถ้า Task มีอยู่แล้ว ต้องดำเนินงานต่อภายใต้ Task ID เดิม ไม่สร้างรหัสใหม่เพียงเพราะเปลี่ยน AI

ถ้าเป็นงานใหม่ ให้ลงทะเบียน Task ID ใหม่และเชื่อมกับ GitHub Issue/Work Order ตามระบบที่เลือก

## 3.2 During Work

บันทึก:

- Current Base SHA
- Branch
- ขอบเขตการแก้ไข
- Decisions
- Tests
- Known Risks
- Blockers
- Milestones
- Next Action

หากงานถูกขัดจังหวะ ต้องสามารถใช้ Checkpoint ล่าสุดรับช่วงได้

อย่าบันทึกสถานะ IN_PROGRESS แล้วทิ้งไว้โดยไม่มี Next Action หรือหลักฐานอ้างอิง

## 3.3 On Completion

ก่อนประกาศว่าเสร็จ:

- ตรวจ Tests
- ตรวจ Changes และ Scope
- Commit/Push เฉพาะเมื่อได้รับอนุมัติ
- บันทึก Commit SHA
- เชื่อม PR/Issue/Evidence
- อัปเดต Task Registry
- อัปเดต Decision Log เมื่อมีการตัดสินใจใหม่
- อัปเดต Release Status เมื่อเกี่ยวข้อง
- อัปเดต Next Task
- อัปเดต New AI Handoff
- ตรวจว่าการเปลี่ยนแปลงปรากฏบน GitHub Remote จริง

หากไม่ได้รับอนุญาตให้ Push ต้องระบุชัดว่า Handoff ยังไม่ Durable และระบุไฟล์/ข้อมูลที่ยังอยู่เพียง Local

## 3.4 Prevent Lost Context

จัดทำเครื่องมือหรือวิธีมาตรฐานสำหรับ:

- Create Task
- Find Task
- Resume Task
- Update Task Status
- Register Evidence
- Register Decision
- Complete Task
- Reopen Task
- Generate Handoff
- Validate Registry

เลือกวิธีเรียบง่ายที่ AI หรือเครื่องมือหลายประเภทใช้ได้ เช่น Markdown + JSON + GitHub APIs

ห้ามเพิ่มฐานข้อมูลใหม่หรือบริการเสียเงินเพื่อเก็บ Project Brain หาก GitHub เพียงพอ

เพิ่ม Validation Script และ Focused Tests ตามความจำเป็น เพื่อป้องกัน Task ID ซ้ำ, Broken References, สถานะขัดแย้ง และ Handoff ไม่ครบ

---

# MISSION 4 — Universal AI Compatibility

ระบบต้องไม่ผูกกับ ChatGPT Memory, Work Session หรือ AI รุ่นใดรุ่นหนึ่ง

รองรับ:

- ChatGPT แชทใหม่
- ChatGPT Work
- Codex
- AI Coding Agent อื่น
- AI ที่อ่าน GitHub ผ่าน API
- AI ที่ Clone Repository ได้
- ผู้พัฒนามนุษย์

## 4.1 Universal Bootstrap

สร้าง `docs/NEW_AI_HANDOFF.md` ให้มี:

- Canonical GitHub URL และ Branch
- Exact Entry Point
- System Architecture
- Current DEV Branch
- Last Verified HEAD
- Active Tasks
- Blocked Tasks
- Latest Decisions
- Release Holds
- Recommended Next Task
- Task Retrieval Instructions
- Safe Execution Rules
- Update/Handoff Procedure

สร้างพรอมเริ่มต้นสั้น ๆ ที่สั่ง AI ใหม่ให้ดึงข้อมูลจาก GitHub และดำเนินงานต่อได้โดยไม่ต้องใช้ประวัติแชท

AI ต้องระบุให้ชัดว่าดึงข้อมูลจาก GitHub สำเร็จจริงหรือไม่

**ห้ามกล่าวว่าเข้าถึง GitHub ได้ หาก Connection ไม่พร้อม**

## 4.2 Multi-Agent Safety

รองรับหลาย AI ทำงานพร้อมกันโดย:

- มี Task Ownership / Claim ที่ตรวจสอบได้
- ไม่แก้ Branch เดียวกันโดยไม่ตรวจ Conflict
- ตรวจ Remote SHA ก่อน Commit/Push
- ไม่ Force Push
- ไม่เขียนทับ Evidence ของผู้อื่น
- ตรวจและรวมสถานะที่เปลี่ยนระหว่าง Session
- รักษา History ของ Decisions และ Task Status

หาก Registry มีความขัดแย้ง ให้หยุดเฉพาะการแก้ข้อมูลที่ขัดแย้ง ไม่หยุดงานอื่นที่ไม่เกี่ยวข้อง

## 4.3 Online Checkpoint

ทุก Work ที่มีสิทธิ์เขียน GitHub ต้องสร้าง Checkpoint ที่ตรวจสอบย้อนกลับได้เมื่อจบ Milestone สำคัญ

ห้ามอ้างว่า ChatGPT หรือ AI ทุกตัวซิงก์อัตโนมัติ หากไม่มีการทำงานจริงที่รองรับ

ต้องแยก:

- Successfully Pushed
- Local Only
- Pending Owner Approval
- Not Recovered

---

# MISSION 5 — Preserve Existing WTR Operational Behavior

ห้ามเปลี่ยน Business Logic ระหว่างการสร้าง Project Brain

ต้องศึกษาและรักษา Contract ที่ตรวจพบจริง โดยเฉพาะ:

- KIT/TBR Earliest Arrival และ Tie Rule
- Route-owned Unloading Completion
- Drop Release ตาม Actual Departure
- Queue Expiry
- Shared Coordinator และ Cache
- Refresh Cadence และ Rate Limits
- Quota Protection
- PNO Source Truth
- Historical asOf / Provenance
- Turso-only DEV
- D1 Bindings = 0
- QR และ Excel Export Contracts
- Security Gates และ Identity Pins
- DEV/Production Separation

บันทึกข้อกำหนดตาม Source และ Operational Contract ล่าสุด โดยไม่สร้างค่าหรือกฎใหม่จากความทรงจำ

---

# MISSION 6 — WTR-011P DEV Compatibility Recovery

งานนี้ยังค้าง และต้องมีความคืบหน้าในรอบเดียวกัน

## Current Evidence

- PR #122 / #123 Merged
- DEV HEAD `afbe6e0e57b5d0a752303e39846538a439dda27d` เป็น Starting Reference
- CI มีหลักฐาน PASS
- DEV Worker Version 650 เป็น Rollback Baseline ที่ตรวจรับก่อนหน้า
- Existing GitHub Credential: `CLOUDFLARE_API_TOKEN`
- New Workflow Requires DEV Publish / Observability Credentials
- Existing Cloudflare Token มี Entire Account Scope
- DEV-only Individual Worker Assets Upload Compatibility ยังไม่ได้พิสูจน์จริง
- Production RELEASE HOLD

ตรวจสอบสถานะล่าสุดก่อนยึดข้อมูลเหล่านี้เป็นปัจจุบัน

## Required Action

1. เปรียบเทียบ Workflow เดิมกับ Workflow หลัง PR #123 เฉพาะส่วนที่กระทบ Deploy
2. รักษา Identity Verification, Ref Guard, Sealed Publisher และ Security Tests
3. ออกแบบ Minimal Compatibility Recovery ที่ทำงานได้จริงตามข้อจำกัดของ Cloudflare
4. ทดสอบทางแก้แบบ Offline ก่อน
5. ไม่สร้าง Credentials ใหม่หรือแก้ของเดิมเอง
6. ไม่ใช้ Account-wide Token เพื่อ Deploy โดยไม่มี Owner Approval
7. แยกข้อเท็จจริงที่พิสูจน์แล้วออกจากการยอมรับความเสี่ยงของ Owner
8. หากต้องแก้โค้ด ให้ใช้ Branch แยกและเปิด Draft PR
9. บันทึกผลและ Blockers ลง Task Registry
10. จัด Final Approval Request เพียงฉบับเดียวสำหรับสิ่งที่ยังต้องให้ Owner ตัดสินใจ

ห้ามใช้ความไม่พร้อมของ DEV Deploy เป็นเหตุให้หยุดสร้างระบบ Project Brain

ไม่ต้องรัน Full CI ที่ผ่านแล้วซ้ำ หากไม่ได้เปลี่ยนสิ่งที่กระทบ Contract นั้น

ห้ามแก้ Business Logic เพื่อแก้ Credential Mapping

---

# MISSION 7 — Single-Session Execution & Durable Delivery

ดำเนินงานตามลำดับนี้ภายใน Work Order เดียว:

**Priority 1 — ONLINE BRAIN FIRST**

สร้าง Project Brain Branch, Core Documents, Task Schema, Bootstrap และ Push ให้ตรวจสอบได้จริง

**Priority 2 — RECOVER TASK HISTORY**

ดึงข้อมูล PR, Issues, Branches, Decisions และ Evidence ที่เข้าถึงได้ สร้าง Registry และ Recovery Gaps พร้อม Coverage

**Priority 3 — AUTOMATE HANDOFF**

สร้าง Validation/Lookup/Update Procedure และทดสอบการเริ่มต้นจาก Cold Session

**Priority 4 — DEV COMPATIBILITY**

เตรียม Patch Candidate และ Focused Tests ที่จำเป็น พร้อม Draft PR หากได้รับอนุญาตตามขอบเขตนี้

**Priority 5 — FINAL ONLINE CHECKPOINT**

อัปเดตทุกสถานะและ Push Handoff กลับ GitHub พร้อม Verify Remote

หาก Session หรือเครื่องมือมีข้อจำกัด ต้องทำให้ผลของ Priority ที่เสร็จแล้วอยู่บน GitHub ก่อน ไม่ปล่อยให้ผลงานทั้งหมดหายไปพร้อม Session

ห้ามสร้าง Work Order ใหม่เพียงเพราะมี Blocker เดิม หากยังมีส่วนอื่นในงานนี้ที่สามารถดำเนินการต่อได้

---

# EXECUTION AUTHORITY

Owner อนุญาต:

- Read GitHub และ Cloudflare Metadata เท่าที่มีสิทธิ์
- สร้างเอกสาร Project Brain
- สร้าง Task Registry
- สร้าง Scripts สำหรับ Task/Handoff Validation
- กู้ดัชนีหลักฐานจาก GitHub
- Local / Offline Tests
- สร้าง Branch ใหม่
- Commit และ Push เฉพาะ Branch งาน
- เปิด Draft PR
- อัปเดต Project Brain บน `project-brain/wtr`

ก่อน Push ต้องตรวจว่า Branch/Paths ที่เปลี่ยนไม่เรียก Production หรือ DEV Deploy Workflow โดยไม่ได้ตั้งใจ

**ห้าม:**

- Merge เข้า DEV หรือ Main
- Production Changes
- DEV Workflow Dispatch
- Cloudflare Deploy
- Rollback
- Database Migration
- Change Secrets / Tokens
- Relax Security Gates โดยไม่มี Approval
- Force Push
- เปลี่ยน Runtime Business Logic
- อ้างหลักฐานที่ไม่มีจริง

---

# FINAL ACCEPTANCE CRITERIA

งาน Project Brain ถือว่าสำเร็จเมื่อ:

1. มี Canonical Project Brain Branch บน GitHub จริง
2. Core Documents ถูก Commit/Push และอ่านจาก Remote ได้
3. มี Task Registry แบบค้นหาและอัปเดตได้
4. งานเก่า งานค้าง งานใหม่ และงานปิดแล้วใช้โครงสร้างเดียวกัน
5. มีดัชนีประวัติที่กู้ได้ พร้อม Coverage และ Recovery Gaps ตามจริง
6. มี Universal AI Bootstrap ที่ทดสอบการรับช่วงงานแบบไม่พึ่ง Chat History
7. มีระบบบันทึก Checkpoint/Handoff สำหรับงานใหม่
8. มี Decision/Release Status ที่ไม่อ้างสถานะเกินหลักฐาน
9. มี WTR-011P Compatibility Candidate หรือ Exact Technical Blocker ที่พิสูจน์แล้ว
10. มี Next Feature Work ที่อ้างอิงจาก Backlog จริง
11. ทุกผลลัพธ์ที่รายงานว่าออนไลน์แล้วต้องตรวจสอบ Remote ได้
12. มี Final Handoff พร้อม Entry Point สำหรับ AI ทุกตัว

**Do not claim "all history recovered" unless the indexed sources and coverage actually support it.**

DEV Deploy จะถือว่าเสร็จได้เฉพาะเมื่อมีการอนุมัติ Deploy จริงและตรวจ Runtime สำเร็จเท่านั้น ไม่ใช่เมื่อ Project Brain หรือ Patch Candidate เสร็จ

---

# FINAL REPORT FORMAT

รายงานกลับ Main Brain ครั้งเดียว โดยมี:

**A. ONLINE PROJECT BRAIN**  
Branch, Commit SHA, GitHub URL, File Inventory

**B. TASK REGISTRY**  
จำนวนงานตามสถานะ, Coverage, Recovery Gaps

**C. UNIVERSAL AI HANDOFF**  
Entry Point และ One-Line Bootstrap Prompt

**D. PRESERVED SYSTEM CONTRACTS**  
กฎเดิมที่รักษาไว้ และสิ่งที่ไม่ได้เปลี่ยน

**E. DEV RECOVERY**  
Patch/PR/Tests/Remaining Gate

**F. NEXT WORK**  
งานที่ทำต่อได้ทันที โดยอิงทะเบียนจริง

**G. OWNER APPROVAL REQUIRED**  
รายการการตัดสินใจที่เหลือเพียงชุดเดียว

หากบางส่วนยัง Blocked ให้สรุปตามจริง แต่ต้องส่งมอบงานที่ทำและ Push ได้แล้วก่อน

---

# FINAL OWNER DIRECTIVE

**GitHub is the durable source of truth.**

Old work, current work, future work, completed work, blocked work และ abandoned work ต้องมีระบบสืบค้นสถานะและหลักฐานในที่เดียวกัน

Changing ChatGPT conversations, Work sessions, Codex environments or AI providers must not require recreating WTR project knowledge from scratch.

Every AI must first retrieve the current online project state, preserve the established system, perform only its authorized scope, and write back a verifiable handoff.

**One project. One durable knowledge system. One task history. Continuous development.**

**Production RELEASE HOLD.**