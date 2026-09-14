# SUP-12 CHECKPOINT — Leak / Circuit / Backoff / Kill-switch Contracts

Status: **PASS / FROZEN**
Scope: **DEV ONLY**
Production touched: **NO**

## Baseline and accepted runtime

- SUP-11 baseline: `c294f987e4576627cc762e629e0d6700ab0e3868`
- SUP-12 runtime merge on `main`: `ff4c25c4d93fa3e6a386959376b5ad55e3e50faf`
- SUP-12 runtime PR: #24
- Acceptance-boundary test-only merge: `43ef33c691173e03d162fa26f4ac0f243bb904d5`
- Acceptance-boundary PR: #25

## SUP-12 accepted contract

- Marker: `SUPERVISOR_QUOTA_PROTECTION_V1`
- Supervisor protection state is derived only from existing SUP-10/SUP-11 piggyback isolate diagnostics.
- Leak signal is local guard evidence only; it never claims provider/account quota truth.
- Existing provider-read circuit and heavy-read fingerprint backoff are surfaced passively; SUP-12 does not weaken or add enforcement.
- Global kill switch remains non-executable / not configured unless real bounded evidence exists.
- Provider plan limits, billing totals, account totals, and monthly totals remain `UNKNOWN` in Supervisor.
- No auto repair, no synthetic source call, no continuous AI monitoring, and HBI remains click-only.

## No-cost / architecture contract

SUP-12 adds no measurement traffic merely to render or derive protection state:

- upstream/source polling: `+0`
- provider measurement calls: `+0`
- DB reads/writes for Supervisor protection: `+0 / +0`
- extra ingest requests: `+0`
- timers/subscriptions: `+0`
- persistence: `+0`
- repair execution: `+0`
- AI calls: `+0`
- HBI background requests: `+0`

Waiting Trucks visible ~4s realtime remains on the existing shared per-HUB coordinator. Direct per-client HTTP 4s polling remains prohibited. Turso remains the active DB path; D1 binding remains `0`.

## Verification evidence

- Full repository `npm run check`: **121/121 PASS** before runtime merge.
- Deploy Worker DEV #620: **PASS**.
- Post Cutover #221: **PASS**.
- Cutover Dry Run #380: **PASS**.
- Branch-only acceptance harness run `34893720076`: **12/12 PASS**; temporary workflow removed before PR #25.
- `DEV Queue First Source V1` #18, run `34893908904`, on main SHA `43ef33c691173e03d162fa26f4ac0f243bb904d5`: **12/12 PASS**.
- The stale acceptance assertion was corrected from `ageHours <= 12` to `ageHours < 12`; runtime was not changed. Exact `12:00:00` remains expired by the frozen lifecycle contract (`>= 12h`).

## External condition outside SUP-12

A previously observed EA2 Bus/KIT-TBR `need login` / stale-session condition is external source/session evidence, not a SUP-12 defect. Do not fabricate credentials, traffic, data freshness, or a green source-health result to hide it.

## Freeze

SUP-12 is complete and frozen. Do not redo SUP-00 through SUP-12. Continue forward from the next Supervisor checkpoint only.
