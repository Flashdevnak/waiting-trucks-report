# WTR — Runtime, Cloudflare, Turso, Tests และ Release Gates

## ห้ามสับสน Source กับ Runtime

```text
Pinned DEV Git SHA
  canonical ms.js + worker/src/index.js
        |
        v
.github/dev-tools/stage-dev-runtime.mjs  (ordered patch chain)
        |
        v
Origin Manifest composition + DEV assets
        |
        v
worker/.dev-runtime/src/turso-index.js + .dev-assets/ms.js
        |
        v
.github/dev-tools/build-exact-dev-runtime.mjs hash/report
        |
        v
Node 22 test + pinned identity + security checks
        |
        v
Owner-approved workflow_dispatch (DEV only; NOT approved for 011E)
```

`worker/wrangler.dev.jsonc`: `waiting-trucks-report-api-dev`, `DB_BACKEND=turso`, `MS_REFRESH_COORDINATOR` DO, 1-minute Cron, Assets. `worker/src/turso-d1.js` ช่วยให้ Turso รองรับ interface คล้าย D1 แต่ DEV active D1 binding ต้องเป็น **0**. ห้ามใช้ README แบบเก่าที่พูด D1 เป็นหลักฐานแย้ง config/live bindings.

## การคุมโควตา

Durable Object ทำ per-HUB coordination; WebSocket/leader/follower และ shared cached requests คุม client amplification; BusTime hot lane ใช้ shared source, cooldown/rate guard; PNO passive มีขอบเขตจำกัด; HBI เป็น on-demand. ไม่อนุญาตเพิ่ม polling เฉพาะ HUB หรือสร้าง provider refresh ใหม่ในงานเอกสาร.

## หลักฐาน Release แยก 4 ชั้น

1. **Source identity:** exact branch SHA, diff, staged assets, worker tree, immutable manifest hash.
2. **Code/targeted tests:** Node version, command/fixtures/logs, failures ใหม่เทียบ baseline; Final Staged tests ไม่ใช่ canonical-only.
3. **Security/operational:** I03 symlink/path traversal NOT FIXED, Builder ROOT CAUSE UNKNOWN; identity pin STOP สำหรับ candidate changed bytes; quota/freshness/PNO/Excel/GUI gates แยกกัน.
4. **Deployed/live:** Cloudflare UUID/traffic/asset cache/smoke/actual provider evidence. ไม่อ้างจาก local test ว่า live ผ่าน.

## Reference ที่ตรวจ 20 พฤศจิกายน 2026

- DEV source SHA `e6fe36b01b34866f6f90294df572f0dd015913d5`; docs branch pre-sync `f90b3bb2d2a5496c47ebd8775c1f1cdbc4fafa6a`; main `39df260b214526c398e92e12444b5e144510812b`.
- DEV Worker UUID `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637`, Version 650, traffic 100% จาก read-only API; deployment `dabd7c50-61f0-4b51-ae23-93484304f474` (เกิด 2026-11-18 22:01:38Z).
- WTR-011E local optional frontend-helper patch **ยังไม่อยู่บน DEV 650**; Gate A 17/17 ตาม Work log, Gate B 6/8, repo focused 38/40 baseline failures, Node 24 used, Node22 NOT VERIFIED.

## Safety

**Docs-only change** ไม่ใช่ source/app deploy. แยก Git branch `docs/wtr-main-brain-v1` ออกจาก DEV/main. ห้าม commit/push/dispatch/deploy/เปลี่ยน Cloudflare config หรือ Turso โดยไม่มี Owner approval ราย action. No raw HAR or secrets in git. WTR-011R HOLD; Production RELEASE HOLD.
