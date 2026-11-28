# WTR-011R — Gate B evidence and handoff

The text below preserves the original November 22 checkpoint. The [current release record](RELEASE_STATUS.md) and the [later preservation review](https://github.com/Flashdevnak/waiting-trucks-report/pull/126#issuecomment-7068123830) record subsequent evidence.

**ผลตรวจ ณ 22 พ.ย. 2026 (Asia/Bangkok) · EVIDENCE MISSING ทั้ง B1 และ B2**

Brain base `e8c3a0eda92d2380bedc0b8632534b9e46a8e19c` และ DEV source `afbe6e0e57b5d0a752303e39846538a439dda27d` ตรงกับ GitHub ก่อนเริ่ม ไม่พบ PR เปิดหรือ claim ใน Task Registry ที่ทับงาน WTR-011R จากหลักฐานที่ตรวจได้ ตรวจ WTR-011E/F จาก ZIP ที่ SHA-256 ตรงกับทะเบียนและตรวจ member manifests ผ่าน WTR-011P เป็น H-only release แยกต่างหากและยังติด CRED-002 ไม่มีการ Deploy ในงานนี้

[WTR-011E/F recovered records](WORK_ORDERS/RECOVERED_INDEX.md#wtr-011e) · [WTR-011P Owner decision](WORK_ORDERS/WTR-011P-OWNER-DECISION.md) · [DEV operational contract](https://github.com/Flashdevnak/waiting-trucks-report/blob/afbe6e0e57b5d0a752303e39846538a439dda27d/docs/MS_OPERATIONAL_CONTRACT_V1.md)

## Code confirmed and offline witnesses

| Gate | ต้นเหตุใน staged DEV `index.js` | ผลจำลอง |
|---|---|---|
| **B1 · Exact occurrence** | `markAuxiliaryOccurrenceAmbiguity` (~4081) มองเห็นการชนเมื่อมี Route IDs ต่างกันพร้อมกัน จากนั้น `findBusEnrichment` (~5155) ใช้ proof/attendance หรือ proof fallback และ queue-first (~4417) ใช้ proof/attendance อีกครั้ง ทั้งสองไม่มี crosswalk สำหรับกรณีเห็น Route เดียว แต่ BusTime เป็นของเที่ยวก่อนหน้า | Healthy TBR ของเที่ยวก่อนถูกผูกกับ Route ปัจจุบัน เปลี่ยนเวลาที่ใช้จาก KIT เป็น TBR และย้าย Bangkok business day ย้อนหนึ่งวัน ผ่าน optional coordinator, persistence, cache และ history ที่ cutoff รวมถึง desktop/mobile renderer ใน VM Control ที่มีสอง Route IDs พร้อมกันถูกกันออก |
| **B2 · Prior TBR-only admission** | `mergeMsOptionalResult` (~6865) กรอง failed map ใน enrich ของแถวเดิม แต่ส่ง map เดิมเข้า `msQueueFirstSourceRows` ตัวสร้าง synthetic row (~4463–4510) เช็ก queue key, age และ lifecycle โดยไม่มีเงื่อนไข source-failed/stale หรือ durable prior-admission receipt | Failed/stale observation ครั้งแรกสร้างแถว TBR-only โดยไม่มี Route row, history row หรือ DO storage write ขณะที่ healthy TBR-only ที่รับจริงอยู่ต่อได้ใน warm result แต่หา prior receipt ไม่ได้เมื่อเริ่ม coordinator ใหม่ |

HAR report เดิมพบ Route `data.items[].id` ในหน้าตัวอย่าง มี `route_id` บางแถว แต่ไม่พบ shared row/trip/occurrence ID ใน BusTime capture เดียว ฝั่ง HAR seed และ Worker sanitize เหลือ 8 กลุ่ม ใช้สมาชิก `value` และ dedupe ตาม proof/attendance/target ส่วน hot lane รับ raw rows แล้วรวมด้วย proof/attendance ภายใน HUB การ parse เส้นทาง, fleet date หรือรหัสที่ Route มีฝั่งเดียวจึงยังพิสูจน์คู่เที่ยวไม่ได้ การทดสอบซ้ำยืนยันว่า persisted Route key เปลี่ยนตาม ETA หรือ ETD fallback ได้แม้ raw Route ID เดิม

Route sync เขียน cache จาก `sync.rows` ก่อนเพิ่ม TBR-only projection ใน live response แถวที่เก็บหลัง enrich สามารถรักษา `asOf` cutoff ได้ แต่ cutoff ไม่ตรวจความถูกต้องของ identity ต้นทาง เวลา event หรือ `syncedAt` บน synthetic row จึงใช้ยืนยันการรับเข้าคิวเดิมหรือสร้างย้อนหลังไม่ได้

[Canonical Route/Worker source](https://github.com/Flashdevnak/waiting-trucks-report/blob/afbe6e0e57b5d0a752303e39846538a439dda27d/worker/src/index.js) · [Ordered stage](https://github.com/Flashdevnak/waiting-trucks-report/blob/afbe6e0e57b5d0a752303e39846538a439dda27d/.github/dev-tools/stage-dev-runtime.mjs) · [HAR seed source](https://github.com/Flashdevnak/waiting-trucks-report/blob/afbe6e0e57b5d0a752303e39846538a439dda27d/ms.js#L2983) · [Historical pointer](https://github.com/Flashdevnak/waiting-trucks-report/blob/afbe6e0e57b5d0a752303e39846538a439dda27d/worker/src/ms-history-pointer-v1.js)

## Focused test evidence

ทำงานกับ exact staged Worker และ composed `ms.js` จาก staged Turso entrypoint ภายในเครื่อง ใช้ SQLite memory fixture, in-memory coordinator และ seccomp ที่ปิด socket/connect/send ผลตรวจ pinned source, assets 28/28, runtime 27/27 และ composed bytes ของ DEV candidate ผ่าน Worker tree ตรง Golden ไม่มีการแก้ identity manifest หรือใช้ผลนี้เป็น release approval

| ชุด (ผ่าน/ทั้งหมด) | Golden DEV 650 `e6fe36b0` | DEV HEAD `afbe6e0e` | WTR-011B + E optional เดิม |
|---|---:|---:|---:|
| Occurrence safety assertions เดิม | 3/8 | 3/8 | 6/8 |
| WTR-011F staged failure witnesses และ controls | 5/5 | 5/5 | 5/5 |
| Queue-first, REC-01 และ REC-04 | 31/33 | 31/33 | 31/33 |
| Focused no-stale-overwrite และ provenance assertions | 5/5 | 5/5 | 5/5 |

- ผล **3/8** ของ DEV เท่ากับ Golden ทั้ง B1/B2 และอีกสามข้อของ suite จาก B ได้แก่ failed-source และ stale-source existing-Route attachment กับการรักษา previously accepted cross-midnight TBR ใน failed cycle สามข้อหลังผ่านใน B/E เดิมซึ่งยังไม่ได้รวมใน DEV HEAD
- **5/5 witnesses** หมายถึงพบ failure mechanisms และ controls ซ้ำ รวม ETA/ETD rekey, valid cross-midnight fixture และ zero external calls สอง failure assertions ของ Gate B ยังไม่ผ่าน
- **31/33** มี baseline failures เดิมทั้งสามชุด ได้แก่ Origin label assertion และ Origin-only placeholder ใน first-source check ส่วน KIT wins tie, Route state 2, actual departure และ historical cutoff ผ่านตาม assertions ที่ครอบคลุม
- **5/5 focused** รักษา TBR เดิมใน tested partial/known-evidence paths, หยุด collision ที่มองเห็นทั้งสอง Route IDs และไม่เติม late Schedule E/PreEntry ย้อน cutoff ผล B1/B2 และ failed/stale Route tests ด้านบนยังจำกัดการรับรอง no-overwrite
- **Node 22 NOT VERIFIED.** รันใหม่ด้วย Node 24.22.3 หลังไม่พบ Node 22 ในเครื่องและระบบปฏิเสธการนำ binary เพิ่มมารัน ผล Node 22 ของ WTR-011P เป็นคนละ scope การยืนยัน Gate B บน Node 22 ต้องรันชุดเดิมจากเครื่องที่มี Node 22.16.0 พร้อมใช้งาน
- **RUNTIME NOT VERIFIED.** ไม่มี DEV/Production calls, Provider refresh/replay, live database access หรือ deployment จึงยังไม่มีผลภาคสนามสำหรับ B1/B2 หรือ Drop 39/70 นาที

DEV artifact SHA-256: Worker tree `856050787802465955c4ce55c557414c4746391ba39d1daa82c9c7008c6d8a9b`, asset tree `f76ceb9f89bc6a140d09b18e398a34086e94f1aa59497c91b76f218a85fdaff8`, served `ms.js` `c082cfb24d291458986d4452a9d10e63c12469dcaa681ed6656aafb24f6cae15`. E comparison retained its original local identity and had no release permission.

## Evidence required for next action

| Gate | Minimum evidence | Acceptance |
|---|---|---|
| **B1** | Provider field contract หรือหลักฐานเดิมที่ Owner อนุมัติให้ใช้ แสดง Route row ID และ BusTime occurrence ID เดียวกัน หรือ authoritative crosswalk ระบุ namespace, HUB/role scope, cardinality และความคงที่เมื่อ ETA/ETD เปลี่ยน | ใช้คู่เที่ยวเดียวกัน คู่ proof/attendance ซ้ำคนละเที่ยว และคู่ข้ามเที่ยงคืนอย่างละกรณี ทุกคู่มีหลักฐานจริงที่ตรวจสอบย้อนกลับได้ ส่งเฉพาะ field paths/types, anonymized equality และผลทดสอบ |
| **B2** | Accepted decision receipt ที่ผูก occurrence, source observation/result, acceptance time และ scope รวมถึงหลักฐานอ่านคืนหลัง cold restart ก่อน failed/stale cycle | แยก healthy first admission, previously accepted recovery และ first-ever failed/stale อย่างชัดเจน หากไม่มี receipt เก่า ให้ระบุว่า historical admission พิสูจน์ไม่ได้ ใช้ prospective evidence หลัง Owner อนุมัติสัญญาการบันทึก |

ให้ Owner จัด field contract และหลักฐานที่มีอยู่แล้วก่อน โดยแชร์ผ่านช่องทางส่วนตัวและเผยแพร่เฉพาะสรุปที่ปกปิดข้อมูล หากหลักฐานเดิมไม่พอ ให้ขออนุมัติแยกสำหรับการสังเกตแบบ one-shot จากรอบ DEV ปกติ เฉพาะเมื่อพิสูจน์ได้ล่วงหน้าว่า **0 incremental Provider calls** ใช้ aliases ที่จับคู่ซ้ำได้ในชุดเดียว ตัด raw HAR, headers, cookies, tokens และข้อมูลส่วนบุคคล หากพิสูจน์ความเป็น passive ไม่ได้ ให้หยุดที่ field contract request

**Minimal implementation หลังมีหลักฐานและอนุมัติแยก**

1. ใช้ occurrence/crosswalk ที่ยืนยันแล้วในทั้ง HAR และ hot lane ก่อน dedupe ให้ enrichment, queue attach และ optional merge ใช้กติกาเดียวกัน ตรวจ exact match ก่อนเข้า Route cache/history เก็บ proof/attendance เพื่อค้นหาและแสดงผลตามเดิม
2. ป้องกัน failed/stale first-time admission โดยรักษา prior accepted row เฉพาะเมื่อมี receipt ที่ผูก occurrence ถูกต้อง ถ้าต้องกู้หลัง restart และแหล่งเดิมไม่มี receipt ให้ Owner อนุมัติ schema, retention, quota และ fallback แยกก่อนสร้าง durable state การปฏิเสธแบบ fail-closed ทันทีอาจทำให้ TBR ที่ถูกต้องหายจากคิวหลัง restart
3. เมื่อ KIT มาทีหลัง ให้ใช้ earliest valid arrival และ KIT ชนะ tie เฉพาะ occurrence เดิม รักษาการตัดสินใจก่อน cutoff, Route state 2 และ Drop actual-departure authority ให้ทดสอบเงื่อนไขนี้รวม valid cross-midnight, late evidence, first admission หลัง restart, no stale overwrite และ idempotency ก่อนเสนอนำขึ้น DEV

ผลชุดนี้รองรับการเลือกขอหลักฐานเพิ่ม ยังไม่มี patch สำหรับ Runtime และไม่มีผลยืนยันว่า fallback policy หรือ persistent admission ledger ผ่าน

## Reproduce without repeating the audit

1. Fetch exact DEV `afbe6e0e57b5d0a752303e39846538a439dda27d` และ Golden `e6fe36b01b34866f6f90294df572f0dd015913d5` เข้า isolated copies ตรวจ E/F ZIP SHA-256 ใน [Task Registry](tasks/TASK_REGISTRY.json) และ member manifests ใช้ `RECOVERY_HANDOFF_TH.md` จาก F สำหรับ B/E reference และวิธี stage/compose ใช้เฉพาะคำสั่ง local stage ใน DEV workflow พร้อม candidate pin จาก WTR-011P สำหรับ DEV HEAD
2. จาก F ใช้ `tests/offline-linux.py` และ `tests/gate-b-witness.mjs` บน Worker/served asset ที่ stage แล้ว จาก B ใช้ `reproduce/occurrence-gates.test.mjs` โดยตั้ง `WTR_WORKER_DIR` เป็น staged Worker source path ตรวจ SHA-256 ของ script ก่อนใช้
   - `gate-b-witness.mjs` — `717323dfb6a7258ae36537829fbd7ce3007a0dfebfd76507846babab137e38bb`
   - `occurrence-gates.test.mjs` — `ebe6dd7c132816ea7b637d83e2a2a6d62a27351419c74abe7c9253c0c6530a00`
   - `offline-linux.py` — `d7a7d7bb994580ad158b909c0af2c3a4e4a408f18e8729d0d08475e797f059ee`
3. ใช้ `node --test` กับ `.github/tests/ms-queue-first-source-v1.test.mjs`, `.github/dev-tools/rec-01-core-operational-truth.test.mjs` และ `.github/dev-tools/rec-04-history-freshness-truth.test.mjs` สำหรับ queue, lifecycle และ freshness ใช้ `dev-auxiliary-evidence-completeness.test.mjs` เจาะเฉพาะชื่อ `matching BusTime response|successful partial BusTime page|duplicate Route occurrences|KIT/TBR UI keeps|point-in-time history` สำหรับห้าข้อเสริม

**Production RELEASE HOLD. DEV Deploy NOT AUTHORIZED.**
