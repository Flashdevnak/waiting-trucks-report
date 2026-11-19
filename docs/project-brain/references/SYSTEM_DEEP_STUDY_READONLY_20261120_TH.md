# WTR — System Deep Study / Read-only Baseline

**วันที่ตรวจ:** 20 พฤศจิกายน 2026 (Asia/Bangkok)  
**ขอบเขต:** ศึกษาระบบและหลักฐานก่อนงานถัดไป — ไม่มี Patch, Commit, Push, GitHub Actions Dispatch, Provider Calls, DB mutations หรือ Deploy  
**สถานะ:** TECHNICAL STUDY / NOT A RELEASE ACCEPTANCE

## 1. ฐานอ้างอิงและระดับความน่าเชื่อถือ

| Ref / Artifact | ผลตรวจ |
|---|---|
| GitHub DEV `codex/dev-recovery-contract-v2` | `e6fe36b01b34866f6f90294df572f0dd015913d5` ตรวจ Remote |
| GitHub Project Brain `docs/wtr-main-brain-v1` | `f90b3bb2d2a5496c47ebd8775c1f1cdbc4fafa6a` ตรวจ Remote |
| GitHub `main` | `39df260b214526c398e92e12444b5e144510812b` ตรวจ Remote |
| Git Tree | 518 entries; 496 blob files; tree ไม่ truncated |
| Cloudflare DEV Worker | `waiting-trucks-report-api-dev` — deployment `dabd7c50-61f0-4b51-ae23-93484304f474`, version UUID `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637`, traffic 100% ตาม read-only API ที่ตรวจครั้งนี้; Version 650 ตาม Release Ledger และ Cloudflare verification ก่อนหน้า |
| Cloudflare DEV Bindings | Assets, secrets, `MS_REFRESH_COORDINATOR` Durable Object; ไม่พบ D1 binding ในรายการที่อ่านได้; `DB_BACKEND=turso` จาก config/contract (ไม่ได้เปิดอ่านค่า secret) |
| DEV CI run #778 | `workflow_dispatch`, SHA เดียวกับ DEV, `completed/success` ณ 18 พ.ย. 2026 ตาม GitHub API — ไม่ถือเป็นผลทดสอบ Candidate 011E |
| WTR-011 / 011B / 011C / 011D / 011E | ตรวจ ZIP integrity และ manifest แต่ละชุดผ่าน (19/19, 29/29, 11/11, 8/8, 30/30); วิเคราะห์รายงาน/patch/log ใน WTR-011E; ไม่ได้สร้าง full runtime ในเซสชันนี้ |
| Route HAR และ BusTime HAR | วิเคราะห์ JSON Response ต้นฉบับแบบ Offline เฉพาะ schema/สถิติรวม ไม่ส่ง header/token/cookie/raw data ไปยัง GitHub |

**ระดับหลักฐาน:** `CODE` = อ่าน Source ที่ exact SHA, `CONTRACT` = ข้อกำหนด, `HAR` = Response ต้นฉบับที่ให้มา, `LOG` = หลักฐาน Work ที่ตรวจ hash แล้ว, `CLOUDFLARE` = read-only account data, `NOT VERIFIED` = ยังไม่ยืนยันบน runtime/field. ระดับเหล่านี้ต้องไม่ใช้สลับกัน.

## 2. แผนที่ระบบทั้งชุด

