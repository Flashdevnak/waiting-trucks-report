# Waiting Trucks Report

ระบบติดตามรถและพัสดุเข้า HUB โดยมี GitHub repository นี้เป็น source of truth ของ Frontend และ Backend

## Architecture

```text
GitHub Pages (Frontend)
        |
        v
Cloudflare Worker /api
        |
        v
Cloudflare D1 (binding: DB)
        |
        v
MS integration
```

Frontend production: <https://flashdevnak.github.io/waiting-trucks-report/>

API เดิมที่ยังเป็น fallback ระหว่าง migration:
`https://waiting-trucks-report.alert-squid-6738.chatgpt.site/api`

> ยังห้าม cutover Frontend จนกว่า Worker shadow จะผ่าน API parity, data integrity,
> authentication, export, mobile และ multi-device gates ครบทั้งหมด

## Source layout

- Frontend: ไฟล์ `.html`, `.js`, `style.css`, `sw.js` และ `version.json` ที่ root
- Backend: `worker/src/index.js`
- D1 schema reference: `worker/db/schema.ts`
- D1 migrations: `worker/migrations/`
- API parity test: `worker/tests/parity.mjs`
- Production preflight SQL: `worker/scripts/production-preflight.sql`

Backend ใน `worker/src/index.js` ถูกนำมาจาก deployment เดิมโดยตรงเพื่อรักษา API
contract และ business logic เดิม ไม่ได้ rewrite ระหว่าง migration

## Cloudflare configuration

1. คัดลอก `worker/wrangler.example.jsonc` เป็น `worker/wrangler.jsonc`
2. ใส่เฉพาะชื่อและ ID ของ Production D1 เดิมที่ตรวจสอบยืนยันแล้ว
3. ตั้ง secrets ด้วย `wrangler secret put` ห้ามเขียนค่า secret ลงไฟล์หรือ GitHub
4. ตรวจ binding ต้องชื่อ `DB`

Environment variables/secrets ที่ backend ใช้:

- `AUTH_SECRET`
- `PASSWORD_PEPPER`
- `INITIAL_ADMIN_PASSWORD` (ใช้ bootstrap เท่านั้น)
- `MS_BRANCH`
- `MS_SESSION_ID`
- `MS_DEVICE_ID`

ห้าม deploy ด้วย database ID ที่เดา ห้ามสร้าง Production D1 ใหม่แทนของเดิม

## Development

```bash
cd worker
npm install
npm run check
npm run dev
```

## Migration rules

- Production schema ทุกครั้งต้องมี migration file ใน `worker/migrations/`
- ใช้ additive-first: `ADD COLUMN`, `CREATE INDEX`, `CREATE TABLE` เมื่อจำเป็นและตรวจแล้ว
- ห้าม `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, reset หรือ import ทับ Production
- ก่อน apply migration ต้องเก็บ schema, row counts และ latest timestamps
- หลัง apply ต้องตรวจ schema/row counts ซ้ำและ smoke test API
- migration ชุด `0000`–`0005` เป็น baseline จาก backend deployment เดิม ห้าม apply
  ซ้ำกับ Production โดยไม่ตรวจ migration status และ schema จริงก่อน

ตัวอย่างตรวจแบบ read-only:

```bash
wrangler d1 execute DB --remote --config worker/wrangler.jsonc \
  --file worker/scripts/production-preflight.sql
```

## Shadow and parity test

Frontend ต้องยังเรียก OLD API ระหว่างทดสอบ Worker ใหม่

```bash
cd worker
OLD_API_URL=https://waiting-trucks-report.alert-squid-6738.chatgpt.site/api \
NEW_API_URL=https://<verified-worker-url>/api \
API_TOKEN=<temporary-test-session-token> \
TEST_HUB=NE1 TEST_DAY=2026-08-31 npm run parity
```

ชุด parity นี้เป็น read-only และเปรียบเทียบ HTTP status, `ok`, field/type shape และ
array row counts สำหรับ endpoint หลัก ต้องทดสอบ login/admin/write flows เพิ่มใน smoke
test ที่แยกจาก Production data mutation

## Cutover

Cutover ทำได้เมื่อ binding/database ID/schema/row counts ถูกต้อง และทุก gate ผ่านเท่านั้น:

1. เก็บ OLD API URL และ commit ก่อน cutover
2. เปลี่ยน API URL ใน Frontend เป็น Worker URL จริง
3. bump `version.json` และ `sw.js`
4. deploy GitHub Pages
5. ทดสอบจริง T+1, T+5 และ T+15 นาที
6. คง OLD API ไว้เป็น fallback จนยืนยันว่าไม่มี regression

## Rollback

ถ้า Worker มี regression ให้เปลี่ยน Frontend API config กลับ OLD API แล้ว bump cache
version และ deploy GitHub Pages ใหม่ ห้าม rollback D1 แบบ destructive และไม่ต้องย้อน
migration แบบ additive ที่ไม่สร้าง regression

## Current forensic finding

ข้อผิดพลาด `D1_ERROR: no such column: updated_by` เกิดจาก query ของ `msArchive`
อ่าน `updated_by` จาก `ms_route_history` ทั้งที่ schema จริงใช้ `synced_by` ไม่ใช่จาก
ข้อมูลสูญหายหรือ migration ที่ต้องเพิ่ม column การแก้ไข Production เดิมจึงแก้เฉพาะชื่อ
column ใน query และไม่เปลี่ยน D1 schema/data
