# ทดลองเชื่อมต่อ MS ผ่าน Cloudflare Browser Run

โค้ดชุดนี้อยู่ในโฟลเดอร์ `cloudflare-browser-test` บน branch `main` และไม่แตะระบบจริงหรือ HAR เดิม

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
- ระบบจริงและฐานข้อมูลจริงยังไม่ถูกเปลี่ยน

## ความปลอดภัย

- Worker บังคับใช้ TEST_PIN
- Session และ Device ID ไม่ถูกส่งกลับไปยังหน้าเว็บ
- ปุ่มหยุดทดสอบปิด Cloud Browser
- Browser จะปิดเองเมื่อไม่มีการใช้งานตามข้อจำกัด Cloudflare
