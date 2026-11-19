# WTR ทำอะไร และใช้ระบบใดบ้าง

**ฐานการศึกษา:** DEV SHA `e6fe36b01b34866f6f90294df572f0dd015913d5`; ขอบเขตเป็น architectural/source study ไม่ใช่ end-to-end certification.

## วัตถุประสงค์

Waiting Trucks Report เป็นระบบติดตามรถเข้า/ออก HUB, คิวรอลงงาน, จุดดรอป/รอปล่อยรถ, สถานะการลงงาน, ปริมาณพัสดุ, หลักฐานการปฏิบัติงาน, ประวัติและรายงาน. มีหน้าสำหรับผู้ปฏิบัติ, ผู้ดูแล, Proof, Supervisor รวมถึงการแสดง PNO/ถุง/QR และการส่งออก Excel ใน DEV candidate.

## แผนที่ส่วนประกอบ

```text
UI: ms.html/ms.js, ms-report.*, proof.*, admin.*, supervisor.*, scan/warehouse
        |
        v
DEV Cloudflare Worker /api (auth, permissions, Route/BusTime/PreEntry,
                         snapshot, history, PNO/Proof, assets)
        |                                  |
        v                                  v
MsRefreshCoordinator Durable Object       Turso DB (DEV only)
shared per-HUB work, WebSocket,            Route snapshots, registry,
in-flight/cache/health                      history, accepted cache
        |
        +---- Route (KIT, lifecycle, departure)
        +---- BusTime (TBR, schedule S/E)
        +---- PreEntry (parcel counts)
        +---- HBI (truck photo, on demand)
        +---- PNO (parcel/bag/scan evidence, bounded/on-demand)

Browser Connector Worker (separate Cloudflare Worker):
Browser Session + KV + Service Binding -> DEV Worker
TBR Shadow/Intelligence: read-only diagnostic; never queue authority
```

## ไฟล์จุดเริ่มที่ต้องตรวจ

| ส่วน | Canonical path | ข้อควรระวัง |
|---|---|---|
| คิวและ Desktop/Mobile | [`ms.html`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/ms.html), [`ms.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/ms.js) | Canonical ใช้ staging patch chain, ต้องดู composed asset |
| รายงาน/Export | [`ms-report.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/ms-report.js) | แยก completed-day กับ current queue |
| Proof | [`proof.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/proof.js), [`worker/src/proof-control.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/proof-control.js) | Proof ID ไม่รับรอง trip occurrence โดยลำพัง |
| Admin/Supervisor | [`admin.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/admin.js), [`supervisor.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/supervisor.js) | Supervisor read-only, ไม่ทำ auto repair |
| DEV API | [`worker/src/index.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/index.js) | Canonical ไม่ใช่ Final Runtime |
| DEV entrypoint | [`worker/src/turso-index.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/turso-index.js) | รันจาก staged `.dev-runtime/src/turso-index.js` |
| Turso adapter | [`worker/src/turso-d1.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/turso-d1.js) | D1-style API adapter ไม่ใช่ Cloudflare D1 binding |
| Source freshness | [`worker/src/ms-operational-truth-v1.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/ms-operational-truth-v1.js) | 20-minute threshold พร้อม provenance |
| Realtime/Coordinator | [`patch-ms-durable-coordinator.mjs`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/.github/dev-tools/patch-ms-durable-coordinator.mjs) | shared per HUB, cron 1m |
| Browser Connector | [`cloudflare-browser-test/src/index.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/cloudflare-browser-test/src/index.js) | Separate Worker, KV, Browser binding |
| PNO | [`worker/src/pno-passive-coverage.js`](https://github.com/Flashdevnak/waiting-trucks-report/blob/e6fe36b01b34866f6f90294df572f0dd015913d5/worker/src/pno-passive-coverage.js) | passive 120s bounded, full detail on demand |

## ขอบเขตสภาพแวดล้อม

DEV: `waiting-trucks-report-api-dev`, `DB_BACKEND=turso`, `MS_REFRESH_COORDINATOR`, Cron 1 นาที, assets binding. Cloudflare settings ที่อ่าน 20 พ.ย. 2026 พบ Turso credentials/binding โดยไม่เปิดเผยค่าและไม่พบ D1 binding; ต้องตรวจใหม่ทุก release. `main`/Production อยู่คนละขอบเขต ไม่ merge/deploy เอง.

**README ที่ root มีแผนภาพ D1 รุ่นก่อน:** ห้ามนำมาเป็นหลักฐานว่า DEV ปัจจุบันใช้ Cloudflare D1.
