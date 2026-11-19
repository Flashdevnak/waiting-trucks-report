# Evidence Index

เก็บ hash และ descriptor ที่สาธารณะได้ใน GitHub เก็บ artifact ที่อาจมีข้อมูลธุรกิจหรือข้อมูลส่วนบุคคลในที่เก็บจำกัดสิทธิ์ ใช้ SHA-256 ของ ZIP bytes และ per-file manifest ตรวจทั้ง package และสมาชิกก่อนใช้

| หลักฐาน | SHA-256 / manifest | ที่เก็บและการเข้าถึง | สถานะและความเสี่ยง |
| --- | --- | --- | --- |
| WTR-BRAIN-001 Work Order | SHA-256 `66bc5a4153451ec30e681a400e02d52c8c1453174348b96588b65cf573423cff`; คำสั่งต้นฉบับผูกกับคำอนุมัติ Owner | ไฟล์แนบ `WTR_BRAIN_001_WORK_ORDER_TH(1).md` ใน Work ต้นทาง | อ่านในการ bootstrap; ผู้รับช่วงขอฉบับจาก Owner ถ้าเข้า session เดิมไม่ได้ |
| `WTR_BRAIN_001_PROJECT_BRAIN_RECOVERY.zip` | อ่าน ZIP SHA-256 จากผลส่งมอบ ตรวจไฟล์ที่ส่งด้วย `SHA256SUMS.txt` และ ref จาก receipt ในชุด | ส่งมอบแก่ Owner พร้อมงานนี้ | ใช้เป็น fallback หากเอกสารบน GitHub ยังใช้ไม่ได้ เก็บสำเนาที่ผู้รับงานเข้าถึงได้ |
| WTR-011 candidate ZIP `WTR_011_KIT_TBR_EARLIEST_ARRIVAL_FIX.zip` / `WTR_011_KIT_TBR_EARLIEST_ARRIVAL_FIX(1).zip` | UNKNOWN; manifest ยังไม่ตรวจรับ ทั้งสองชื่อยังไม่มีการยืนยันว่า bytes เหมือนกัน | อ้างชื่อไฟล์จากบริบทงานเดิม การเข้าถึงต้องให้ Owner ยืนยัน | `NOT ACCEPTED`; ชื่อไฟล์อย่างเดียวใช้เป็น identity ไม่ได้ |
| `WTR_011_MAIN_BRAIN_NODE22_REVIEW.zip` | UNKNOWN; manifest และผล Node 22 ยังไม่ตรวจรับ | อ้างชื่อไฟล์จากบริบทงานเดิม การเข้าถึงต้องให้ Owner ยืนยัน | `NOT ACCEPTED`; อย่านำรายงานเก่ามาใช้เป็นผลรันของ WTR-011 |
| DEV009C source identity และ run #778 | Manifest SHA-256 และ reference IDs ใน [Release Ledger](RELEASE_LEDGER.md) | GitHub SHA-pinned manifest และ run/job | Git source และ run metadata ตรวจแล้ว Logs/artifacts มี retention ตาม repository ต้องเก็บ sanitized evidence ถ้าใช้ซ้ำระยะยาว |
| WTR-011R qualification | ยังไม่มี evidence | รอ accepted candidate | `NOT STARTED` |

รายการใหม่ควรมี task, evidence type, capture UTC, source/candidate SHA, artifact filename, SHA-256, manifest path, retrieval owner/ACL, retention/expiry, verdict และผู้ตรวจ ผู้ไม่มีสิทธิ์ให้บันทึก `UNAVAILABLE` พร้อมแหล่งเดิมที่ตรวจสอบได้
