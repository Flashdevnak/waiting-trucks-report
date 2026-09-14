# SUP-13 Checkpoint — Thai / English Supervisor Language Contract

Status: **PASS / FROZEN**

## Scope

- Repository: `Flashdevnak/waiting-trucks-report`
- Environment: **DEV ONLY**
- Production touched: **NO**
- Base checkpoint: `c1054559190ff7e41d83144674da281d558d4c3c` (SUP-12 frozen)
- PR: #26 `SUP-13: Thai / English Supervisor language contract`
- Runtime merge: `b6d801d6584ad52e092874b828ea49d017da642b`
- Marker: `SUPERVISOR_I18N_V1`
- Supervisor cache key: `20260915-sup13`

## Accepted contract

- Thai is the default Supervisor language.
- Admin gate and Supervisor top bar expose an English toggle.
- Language preference is browser-local only and falls back to Thai if storage is unavailable or invalid.
- Translation is pure frontend presentation only.
- Canonical technical truth/evidence codes remain unchanged, including `UNKNOWN`, `HEALTHY`, `AUTH_REQUIRED`, `OBSERVE ONLY`, HUB codes, and source identifiers.
- Arbitrary runtime evidence/event text is not rewritten. Only bounded known UI copy/templates are translated.
- No added upstream/source/provider requests, DB reads/writes, timers, subscriptions, persistence, repair execution, or AI work.
- Existing Waiting Trucks visible 4-second realtime/shared coordinator contract remains unchanged.
- Direct HTTP 4-second polling remains 0.
- HBI remains click-only.
- Turso remains the runtime database; D1 remains 0.

## Validation evidence

### Branch validation

- Branch: `codex/sup-13-thai-english`
- SUP-13 Branch Apply run: `34895535650` — **SUCCESS**
- Focused SUP-13 language contract: **7/7 PASS**
- Full `npm run check`: **128/128 PASS**
- Diff safety: **PASS**
- Temporary branch patchers/workflow were removed before PR.

### Main DEV deployment

- Deploy Worker DEV #621: run `34896119838` — **PASS**
- Full check in deployment: **128/128 PASS**
- Active DEV Worker version: `61fc2fc7-b8ba-43f5-9b94-fff78f681517`
- `supervisor-i18n.js` staged and syntax-checked in DEV deployment.
- Active DEV Worker D1 binding: **0**
- Supervisor extra upstream: **0**
- Supervisor DB reads: **0**
- Supervisor DB writes: **0**
- Visible realtime 4s: **PASS**
- Direct HTTP 4s timer: **0**
- Production touched: **NO**

### Main downstream acceptance

- Post Cutover Regression #222 — run `34896119830` — **PASS**
- Cutover Dry Run #381 — run `34896119788` — **PASS**
- DEV Report Truth Acceptance #27 — run `34896181655` — **PASS**
- Mobile Shell Responsive DEV #340 — run `34896181641` — **PASS**
- Pages build and deployment #1684 — run `34896118788` — **PASS**

### Current System Acceptance #117

- Run `34896181583` — **FAIL only on external EA2 BUS/KIT-TBR source/session health**.
- User-facing pages/realtime invariants: **PASS**.
- Canonical/staged runtime boundary: **PASS**.
- Browser recovery/Cron policy: **PASS**.
- Cloudflare active runtime topology: **PASS**.
- Sanitized Turso quota snapshot: **PASS**.
- NE1 source health: **PASS**.
- EA2 Route was fresh and healthy during the run (`2026-09-14T20:57:51.346Z`, no Route error).
- EA2 BUS/KIT-TBR last success remained `2026-09-12T05:56:25.146Z` with `need login`, so EA2 BUS health was correctly reported FAIL.
- No fake HAR/session, synthetic traffic, forced refresh, or database write was used to make this condition green.
- This external session condition is not a SUP-13 language/runtime regression.

## Safety / quota notes

- SUP-13 adds presentation-only language behavior.
- No provider billing/account/monthly limit is inferred by Supervisor.
- No additional measurement traffic was introduced.
- Existing npm audit findings (3 high severity) pre-date SUP-13 and are not claimed resolved by this checkpoint.

## Freeze

SUP-13 is accepted and frozen. Do not redo SUP-13 unless a later regression specifically invalidates this contract.

**NEXT EXACT ACTION: SUP-14 — Supervisor Guide contract**, continuing from latest `main` and preserving all SUP-00 through SUP-13 contracts.
