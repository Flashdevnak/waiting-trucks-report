# Work Order — [Task ID] [ชื่อ]

| หัวข้อ | ค่าที่ Owner ระบุ |
| --- | --- |
| Objective / acceptance | [ผลลัพธ์ที่ตรวจได้และข้อที่ถือว่าจบ] |
| Owner / executor / reviewer | [ชื่อหรือบทบาท] |
| Repository / source / target | [repo, ref, expected full SHA, target branch/environment] |
| Model / tools | [รุ่นและระดับ, fallback ที่อนุมัติ, Node version เมื่อเกี่ยวข้อง] |
| Authorization | [read-only/local/commit/push/PR/CI/dispatch/deploy/rollback] ระบุทีละการกระทำและเป้าหมาย |
| Scope | [allowlist เปลี่ยนได้, contracts, ห้ามเปลี่ยน] |
| Dependencies | [accepted candidate SHA, exact artifact, manifests] |
| Release holds / stop criteria | [preflight drift, evidence/security gates, permissions, CI/cost] |

1. **Preflight** — ดู repo/remote refs และ branch collision, working tree, current contracts และ release identity ตาม scope ยืนยัน trigger safety ก่อน mutation และระบุ UTC/แหล่งที่มา
2. **Implementation** — ใช้ exact base และ allowlist เก็บ pending state, log และ rollback checkpoint ที่เกี่ยวข้อง ห้ามขยายสิทธิ์จากงานอื่น
3. **Validation** — ระบุ test plan, version, exact commands, exit/count, failed baseline และ exact staged runtime/asset identity เมื่อเกี่ยวข้อง ระบุ owner-reported กับ observed
4. **Handoff** — source/target/candidate refs, changed files, per-file SHA-256, ZIP hash/manifest, test/run URLs, ผู้รับผิดชอบ, next permissible gate, recovery procedure
5. **End gate** — ตรวจ remote commit/file list หลังเผยแพร่ และ provider/runtime หลัง deploy ตามสิทธิ์ ถ้า blocked ระบุเหตุผลและส่ง artifact ที่กู้คืนได้
