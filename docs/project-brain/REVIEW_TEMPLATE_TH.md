# Review — [Task ID / Candidate]

- วันที่ UTC, ผู้ review, Owner และ Work Order ref
- Repository, exact base/ref, candidate commit หรือ patch SHA-256 และ ZIP SHA-256
- ตรวจ manifest และ changed-file allowlist ก่อนใช้ candidate ประเมินสิทธิ์เข้าถึงชุดหลักฐานและอายุเก็บ
- ระบุ Node/tool versions และ exact source/staged artifact (runtime tree, asset tree และ cache/version ที่ใช้)
- ตรวจ I03 และ builder gate ตาม scope ของงาน ระบุหลักฐาน, unresolved findings และผลกระทบต่อ gate
- แยก reproduction logs, GitHub Actions และ provider/runtime observations ระบุผล `PASS`, `FAIL`, `NOT RUN` หรือ `UNKNOWN` พร้อม SHA และตัวเลขจริง

| Gate | ผล | หลักฐาน | Blocker / ผู้รับผิดชอบ |
| --- | --- | --- | --- |
| Scope และ provenance | […] | […] | […] |
| Regression และ runtime parity | […] | […] | […] |
| Release/rollback identity และ permission | […] | […] | […] |

Owner verdict ให้ลง dated decision พร้อมสิทธิ์ที่ให้สำหรับงานนั้นและ ref ที่ตรวจรับ เช่น accept candidate หรือ authorize deploy ระบุ exact action ตามคำอนุมัติ แล้วอัปเดต Decision Log, Task/Release Ledger และ Handoff
