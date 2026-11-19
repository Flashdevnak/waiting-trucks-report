# WTR — กฎเวลาเข้า, คิว, การลงงาน, Drop และประวัติ

**Normative:** [MS Operational Contract](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/docs/MS_OPERATIONAL_CONTRACT_V1.md), Owner-approved changes และ Final Staged Source ณ exact SHA. เอกสารนี้เป็นคำอธิบายเพื่อทำความเข้าใจ ไม่ได้อนุมัติเปลี่ยนกฎ.

| ขั้นตอน | Destination / รถรอลงงาน | Drop / รถจุดดรอป |
|---|---|---|
| **เข้า** | เลือก KIT Route `actualArrivalAt` หรือ eligible TBR BusTime `scheduleTbrArrivalAt` ที่เร็วกว่า | ใช้ `queueAdmissionArrival` **เดียวกัน** |
| **เวลาตรงกัน** | KIT ชนะ | KIT ชนะ |
| **Schedule KIT / ETA** | เป็นแผน/metadata; ห้ามแทน actual | เหมือนกัน |
| **TBR-first** | มีสิทธิเข้าคิวเมื่อหลักฐานใช้ได้ แม้ KIT ยังไม่มา; ห้ามเขียน KIT เทียม | เหมือนกัน |
| **เริ่มลงงาน** | Schedule S → persisted effective start → first Route state 1 observation ตาม contract | เหมือนกัน |
| **ลงงานเสร็จ** | Route `unloadingState=2`, Schedule E แค่ timing/display | Route state 2 ปิด unloading แต่ยังรอปล่อย |
| **ออกจากคิว** | ลงงานเสร็จตาม Route state 2 | **Route `actualDepartureAt` เท่านั้น** ปล่อยรถ |
| **หมดอายุ** | อายุคิว `>=12h` นับจาก eligible KIT/TBR หรือ proven fallback | Waiting, unloading, awaiting release ครบ 12h เช่นกัน |
| **Business Day** | วันไทยของ accepted usedArrival | วันไทยของ accepted usedArrival |

รถ **Origin / ต้นทาง** อยู่ใน logic ฝั่งการปล่อยรถ/ออกคลังของตน ไม่รับ TBR เป็น inbound queue จากแบบข้างต้น.

## การคำนวณ และ UI/Report

- `queueAdmissionArrival`, `queueAdmissionSource` ให้เวลาเข้าที่คิวรับไว้; ป้ายถึงจริง/เร็ว/ช้า, wait time, SLA, Desktop/Mobile, metrics และ report ต้องใช้ความจริงชุดเดียวกัน.
- Drop: `adjustedDropDeparturePlan` ใช้แผน ETD หลังปรับตาม accepted KIT/TBR แล้ว `departureCountdown` ใช้แผนเดียวกัน. WTR-011E optional patch ทำให้ **ตัวกรองรอออกล่าช้า** ใช้ผล `departureCountdown()` ไม่ใช้ ETD ดิบ. ยังเป็น local candidate.
- `scheduleUnloadingCompletedAt` ไม่ใช่สัญญาณให้ปล่อย Drop. `actualDepartureAt` ไม่ควรถูกสมมติ.
- Cross-midnight ใช้ Bangkok date ของเวลาที่รับรองแล้ว เช่น TBR 23:58 / KIT 00:12 เมื่อพิสูจน์ว่าเป็น **เที่ยวเดียวกัน** จะเป็น business day ของวันก่อนตาม TBR; fixture นี้ไม่พิสูจน์ exact identity.
- Historical `asOf` เลือก snapshot/evidence ที่รู้หรือ accepted ภายใน cutoff; ห้ามนำข้อมูลที่รู้ทีหลังไปเปลี่ยนผลก่อนหน้า.

## Realtime/Quota/Freshness

- UI ประมาณ 4s, shared Route floor ~3s, healthy BusTime ~12s; Cron 1m.
- Same HUB 1/10/100 clients ต้องไม่ทำให้ upstream work เพิ่มตามจำนวน UI; ใช้ coordinator per HUB, in-flight dedupe, shared cache, cooldown.
- Freshness stale >20 นาที (20 นาทีพอดียัง FRESH), มีสถานะ FRESH/STALE/SOURCE_UNAVAILABLE/UNKNOWN/ON_DEMAND. Cached data ไม่ใช่หลักฐาน source healthy.
- TBR rate limit cooldown เริ่ม 5 นาที; ไม่เพิ่ม timer/poll/retry.
- HBI photo click-only; PNO on-demand และ passive DEV bounded 120s ตาม implementation. PNO Option B เปลี่ยน A→B แล้ว B ต้องทำงานทันที ไม่ให้ข้อมูล A ทับ B, in-flight <=2, shared quota/caches.

**ขอบเขตทดสอบ:** WTR-011E 17/17 เป็น synthetic targeted A; real Drop/Native mobile/Excel 365/scanner ยังต้องพิสูจน์แยก.
