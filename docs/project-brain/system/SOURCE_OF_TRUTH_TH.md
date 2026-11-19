# WTR — Source of Truth และ Data Contract

**กฎหลัก:** KIT/TBR ของเวลารถเข้ามาจาก **Route + BusTime** สองแหล่งหลัก; แหล่งอื่นมีหน้าที่ประกอบ ไม่ถือว่าเป็นผู้รับรองรถถึงจริง.

| แหล่ง | ข้อมูลที่เชื่อถือได้ภายในขอบเขต | ไม่ใช่หลักฐานสำหรับ |
|---|---|---|
| **Route** `/gw/nws/staff/ms/store/line/task` | KIT = Route `actualArrivalAt`; `unloadingState` 1/2; `actualDepartureAt`; ETA/ETD; Route row fields | TBR ของ BusTime หรือการยืนยัน TBR ผิดเที่ยว |
| **BusTime** `/api/fleet_time/getList` | TBR = `scheduleTbrArrivalAt`; schedule KIT metadata; Schedule S/E, counts | Route `actualArrivalAt`, Route state2, exact occurrence โดย proof อย่างเดียว |
| **PreEntry** | จำนวนพัสดุ/แผน/ความครบของข้อมูลตาม contract | ยืนยัน KIT/TBR หรือ Route lifecycle |
| **HBI** | รูปรถเฉพาะการเรียก on-demand | เวลาเข้าหรือออกจริง |
| **PNO** | scan/parcel/bag evidence, state ที่ตรวจพบ | ตัดสิน TBR/KIT โดยไม่อาศัย Route/BusTime |
| **Origin Manifest** | ข้อมูลประกอบฝั่งต้นทางตามสิทธิ์/หลักฐานของตน | เป็น KIT/TBR ของ Destination/Drop |
| **TBR Intelligence/Shadow** | Diagnostic/advisory/read-only | Queue, freshness, history, lifecycle authority (ทุกอย่าง false) |

## การจับคู่และจุดสูญเสียหลักฐาน

- Route HAR ที่ได้รับมี `data.items[]`: หน้าแรก 100/233 แถว มี `id`, `line_id`, `fleet_id`, optional `route_id`, `proof_id`, attendance text; ชนิด/ความคงทนของ ID และ shared crosswalk ยังไม่พิสูจน์.
- BusTime HAR capture 22 แถว / 11 proofs / 25 top-level field groups; ไม่มี `id`, `route_id`, `trip_id`, `occurrence_id` ที่ root ใน capture นี้. **ไม่ได้แปลว่า Provider ทุก response ไม่มี**.
- `busHarSeedItems()` และ `sanitizeBusSeedItems()` คัดเหลือ 8 groups และ nested `{value:string}`; บาง metadata อาจถูกทิ้ง.
- Shared BusTime merge ใช้ proof+attendance ภายใน HUB; exact occurrence ไม่ได้รับการยืนยันจาก key นี้เอง. การเลือก earliest time ภายใต้ key ที่ merge ผิด ทำให้สูตรที่ถูกต้องยังได้ผลผิด.
- `syncMs` เมื่อมี proof สร้าง persisted ID จาก HUB+normalized proof+attendance+estimated arrival/departure; ETA เปลี่ยนจึงอาจกระทบ ID. Route `row.id` ไม่ได้แปลว่า shared BusTime identifier.
- HAR ทั้งสองไฟล์ที่ตรวจ **ไม่ใช่คู่รถ Drop จริง** ที่อ้างอาการ 39/70 นาที หรือ TBR 12:37. ห้ามใช้เป็น Live Acceptance.

## Gate B ที่ยังค้าง

**B1: Exact Trip Identity** — ต้องพิสูจน์ same-trip ด้วย provider-backed ID/crosswalk หรือหลักฐานที่จำแนก proof ซ้ำต่าง occurrence ได้โดยไม่ใช้วัน/ทะเบียน/ชื่อเส้นทางเป็นตัวแทนแบบเดา.

**B2: Prior TBR-only Admission** — ต้องมีบันทึกการตัดสินใจรับเข้าคิวจากรอบสำเร็จพร้อม occurrence+observation+acceptedAt ที่อ่านคืนหลัง reset; `ms_live_cache` ของ Route และ `MsRefreshCoordinator.lastResult` ในหน่วยความจำไม่พิสูจน์สิ่งนี้.

**สถานะ:** ทั้งสอง Gate **NOT PROVEN** ณ WTR-011E. ห้ามเปลี่ยน Contract หรือถือว่า synthetic pass แก้ Gate B ได้แล้ว.

**Privacy:** ที่เก็บ GitHub สำหรับเอกสารต้องมีแต่ schema, field names, types, counts, sanitized matrix, SHA; ไม่มี HAR ดิบ, headers, cookies, tokens, real license plates หรือ personally identifying records.
