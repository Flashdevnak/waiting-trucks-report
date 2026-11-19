# Release Ledger — WTR

**As-of:** 20 พฤศจิกายน 2026 (Asia/Bangkok). ทุกค่าที่กล่าวถึง Live คือ snapshot ณ เวลาตรวจ และต้องอ่านใหม่ก่อนปฏิบัติการใด ๆ. เอกสารนี้ไม่ใช่การอนุมัติ Release.

| รายการ | หลักฐาน / ค่า | ขอบเขต |
| --- | --- | --- |
| DEV branch | `codex/dev-recovery-contract-v2` @ `e6fe36b01b34866f6f90294df572f0dd015913d5` | GitHub HEAD ตรวจในรอบจัดทำเอกสาร |
| Main | `39df260b214526c398e92e12444b5e144510812b` | ไม่ merge / ไม่เปลี่ยน |
| Docs branch | `docs/wtr-main-brain-v1` @ `f90b3bb2d2a5496c47ebd8775c1f1cdbc4fafa6a` **ก่อน** Docs Sync | Branch เผยแพร่แล้วตั้งแต่ WTR-BRAIN-001R; docs-only package ใหม่ยังไม่ push |
| DEV Worker | `waiting-trucks-report-api-dev`, Version **650**, UUID `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637` | Read-only Cloudflare Deployments; traffic 100% ณ 20 พ.ย. |
| DEV deployment | `dabd7c50-61f0-4b51-ae23-93484304f474`, created `2026-11-18T22:01:38.025692Z` | Cloudflare read-only |
| CI run #778 | Manual `workflow_dispatch`, base source SHA เดียวกัน, completed/success | [GitHub Run](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44407280473); **ไม่ได้ทดสอบ 011E** |
| DEV identity manifest | SHA `7b3e557cdb7e481a0eafc798e2f4f06115d9f4d792cf52bf39fcc0b975aa0c30` | Approved pinned baseline source, not candidate E |
| Original manifest runtime tree | `856050787802465955c4ce55c557414c4746391ba39d1daa82c9c7008c6d8a9b` | Expected baseline identity |
| Original manifest asset tree | `acdb8de0fac4f8cef4fd8c9ea4e17655062a7d9f4771a671fa8d07aa60edd1b4` | Expected baseline identity |
| Original served asset hash | `ed8a823eead4d71e92417806210ca9067fbf6f8505ed056f2093f14012440c2c` | Composed baseline ms.js |
| WTR-011E cumulative? | **NO:** WTR-011E optional diff applies *after* verified cumulative WTR-011B ZIP | B SHA `588bfb89a2f4179961210eb437e822b7a7873f8d621fcc3b2092eeb9b7efc81c` |
| WTR-011E local package | `5f244a02aa86103e81ee9cc95e7fe032d4e1e510ec5d509b09e0f9dbe1360f0f`, manifest **30/30** | LOCAL ONLY / REVIEW REQUIRED, no Git commit/deploy |
| WTR-011E gate A | 17/17 targeted synthetic, retained 18/18, repo focused 38/40 (2 baseline failures) | According to Work logs; not live/regression certification |
| WTR-011E gate B | **NOT PROVEN**, 6/8 tests | Exact trip occurrence and TBR-only prior admission still open |
| Candidate Node22 | **NOT VERIFIED**; Node 24.22.3 used | Gate not passed |
| Candidate identity pin | STOP expected after local diff | Do not alter pins to force success |
| Real Drop 39/70 min and TBR 12:37 | **NOT LIVE VERIFIED** | No matching real Drop in HAR capture |
| Security/Builder | **I03 NOT FIXED · Builder ROOT CAUSE UNKNOWN** | Release blockers |
| WTR-011R | **HOLD / NOT STARTED** | No accepted release-ready candidate |
| Production | **RELEASE HOLD** | No deployment authorization |

**Release boundary:** Owner approval for Docs Sync does not authorize DEV source commit, Cloudflare settings edits, Actions dispatch, deploy, rollback, secrets/DB mutation or Production access. Exact DEV builder: `.github/dev-tools/build-exact-dev-runtime.mjs`; expected entrypoint `worker/.dev-runtime/src/turso-index.js`. Prior historical details see pinned GitHub Run #778 and prior Work receipts.