1. **UI และผู้ใช้:** `ms.html` / `ms.js` (คิวรถหลัก, Desktop/Mobile), `ms-report.html` / `ms-report.js` (รายงาน), `proof.html` / `proof.js`, `admin.html` / `admin.js`, `supervisor.html` / `supervisor.js`, รวมทั้งหน้า scan/warehouse และ assets ที่ root.
2. **API และพิสูจน์สิทธิ์:** `worker/src/index.js` รับ `/api` และแยก action สำหรับ authentication, settings, users, Route, historical, source connection, PreEntry, photos และอื่น ๆ; `worker/src/turso-index.js` คือ DEV entrypoint จัดลำดับ proof handlers, history pointer, static assets แล้วจึง delegate Core Worker.
3. **ฐานข้อมูล DEV:** Turso ผ่าน `worker/src/turso-d1.js` adapter ที่ให้ interface แบบ D1 แต่ **ไม่ได้หมายความว่าใช้งาน Cloudflare D1**; `worker/wrangler.dev.jsonc` กำหนด `DB_BACKEND=turso`, ไม่มี D1 bindings.
4. **Realtime และ coordination:** Frontend ใช้ shared WebSocket/leader/follower; `MsRefreshCoordinator` เป็น Durable Object ต่อ HUB พร้อม dedupe/coalescing, Cron 1 นาที. Client count ต้องไม่ทำให้ Provider Calls เพิ่มตามจำนวนผู้ดู.
5. **Route/KIT:** `/gw/nws/staff/ms/store/line/task` ผ่าน Route session. แปลง `actual_end_time` เป็น `actualArrivalAt`, `estimate_end_time` เป็น ETA, state/actual departure และ Route row ID เข้า Core Worker.
6. **BusTime/TBR:** `/api/fleet_time/getList` ผ่าน BusTime HAR seed และ shared hot lane; `fleet_sign_info` ใช้สกัด TBR, `kit_arrive_time` เป็น schedule KIT metadata. Source truth และ rate guard เป็นคนละเรื่องกับ Route lifecycle.
7. **แหล่งเสริม:** PreEntry ให้ parcel counts/expected shipments; HBI photos click-only; Origin Manifest เป็นอีก HBI session/flow; PNO detail/scan ให้หลักฐานระดับพัสดุหรือถุง ไม่ใช่ผู้รับรอง KIT/TBR โดยอัตโนมัติ.
8. **Supervisor/Intelligence:** Supervisor เป็น read-only source/lifecycle/completeness/quota projection; Browser Connector Worker มี Browser KV/Browser binding, service binding ไป DEV API, และ TBR Intelligence เป็น advisory/shadow ไม่ใช่ authority แก้คิว.
9. **ประวัติ:** `ms_route_history`, `ms_route_registry`, `ms_live_cache`, cancellations และ history pointer; historical `asOf` ต้องใช้ evidence ที่ accepted ได้ก่อน cutoff และไม่ backdate ข้อมูลที่มาถึงทีหลัง.

**ข้อระวังของเอกสาร:** `README.md` มีภาพสถาปัตยกรรม D1 แบบรุ่นก่อน ส่วน DEV ปัจจุบันใช้ Turso; ต้องอิง `wrangler.dev.jsonc`, exact staged entrypoint และ Cloudflare deployment ไม่ใช่อาศัย README เพียงอย่างเดียว.

## 3. Source of Truth ของรถ: Contract ที่ต้องรักษา

| ประเด็น | Truth Authority |
|---|---|
| KIT | **Route** `actualArrivalAt` |
| TBR | **BusTime** `scheduleTbrArrivalAt` ที่ถูกต้องและผูกกับเที่ยวที่มีสิทธิ์ |
| Used arrival สำหรับ Destination/Drop | เวลาแรกสุดของ **eligible KIT/TBR**; tie → KIT |
| ETA/ETD | แผน ใช้เทียบความตรงเวลา ไม่ใช่หลักฐานรถมาจริง |
| `scheduleKitArrivalAt` | metadata; ห้ามเป็น Actual KIT/Queue Admission/Business Day |
| Admission | Destination (`ปลายทาง`) และ Drop (`จุดดรอป`) ใช้กฎร่วม; TBR-first ได้โดยไม่เติม `actualArrivalAt` เทียม |
| Origin (`ต้นทาง`) | workflow ออกคลัง/ปล่อยรถเฉพาะทาง; ไม่ใช่ inbound waiting queue |
| Unloading started | Schedule S → persisted effective start → first observed Route state 1 ตาม contract; ห้ามใช้ arrival/ETA แทน |
| Unloading completed | Route `unloadingState=2`; Schedule E ใช้ timing/display เมื่อมี Route completion เท่านั้น |
| Destination done | Route state 2 |
| Drop release | ต้องมี Route `actualDepartureAt`; state 2 ปิดการลงของแต่ไม่ปล่อยรถเอง |
| Queue expiry | >= 12 ชม. จาก earliest eligible KIT/TBR หรือ proven unloading start fallback เมื่อ arrival ไม่มี; ห้าม ETA เป็น anchor |
| Bangkok business day | Destination/Drop จาก accepted usedArrival; Origin จาก Route `actualDepartureAt` |
| Historical read | `asOf` + `acceptedAt`/snapshot provenance; ข้อมูลมาช้าห้ามแก้ผลในอดีตย้อนหลัง |

