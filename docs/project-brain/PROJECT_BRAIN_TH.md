# Project Brain — สถาปัตยกรรมและสัญญาปฏิบัติการ

Source snapshot `e6fe36b01b34866f6f90294df572f0dd015913d5` ของ `codex/dev-recovery-contract-v2` ตรวจจาก GitHub เมื่อ 2026-11-19 UTC

## โครงสร้างและขอบเขต

- Frontend แสดง Waiting Trucks, Supervisor, Proof และ PNO ใช้ Cloudflare Worker API กระบวนการ DEV ประกอบ staged runtime กับ assets จาก canonical source และ ordered patches
- DEV Worker ชื่อ `waiting-trucks-report-api-dev` ตั้ง `DB_BACKEND=turso` และไม่มี `d1_databases` ใน config มี `MsRefreshCoordinator` Durable Object แยกตาม HUB และ Cron ทุก 1 นาที ตรวจ DB backend และ active D1 bindings กับ runtime แยกต่างหาก
- Route/KIT, PreEntry, BusTime/TBR, HBI และ PNO มีขอบเขตหลักฐานของตัวเอง Browser Connector เป็นอีก Worker และมีช่องทาง build แยก Supervisor และ TBR Intelligence เป็น read-only projections ตาม contract
- จุดอ้างอิงคือ [DEV config](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/wrangler.dev.jsonc), [exact builder](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/build-exact-dev-runtime.mjs), [staging chain](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/stage-dev-runtime.mjs) และ [DEV deploy workflow](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/workflows/deploy-worker-dev.yml) ทดสอบ `worker/.dev-runtime/src/turso-index.js` และ assets ที่จะ deploy ตาม gate ของงาน
- **DEV-only** ตามสิทธิ์ของแต่ละงาน **Production RELEASE HOLD** รักษา `I03 NOT FIXED` และ `Builder ROOT CAUSE UNKNOWN` จนมีหลักฐานปิดประเด็น

## Lifecycle และ provenance

| เรื่อง | Contract |
| --- | --- |
| Inbound | Destination และ Drop เท่านั้น ใช้ KIT จาก Route `actualArrivalAt` หรือ TBR `scheduleTbrArrivalAt` ที่ valid และตรง exact trip เวลาที่เร็วที่สุดชนะ และ KIT ชนะเมื่อเท่ากัน |
| Metadata และ missing | `scheduleKitArrivalAt` มีไว้เป็น metadata TBR ที่ขาดเป็น `MISSING_UNCONFIRMED` ห้ามเติมด้วย KIT, ETA หรือจากคนละเที่ยว |
| Unloading | Route state 1 ยืนยันกำลังลงสินค้า ใช้ Schedule S, persisted effective start หรือ first state-1 observation ตามลำดับ Route state 2 เป็นเจ้าของ completion และ Schedule E เป็น timing/display หลังมีหลักฐานครบ |
| Drop release | Route state 2 ปิด unloading ส่วนการปล่อย Drop ต้องมี Route `actualDepartureAt` |
| Expiry | Waiting, unloading และ Drop awaiting release ออกจาก active queue เมื่ออายุ `>=12h` นับจาก earliest valid arrival หรือ proven unloading start เมื่อไม่มี arrival เก็บ enrichment ที่ยังค้างและไม่สร้าง event เทียม |
| Historical | Read-only point-in-time ใช้ `asOf` และเฉพาะหลักฐานที่ accepted ทันเวลา แสดง provenance ของข้อมูลมาช้าหรือขาด ใช้ predicate เดียวกันตาม contract สำหรับรายการ การ์ด metrics และ export |
| Live samples | `39/70` นาที และ TBR `12:37` ของ exact trip อยู่ที่ `NOT LIVE VERIFIED` |

## Cadence และ PNO

- UI ประมาณ 4s, shared Route ประมาณ 3s, healthy BusTime ประมาณ 12s, Cron 1m และ freshness stale เมื่อเกิน 20m ตาม operational contract รักษา dedupe/coalescing, quota และ cooldown ที่กำหนด ห้ามเพิ่มการ poll, retry หรือ provider calls ต่อ client
- HBI click-only และ PNO detail on-demand ใช้ cache/in-flight ร่วมกัน ส่วน [PNO passive coverage](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/pno-passive-coverage.js) เป็นการสังเกตแบบจำกัดร่วมต่อ HUB ที่ cadence 120s และ error backoff 5m ตามค่าที่กำหนดใน source การพบหน้าไม่พอยืนยันว่าไม่เคยสแกน
- รักษา PNO Option B เมื่อสลับ A → B เริ่ม B ทันที, stale results/QR เขียนทับ B ไม่ได้, in-flight ≤2 และรักษา coordinator/cache/dedupe/quota/rate limits เดิม รักษา QR ในรายการ PNO, รายการ backing bag และ truck header รวมทั้ง Excel 365 Place in Cell
- WTR-011 อยู่ก่อน WTR-011R และจำกัดงานตาม Work Order ที่ได้รับ WTR-012, AI Skills และ FLASHKIT อยู่นอกขอบเขต WTR-011

## Checkpoints และข้อมูลต่างช่วงเวลา

- [MS Operational Contract V1](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/docs/MS_OPERATIONAL_CONTRACT_V1.md) กำหนด Route ~3s ส่วน [Supervisor checkpoints](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/SUPERVISOR_CHECKPOINTS.md) เคยบันทึก Route 12s ที่ SUP-00 ให้เก็บทั้งสองรายการพร้อมช่วงเวลาและตรวจ runtime เมื่อจำเป็น
- [README](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/README.md) มี architecture รุ่น D1 และส่วน DEV Turso ปัจจุบัน [REC-07](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/docs/REC-07_DEV_DEPLOYMENT_READINESS.md) เคยบันทึก main push deploy ปัจจุบัน workflow ทั้ง DEV source และ main เป็น manual dispatch ให้ตรวจ YAML ที่ SHA ปัจจุบันทุกครั้ง
- [Recovery Checkpoint](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/RECOVERY_CHECKPOINT.md) เก็บประวัติ recovery #121, historical run IDs และ per-HUB acceptance เดิม [DEV Runtime Lock](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/docs/DEV_RUNTIME_LOCK_CHECKPOINT.md) เก็บ REC-00 และช่องว่างของ baseline เดิม แหล่งทั้งสองยังใช้ตรวจ provenance ของ checkpoint ได้
