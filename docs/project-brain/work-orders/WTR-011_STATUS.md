# WTR-011 — KIT/TBR Arrival & Drop Correction (Current Status)

**As-of:** 20 November 2026, Asia/Bangkok. **LOCAL ONLY / REVIEW REQUIRED; NOT RELEASE ACCEPTED**.

- Baseline DEV HEAD `e6fe36b01b34866f6f90294df572f0dd015913d5` / Version 650 UUID `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637`. Latest source/deployment must be rechecked for subsequent actions.
- WTR-011B cumulative local patch ZIP SHA `588bfb89a2f4179961210eb437e822b7a7873f8d621fcc3b2092eeb9b7efc81c`; retained tests 18/18, new occurrence tests 6/8; does not establish exact identity.
- WTR-011C and D established evidence gaps; HAR Evidence First found raw Route/BusTime capture, which supports mapping and field-loss analysis **not** actual Drop same-trip truth.
- **WTR-011E** ZIP SHA `5f244a02aa86103e81ee9cc95e7fe032d4e1e510ec5d509b09e0f9dbe1360f0f` / manifest 30/30. Optional local patch to staging helper `patch-ms-route-cancellation-compat.mjs`; Drop overdue filter uses same adjusted departure countdown as UI. Worker tree 27 files byte-identical B→E according to Work log.
- **Gate A (Functional)**: 17/17 targeted staged synthetic (vs 15/17 before optional patch); retained 18/18; repository focused 38/40 with same baseline 2 failures. Reports/logs are evidence of test run, not Live Acceptance.
- **Gate B (Exact Trip + Prior TBR-only Admission)**: NOT PROVEN / 6/8. Proof+attendance does not establish cross-source exact occurrence; in-memory TBR-only projection is not a durable admission receipt.
- **Release**: Node 22 NOT VERIFIED (Node 24.22.3 used), identity pin STOP expected, I03 NOT FIXED, Builder ROOT CAUSE UNKNOWN, real Drop 39/70m and TBR 12:37 NOT VERIFIED, Production RELEASE HOLD.
- No commit/push/deploy of Candidate. Do **not** start WTR-011R or invent trip identity. Read [System Knowledge](../system/README_TH.md) and [Current Status](../system/CURRENT_STATUS_TH.md).