**การยึดสองแหล่ง:** Route และ BusTime คือสองหลักฐานหลักของเวลาเข้ารถ ไม่ได้แปลว่าระบบโดยรวมมีเพียงสอง Provider — PreEntry/HBI/PNO/Manifest มีหน้าที่อื่นตามขอบเขตของตน.

## 4. ลำดับข้อมูลจริงและจุดเสี่ยง KIT/TBR

**A. HAR และ Provider:** Browser แยก Route HAR และ BusTime HAR. `ms.js` อ่าน Route session และ `busHarSeedItems()` แปลง Response BusTime เป็น 8 กลุ่มของ `{value:string}` แล้วกรอง/ตัดซ้ำด้วย Proof+Attendance+Target; `worker/src/index.js` ทำ `sanitizeBusSeedItems()` ซ้ำก่อนเก็บ seed ที่ encrypted credential record. Provider hot lane ที่อ่านตรงมีเส้นทาง raw item ที่ไม่ผ่าน HAR compaction แต่ยังรวมตามคีย์ใน `mergeItems()`.

**B. Matching:** `worker/src/index.js` มี `enrichMsRow()` / `findBusEnrichment()`, `msQueueFirstSourceRows()` ถูกประกอบเข้า Worker ด้วย `patch-ms-tbr-shadow-feed.mjs` และ patch อื่น. BusTime shared cache key เป็น `P:<proof>|A:<attendance>` ภายใน HUB. `syncMs()` ยังสร้าง persisted identity จาก HUB + Proof + Attendance + estimated arrival/departure (เมื่อมี Proof), หรือ fallback raw Route ID หากยังไม่มี Proof. ดังนั้นการเปลี่ยน ETA อาจเปลี่ยน persisted key และ Proof ซ้ำไม่ได้พิสูจน์ Trip Occurrence เดียวกัน.

**C. Staging:** canonical `ms.js` มี legacy `effectiveArrival` ที่ยังมอง `scheduleKitArrivalAt` แต่ ordered patch chain แก้ให้ Final Staged ใช้ `queueAdmissionArrival()` จาก KIT/TBR. ต้องตรวจ **Final Staged + composed served ms.js** ทุกครั้ง; อ่าน canonical แล้วสรุป runtime ไม่ได้.

**D. Persistence:** `ms_live_cache` เขียน Route snapshot ในเส้นทางก่อนสร้าง TBR-only synthetic view. `msQueueFirstSourceRows()` สร้าง TBR-only เป็น in-memory projection; ไม่เท่ากับ Durable Accepted Admission Receipt. Durable Object เก็บ `lastResult` ใน memory ซึ่งใช้ยืนยันว่าเคยรับจริงหลัง reset ไม่ได้ด้วยตัวเอง.

**E. HAR ดิบที่ได้รับ (Offline 20 พ.ย. 2026):** Route HAR 1 successful target response มี 100 entries (แถวแรก/หน้าแรก), `type_text`: Origin 55, Destination 44, Drop 1; `route_id` มีค่า 45/100. BusTime HAR 1 successful data response มี 22 entries/11 distinct Proof; 11 Origin + 11 Destination, field groups รวม 25 ชื่อ; ไม่พบ direct `id`, `route_id`, `trip_id`, `occurrence_id` ที่ root ของ 22 แถวนี้. มี Proof ตรง Route 11 ค่า แต่ Route ที่ตรงเป็น Origin ทั้งหมด. TBR parseable candidate อยู่ที่ Origin 11; Destination 11 ไม่มี และไม่พบ BusTime ที่ตรงกับ Drop ใน HAR ชุดนี้. จึงใช้ยืนยัน schema/field-loss ได้ แต่ **ไม่ใช่การยืนยันรถ Drop ของเคสจริง**.

