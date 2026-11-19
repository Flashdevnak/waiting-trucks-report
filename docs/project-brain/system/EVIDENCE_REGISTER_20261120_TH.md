# Evidence Index — WTR

**As-of:** 20 พฤศจิกายน 2026. เก็บ SHA-256 และอ้างอิงแบบไม่เปิดเผยข้อมูลจริง. ชื่อไฟล์/ZIP อย่างเดียวไม่ใช่หลักฐานการรับรอง bytes; ให้ตรวจ SHA-256 และสมาชิก manifest ตามจริงก่อนใช้. เอกสารที่ไม่ได้เปิด/รันซ้ำต้องระบุว่าอ้าง Work logs.

| หลักฐาน | SHA-256 / บริบท | Location / Restriction | Outcome |
| --- | --- | --- | --- |
| Published Project Brain (WTR-BRAIN-001R) | Initial 13 Markdown, branch commit `f90b3bb2d2a5496c47ebd8775c1f1cdbc4fafa6a` | [GitHub docs branch](https://github.com/Flashdevnak/waiting-trucks-report/tree/docs/wtr-main-brain-v1) | PUBLISHED; docs-only update package แยก |
| DEV Source / Run #778 | SHA `e6fe36b01b34866f6f90294df572f0dd015913d5` | [GitHub CI run](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44407280473) | Baseline deploy success; ไม่ใช่ E acceptance |
| WTR-011 original | SHA `d06d7a2db23481984fe25ff0255a71e6a43e7f4a463c28863bc988e8f933156b` | Owner Work/Library ZIP, restricted | Local blocked initial targeted 17/18 |
| WTR-011B cumulative patch | SHA `588bfb89a2f4179961210eb437e822b7a7873f8d621fcc3b2092eeb9b7efc81c`, manifest 29/29 | Owner Work/Library ZIP, restricted | Retained 18/18, occurrence 6/8 |
| WTR-011C evidence | SHA `9f482a4059b8e57c1d360aeac9da27e42e425f231d14f4abce8885cd5ca82903`, manifest 11/11 | Owner Work/Library ZIP, restricted | Evidence missing |
| WTR-011D passive decision | SHA `4cf65374a7cf73aa58fd553d31f7d036a083a3ee4968197a9b0a1e9cca298d7e`, manifest 8/8 | Owner Work/Library ZIP, restricted | Passive not attempted, calls 0 |
| Raw Route + BusTime HAR | SHA intentionally **not published**; owner-provided original HAR (20 Nov capture) | Private local/owner custody only; **NEVER upload raw HAR to public repo** | Route page 1 100/233, BusTime 22/22; no actual Drop match |
| WTR-011E HAR-grounded parity | SHA `5f244a02aa86103e81ee9cc95e7fe032d4e1e510ec5d509b09e0f9dbe1360f0f`, manifest **30/30** | Owner Work/Library ZIP, restricted | Gate A synthetic 17/17; Gate B NOT PROVEN; optional staging helper patch |
| System Deep Study | SHA `819496522d10643e543968326971eabeda5326e5767e36a22ef8ae38a43bd473` | Sanitized copy in `references/SYSTEM_DEEP_STUDY_READONLY_20261120_TH.md` | Architecture study, not full runtime certified |
| WTR-011R qualification | No evidence | Not started | HOLD |

When capturing new evidence, record task, UTC capture time, source/candidate SHA, file name, ZIP SHA, manifest, retrieval owner/ACL, retention, verifier, runtime/Node/fixture and verdict. Unknown is not assumed PASS. **Production RELEASE HOLD.**
