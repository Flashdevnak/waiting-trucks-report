# SUP-14 Checkpoint — Supervisor Guide Contract

Status: **PASS / FROZEN**

## Scope

- Repository: `Flashdevnak/waiting-trucks-report`
- Environment: **DEV ONLY**
- Production touched: **NO**
- Base checkpoint: `ef898279d24b17c52fad8348fc593f5f8936d564` (SUP-13 frozen)
- PR: #27 `SUP-14: Supervisor Guide contract`
- Runtime merge: `ae101963430f0b256d9a9b4bb172731dbd53677e`
- Marker: `SUPERVISOR_GUIDE_V1`
- Supervisor cache key: `20260915-sup14`

## Accepted contract

- Supervisor Guide is static/read-only operating guidance only.
- Thai remains the default presentation language and bounded English translation reuses the existing SUP-13 frontend-only i18n contract.
- Guide operating flow is: Overall/Snapshot → HUB/Source Health → latest evidence → Queue/Lifecycle → recovery confirmation through the existing refresh/coordinator.
- Guide defines status truth for `UNKNOWN`, `HEALTHY`, `STALE`, `AUTH_REQUIRED`, `ERROR`, and `OBSERVE ONLY` without changing runtime truth codes.
- Guide defines evidence levels `FACT`, `INFERENCE`, and `SUSPICION`; inference or suspicion must never replace current fact.
- Troubleshooting requires real session/HAR evidence, forbids fabricated sessions and synthetic refreshes, and forbids extra direct polling merely to prove recovery.
- Queue/Lifecycle guidance reuses the already accepted queue truth. SUP-14 does not alter arrival, unloading, departure, expiry, or incident predicates.
- HBI remains click-only.
- No Auto Repair or business-data mutation is enabled by SUP-14.
- No additional upstream/source/provider requests, DB reads/writes, timers, subscriptions, persistence, repair execution, or AI work are introduced.
- Existing Waiting Trucks visible 4-second realtime/shared coordinator contract remains unchanged.
- Direct HTTP 4-second polling remains 0.
- Turso remains the runtime database; D1 remains 0.
- Missing evidence remains `UNKNOWN` or `PARTIAL` as appropriate and is never converted to healthy by presentation logic.
- Incident resolution requires current shared state plus accepted current evidence; event history alone is not sufficient to close an incident.
- `Copy Current System Context` remains **disabled**. It must not be enabled until the SUP-15 redaction contract passes.

## Validation evidence

### Branch validation

- Branch: `codex/sup-14-supervisor-guide`
- SUP-14 Branch Apply run: `34965720943` — **SUCCESS**
- Focused SUP-14 + SUP-13 contract tests: **13/13 PASS**
- Primary full regression batch: **134/134 PASS**
- Full `npm run check`: **PASS**
- Diff safety: **PASS**
- `PRODUCTION_TOUCHED=NO`
- Temporary SUP-14 branch patcher/workflow were removed before PR.

### Main DEV deployment

- Deploy Worker DEV #622: run `34965884165` — **PASS**
- Primary regression batch in deployment: **134/134 PASS**
- Full `npm run check`: **PASS**
- Active DEV Worker version: `592d88a6-8c9c-4c7f-93de-5b70661a17e0`
- Supervisor guide assets deployed with cache key `20260915-sup14`.
- Active DEV Worker D1 binding: **0**
- Supervisor extra upstream: **0**
- Supervisor DB reads: **0**
- Supervisor DB writes: **0**
- Visible realtime 4s: **PASS**
- Direct HTTP 4s timer: **0**
- Runtime database backend: **TURSO**
- Production touched: **NO**

### Main downstream acceptance

- Post Cutover Regression #223 — run `34965884176` — **PASS**
- DEV Report Truth Acceptance #28 — run `34965952137` — **PASS**
- Mobile Shell Responsive DEV #341 — run `34965952067` — **PASS**
- Pages build and deployment #1686 — run `34965883399` — **PASS**
- **Cutover Dry Run:** no SUP-14 Cutover Dry Run was observed/triggered for runtime merge `ae101963430f0b256d9a9b4bb172731dbd53677e`; no run number is claimed for SUP-14.

### Current System Acceptance #118

- Run `34965952037` — **FAIL only on current/external source-health state; not a SUP-14 guide/runtime regression**.
- User-facing pages/realtime invariants: **PASS**.
- Canonical/staged runtime boundary: **PASS**.
- Browser recovery/Cron policy: **PASS**.
- Cloudflare active runtime topology: **PASS**.
- Sanitized Turso quota snapshot: **PASS**.
- EA2 current Route health showed external auth/401 failure and BUS/KIT-TBR remained `need login`.
- NE1 last-success evidence was still fresh, but the latest Route state reported `ระบบต้นทางตอบช้าเกิน 9 วินาที`, so the source-health contract correctly reported Route failure instead of hiding the current error.
- No fake HAR/session, synthetic traffic, forced refresh, source-health override, or database write was used to make these conditions green.

## Safety / quota notes

- SUP-14 is presentation/read-only guidance and adds no measurement traffic.
- Provider account/monthly totals or provider plan limits are not inferred from missing evidence.
- Existing npm audit findings (**3 high severity**) pre-date SUP-14 and are not claimed resolved by this checkpoint.

## Freeze

SUP-14 is accepted and frozen. Do not redo SUP-14 unless a later regression specifically invalidates this contract.

**NEXT EXACT ACTION: SUP-15 — Redacted System Context / copy contract**, continuing from latest `main` and preserving all SUP-00 through SUP-14 contracts.