**ข้อสรุป:** ความเสี่ยงที่ตัด/รวมคนละเที่ยวก่อน Matcher เป็นข้อค้นพบจากโค้ด; ยังไม่มี shared crosswalk ID ที่พิสูจน์ได้จากตัวอย่าง HAR. ห้ามใช้ Proof, ชื่อเส้นทาง, ทะเบียน, ETA day, เวลาใกล้กัน หรือ `acceptedAt` เพียงลำพังแทน Exact Trip Evidence.

## 5. Realtime, quota, source freshness

- `ms.js` ตั้ง target visible UI poll ~4 วินาที พร้อม WebSocket-first, snapshot-first, reconnect/follower watchdog และ cache first paint; ต้องระวัง reconnect ไม่ขยาย upstream work.
- Staging source patch กำหนด shared Route source floor ~3 วินาที; BusTime hot lane ~12 วินาที และ shared P1/P2/P3 priority; Cron ~1 นาที.
- Error/rate guard มี 5 นาที base cooldown สำหรับ BusTime และ shared dedupe. Turso adapter มี read circuit breaker และ heavy-read guard เพิ่มเติม.
- Canonical source freshness stale เมื่อเกิน 20 นาที (ที่ 20 นาทีพอดียัง FRESH) แต่ cached value ไม่เท่ากับ source healthy.
- Browser Connector มี separate cron/KV และ TBR Intelligence แบบ `queueAuthority=false`, `providerAuthority=false`, `historyAuthority=false`, extra polling 0.
- Passive PNO source มี `cadenceMs:120000`, `maxRoutesPerCycle:2`, `maxPagesPerCycle:4`, `maxConcurrency:1`, `errorBackoffMs:300000`; เป็นขอบเขตเฉพาะ DEV ที่มี implementation ต่อจาก Contract เวอร์ชันก่อนหน้า. ตรวจข้อกำหนด Owner ล่าสุดก่อนเปลี่ยน cadence.
- HBI ดูรูปแบบ click-only/on-demand; PNO full detail ควรใช้ shared cache/in-flight. PNO Option B เน้น A→B เปิด B ทันที, stale A ห้าม overwrite B, in-flight <=2 ตาม owner-approved behavior (แยกจาก passive observer ที่ concurrency 1).

## 6. Module ภาคปฏิบัติการเพิ่มเติม

- **Proof:** route/print/edit/history/profile และ API handler หลายเวอร์ชัน; ห้ามถือว่า state ของ Proof เท่ากับ Trip Occurrence ของ BusTime โดยไม่มี crosswalk.
- **PNO:** scan truth/segment, filters, backing bag, QR header/PNO/bag และ Excel export มี patch chain หลายรุ่นและ async ownership/cancellation; ต้องตรวจ GUI จริง, Excel 365 Place-in-Cell และ field scanner แยกจาก static/source tests.
- **Reports/history:** `ms-report.js` มี filter, completed daily, export; history pointer เป็น Turso read-only/asOf; API ที่เป็น fallback อาจมี guard และขอบเขตต่างกัน ต้องไม่สรุป runtime จากหน้าเดียว.
- **Admin/Supervisor:** account/HUB settings/standards/permissions และ source/incident/quota presentation. Supervisor Bot V1 สังเกตและวินิจฉัยเท่านั้น ไม่ auto-repair.
- **Browser Connector/HBI:** แยก service binding / KV / Browser session และ HBI manifest. การเปิด WebSocket ใหม่หรือ diagnostic อาจกระตุ้น refresh; จึง **ไม่ถือว่า passive zero-call** หากยังไม่มี evidence แสดงเส้นทางอย่างชัดเจน.

