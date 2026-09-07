# ทดลองเชื่อมต่อ MS ผ่าน Cloudflare Browser Run

โค้ดชุดนี้อยู่ในโฟลเดอร์ `cloudflare-browser-test` บน branch `main` และไม่แตะ Production หรือ HAR เดิม

## TBR Intelligence V1

`/shadow-tbr?hub=NE1` ถูกยกระดับจากหน้า Shadow test เป็น TBR Intelligence dashboard โดยยังคงหลัก read-only เดิม:

- Actual Arrival authority ยังเป็น Route เท่านั้น
- TBR ไม่มีสิทธิ์เปลี่ยน Queue
- ไม่เพิ่ม MS polling
- ไม่เขียน Turso สำหรับ TBR Intelligence
- rolling intelligence 14 วันเก็บใน Browser KV
- raw Shadow record ยังถูกล้างตาม retention เดิม
- Intelligence checkpoint ทุก 30 นาที จึงมี periodic KV write สูงสุด 48 ครั้ง/HUB/วัน นอกเหนือจากเหตุการณ์ source/repair ที่เกิดจริง
- Connector auto-repair ถูก throttle สูงสุดทุก 5 นาที
- Route 502/503/504 ยัง retry 1 ครั้ง และใช้ last-good Route snapshot ได้ชั่วคราวตาม policy เดิม
- Intelligence state ที่เสียรูปจะ reset ตัวเองเป็น state ใหม่อย่างปลอดภัย

หน้า Intelligence แสดง confirmation/expired rate, P50/P90/P95 lead time, source health, fallback rate, readiness score และ self-healing status แต่จะไม่ยกระดับ TBR เป็น queue authority อัตโนมัติ

API เพิ่มเติมแบบ read-only:

- `/api/shadow-tbr?hub=NE1` — Shadow raw summary เดิม
- `/api/tbr-intelligence?hub=NE1` — rolling Intelligence/readiness/self-healing summary

## นำขึ้นระบบทดสอบ

1. Cloudflare Dashboard > Workers & Pages > Create application
2. เลือก Import a repository
3. เลือก GitHub repository `Flashdevnak/waiting-trucks-report`
4. Project name: `waiting-trucks-ms-browser-test`
5. Root directory: `/cloudflare-browser-test`
6. Deploy command: `npx wrangler deploy`
7. กด Save and Deploy
8. เปิด Worker > Settings > Variables & Secrets
9. เพิ่ม Secret ชื่อ `TEST_PIN` และกำหนดรหัสสำหรับหน้าทดสอบ
10. เปิด URL workers.dev ที่ Cloudflare สร้างให้

## เกณฑ์ผ่าน

- กดเริ่มแล้วเห็นหน้า MS/QR ในภาพ
- สแกน QR แล้วกด “ตรวจหลังสแกน”
- ระบบแสดง “Session ใช้ดึง API ได้จริง”
- แสดงจำนวนข้อมูลจาก MS โดยไม่เปิดเผย Session ID หรือ Device ID
- TBR Intelligence ต้องผ่าน regression, Turso write = 0 และ Queue authority = 0
- Production และฐานข้อมูลจริงยังไม่ถูกเปลี่ยน

## ความปลอดภัย

- Worker บังคับใช้ TEST_PIN สำหรับ flow เชื่อมต่อ Browser
- Session และ Device ID ไม่ถูกส่งกลับไปยังหน้าเว็บ
- ปุ่มหยุดทดสอบปิด Cloud Browser
- Browser จะปิดเองเมื่อไม่มีการใช้งานตามข้อจำกัด Cloudflare
- หน้า TBR Intelligence ใช้ Shadow ID ที่ hash แล้ว ไม่เปิด barcode จริง