## 7. Final Staged Runtime และ Release Process

`worker/src/index.js` + `ms.js` (canonical) → `stage-dev-runtime.mjs` (ordered patches) → Origin Manifest session composition → `.dev-runtime/src/turso-index.js` และ `.dev-assets/` → exact hashing ผ่าน `build-exact-dev-runtime.mjs` → Owner-approved `workflow_dispatch` พร้อม Node 22, source+identity pin และ DEV-only deploy gate.

`worker/wrangler.dev.jsonc`: Workers static assets `ASSETS`, `DB_BACKEND=turso`, Durable Object `MS_REFRESH_COORDINATOR`, Cron 1m, ไม่มี D1 config. Cloudflare live binding read-only ที่ดูครั้งนี้ไม่พบ D1.

**ห้าม** แก้ identity manifest ให้ Candidate ผ่าน, ละเลย staged assets/worker hash, เพิ่ม polling, commit/push, dispatch, deploy หรือแตะ Production โดยไม่มีสิทธิ์เฉพาะงาน.

## 8. WTR-011 ถึง WTR-011E — ผลที่ยืนยันได้

| Gate/หลักฐาน | สถานะ |
|---|---|
| WTR-011E ZIP | SHA-256 `5f244a02aa86103e81ee9cc95e7fe032d4e1e510ec5d509b09e0f9dbe1360f0f`, integrity PASS, Manifest 30/30 PASS |
| WTR-011E functional parity | 17/17 synthetic Final Staged tests PASS (parent 15/17); **ตาม Work log**, ไม่ใช่ rerun ของผม |
| Retained WTR-011 | 18/18 PASS ตาม Work log |
| Repository focused | 38/40 PASS ตาม Work log; 2 failures baseline เดิมเกี่ยวกับ Origin test expectations |
| Exact Trip / Prior TBR-only Admission | 6/8 PASS; **2 negative Gate B still FAIL** |
| Optional patch E | แก้ staging helper หนึ่งไฟล์ `.github/dev-tools/patch-ms-route-cancellation-compat.mjs`: arrived Drop overdue filter ใช้ `departureCountdown(row, now)` แทนเทียบ ETD ดิบ; TBR-arrived Drop ใช้ flag เช่นเดียวกัน |
| Worker byte identity B→E | Work log ยืนยัน staged Worker 27 โมดูล byte-identical; composed frontend asset ต่างตาม patch |
| Identity pins | STOP expected บน changed source/asset; I03 NOT FIXED; Builder ROOT CAUSE UNKNOWN |
| Node 22 | NOT VERIFIED สำหรับ Local Candidate; Work ใช้ Node 24.22.3 |
| Real Drop live 39/70 นาที, TBR 12:37 | NOT LIVE VERIFIED; HAR ที่ได้รับไม่จับคู่ BusTime กับ Drop ที่ต้องการ |
| Native mobile/Excel 365/scanner | ไม่ได้รับการยืนยัน end-to-end ในงานนี้ |

**Functional A และ Identity B เป็นคนละ Gate**: A พิสูจน์ว่าการคำนวณ/จอใช้ accepted truth ตรงกันบน synthetic harness, ไม่ได้พิสูจน์ว่าต้นทางจับรถถูกเที่ยว. B จึงยังต้อง HOLD ก่อน release.

## 9. Blockers / สิ่งที่ยังไม่รู้ ไม่ควรเดา

1. **Gate B1 — Exact occurrence:** ต้องได้ shared occurrence ID, provider-verified crosswalk หรือ evidence ที่พิสูจน์ว่า BusTime กับ Route เป็นเที่ยวเดียวกันแม้ proof+attendance ซ้ำ; HAR capture ที่มีไม่ได้ยืนยัน.
2. **Gate B2 — TBR-only prior admission:** ต้องมี accepted record/receipt ที่บอก observation + occurrence + accepted time และกู้คืนหลัง reset. Present live projection ไม่ใช่ receipt.
3. **Actual DEV production-equivalent E:** Optional patch ยังอยู่ใน ZIP/local, ไม่ได้อยู่บน live DEV 650. Pin STOP, Node22 not run, full regression/GUI not verified.
4. **I03 security and builder:** I03 NOT FIXED; hash-builder root cause unknown; ห้ามมองว่าปิดแล้วจาก 17/17 หรือ 18/18.
5. **Docs drift:** Remote Project Brain มีจริงแล้ว แต่ `HANDOFF_CURRENT_TH.md`, `TASK_LEDGER.md`, `WTR-011_STATUS.md` ยังบอกว่าดocs branch blocked/WTR-011 not started; ต้องทำเอกสาร Sync เฉพาะเมื่อ Owner อนุมัติ ไม่ใช่แก้ Source/Deploy โดยพลการ.
6. **Scope of code review:** ตรวจเส้นทางสำคัญใน repo 496 blob files, contracts, staging, config, focused tests และ artifacts/HAR; ไม่ได้อ่านทุกบรรทัดของทุกไฟล์, clone repo ทั้งหมดมา run complete CI, เปิด UI native หรือ query Turso/live Provider. จึงไม่อ้างว่า 'Full System Verified'.

## 10. ข้อกำหนดที่ควรถือสำหรับงานต่อไป

- ตรึง exact GitHub refs และ Worker UUID ใหม่อีกครั้งเมื่อเปิดงานใหม่.
- แยก **A: Destination/Drop Functional Parity** ออกจาก **B: Exact Trip/Admission Identity** และจาก **Release/Node22/Security Gates** อย่างถาวร.
- ถ้าปรับ Drop UI ต้องตรวจ Countdown, overtime filter, ETA/ETD, state1/state2, actualDeparture, Desktop/Mobile และ history from same accepted snapshot; ห้ามแก้แค่ badge.
- ถ้าจะปิด Gate B ต้องเริ่มด้วย Evidence Contract; ห้ามสร้าง Trip ID, ห้ามนิยาม proof/plate/route/day เป็น exact occurrence โดยไม่มีหลักฐาน.
- ห้ามเผยแพร่ HAR ดิบ, token, cookies, session IDs, รูปหรือข้อมูลรถ/บุคคลใน repo หรือ artifact สาธารณะ. งาน Live/Provider/DB ต้องมีสิทธิ์ใหม่แยกจากการอ่าน Source.
- ยังไม่เข้าสู่ WTR-011R; **Production RELEASE HOLD**. ความเห็นนี้เป็นผลการศึกษา ไม่ใช่คำสั่งให้ implementation หรือ Deploy.

## 11. แหล่งอ้างอิงหลัก

- [GitHub DEV source](https://github.com/Flashdevnak/waiting-trucks-report/tree/e6fe36b01b34866f6f90294df572f0dd015913d5)
- [Project Brain docs](https://github.com/Flashdevnak/waiting-trucks-report/tree/docs/wtr-main-brain-v1)
- [Operational Contract](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/docs/MS_OPERATIONAL_CONTRACT_V1.md)
- [Canonical Worker](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/index.js)
- [Frontend](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/ms.js)
- [DEV exact builder](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/build-exact-dev-runtime.mjs)
- [Ordered staging](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/stage-dev-runtime.mjs)
- [DEV workflow](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/workflows/deploy-worker-dev.yml)
- [TBR shadow + first-source queue](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/patch-ms-tbr-shadow-feed.mjs)
- [BusTime hot lane](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/bus-time-hot-lane-v14-runtime.mjs)
- [Route cancellation and KIT/TBR contract staging](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/patch-ms-route-cancellation-compat.mjs)
- [History pointer](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/ms-history-pointer-v1.js)
- [PNO passive](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/pno-passive-coverage.js)
- [Turso adapter](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/turso-d1.js)
- User-provided local HAR files and SHA-verifiable WTR-011 to 011E ZIPs; raw HAR is deliberately **not included** in this report.
