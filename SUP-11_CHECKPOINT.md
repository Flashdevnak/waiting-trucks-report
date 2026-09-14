# SUP-11 — Shared Quota Center

Status: **PASS — FINAL (SUP-11 scope)**  
Scope: **DEV ONLY**  
Checkpoint date: **2026-09-15 (Asia/Bangkok)**

## Final accepted runtime

- Start base `main`: `2a3b7ba95db4b5d1175a7ba1568c259234fa6c8f`
- Implementation PR: `#23` — Shared Quota Center from shared runtime truth
- Runtime implementation / squash merge: `8f384737c73f7ab8c6299c52ae0f49b39f212756`
- Branch acceptance: SUP-11 Branch Apply **#4 — PASS** (`34885520502`)
- Deploy Worker DEV: **#619 — PASS** (`34885788464`)
- Post Cutover Regression: **#220 — PASS** (`34885788679`)
- DEV Report Truth Acceptance: **#25 — PASS** (`34885851401`)
- Mobile Shell Responsive DEV: **#338 — PASS** (`34885851375`)
- GitHub Pages build: **#1679 — PASS** (`34885787312`)
- Active DEV Worker version verified by Current System Acceptance runtime topology: `f5c8dd69-0de4-40e5-b837-84fc7bd1ea36`

### Cutover Dry Run note

No Cutover Dry Run was triggered by the SUP-11 runtime commit. This is expected from the workflow path filter: it runs on `main` pushes only when cutover/dev-tool/deploy/wrangler files change. SUP-11 changed only Supervisor presentation/test files and did not touch those paths. This checkpoint therefore does **not** fabricate a Cutover Dry Run PASS result for SUP-11.

## Implemented quota presentation contract

SUP-11 is a pure presentation layer over the sanitized shared `quotaTelemetry` introduced by SUP-10. Rendering the Quota Center does not measure provider/account usage and does not create source work.

### Truth source

- Quota data is read only from the existing authenticated one-shot `/api/supervisor/snapshot` response.
- SUP-11 reads `snapshot.quotaTelemetry` only.
- Accepted mode remains `PIGGYBACK_ISOLATE_COUNTERS`.
- Accepted scope remains `current-worker-isolate`.
- The page does not fetch Turso billing APIs, Cloudflare billing APIs, Route, KIT/TBR, PreEntry, HBI, or any other source to render quota state.
- The Supervisor frontend still contains exactly one network fetch for the shared snapshot.

### Truth-safe display

The Quota Center displays, per HUB when valid evidence exists:

- `httpRequests`
- `statements`
- `rowsRead`
- `rowsWritten`
- `errors`
- `providerLimitErrors`
- `heavyReadEvents`
- `providerReadCircuitOpen`
- isolate observation timestamps / coverage

Only actual non-negative safe integers are accepted as counters. Malformed values, stringified numbers, null values, negative values, and invalid booleans remain unknown rather than being coerced to zero.

The Quota Center is bounded to at most **50 HUB observations**.

### Provider / account truth remains unknown

SUP-11 explicitly preserves:

- `billingTruth = UNKNOWN`
- `providerPlanLimit = UNKNOWN`

SUP-11 does **not** expose or invent:

- provider billing totals;
- account-wide usage totals;
- monthly usage totals;
- account plan quotas or limits;
- cross-isolate `rowsRead`, `rowsWritten`, HTTP, or statement totals.

If the observed-HUB denominator is missing, inconsistent, truncated, or does not match the accepted HUB evidence, availability is downgraded to `PARTIAL`. Missing evidence remains `UNKNOWN` / `UNAVAILABLE` as appropriate. SUP-11 never marks missing quota evidence healthy and never fabricates zero usage.

## UI contract

The previous quota placeholder is replaced with a real shared Quota Center that shows:

- evidence mode;
- observed HUB coverage;
- provider billing truth;
- provider plan / limit truth;
- latest accepted observation;
- bounded per-HUB isolate counter cards;
- explicit notes that isolate-local facts are not provider/account/monthly totals.

The Quota Guard card states the hard contracts rather than implying unsupported billing truth.

Frontend cache key: `supervisor.js?v=20260915-sup11`.

## Quota / isolation contract

- Additional provider/source calls for Quota Center rendering: `0`
- Additional provider billing/API calls for Quota Center rendering: `0`
- Additional database reads for Quota Center rendering: `0`
- Additional database writes for Quota Center rendering: `0`
- New background timers: `0`
- New subscriptions: `0`
- New Supervisor WebSocket/EventSource transports: `0`
- New quota persistence / telemetry tables: `0`
- New repair execution / mutations: `0`
- Supervisor AI monitoring/calls: `0`
- HBI background calls: `0` — HBI remains click-only
- Supervisor transport remains the existing authenticated one-shot shared snapshot read.
- Waiting Trucks visible realtime remains the existing shared 4-second UI cadence.
- Direct HTTP 4-second polling timer remains `0`.
- DEV database backend remains Turso.
- Active DEV D1 bindings: `0`.
- Production Worker / DB / routes / secrets / workflows touched: **NO**.

## Acceptance evidence

Final branch acceptance on the SUP-11 branch:

- full worker regression: **115/115 PASS**
- SUP-11 focused Shared Quota Center regressions: **8/8 PASS**
  1. isolate-local evidence is displayed without promotion to provider truth or synthetic totals;
  2. malformed counters remain unknown and are never coerced to zero;
  3. missing quota evidence remains `UNKNOWN`;
  4. inconsistent coverage is downgraded to `PARTIAL`;
  5. missing observed-HUB denominator is downgraded to `PARTIAL`;
  6. client presentation remains bounded to 50 HUBs;
  7. derivation is pure and creates no provider/source/DB/timer/persistence/repair/AI work;
  8. frontend preserves the existing one-shot snapshot transport and truth-safe Quota Center anchors.
- SUP-10 quota instrumentation regressions: PASS
- SUP-09 Incident / Action regressions: PASS
- SUP-08 Event Console regressions: PASS
- SUP-07 Queue / Lifecycle regressions: PASS
- SUP-06 Source Health regressions: PASS
- Supervisor access/shared snapshot/overview regressions: PASS
- Waiting Trucks lifecycle / Drop / completion regressions: PASS
- Realtime / coordinator / auth / HBI / quota-safe-live guards: PASS

Final main runtime acceptance on `8f384737c73f7ab8c6299c52ae0f49b39f212756`:

- Deploy Worker DEV #619: **PASS**
- `npm run check`: **PASS**
- 100-device / 180-day auth resilience: **PASS**
- Supervisor access guard: **PASS**
- Supervisor shared snapshot: **PASS**
- Supervisor overview: **PASS**
- quota-safe-live: **PASS**
- staged DEV runtime: **PASS**
- realtime quota hardening: **PASS**
- D1 rejection / DEV cron guard: **PASS**
- deploy on Turso: **PASS**
- active Worker zero-D1 verification: **PASS**
- live DEV public-page / MS UI smoke: **PASS**
- Post Cutover Regression #220: **PASS**
- DEV Report Truth Acceptance #25: **PASS**
- Mobile Shell Responsive DEV #338: **PASS**
- GitHub Pages #1679: **PASS**

Active DEV Worker version: `f5c8dd69-0de4-40e5-b837-84fc7bd1ea36`.

## Repository-wide operational health note

`Current System Acceptance #115` (`34885851345`) is **FAIL** only at `Verify Turso per-HUB source health`. This is a separate live source/session condition and is not a SUP-11 regression.

At that acceptance check:

- `EA2` connector: inactive; no connector last-used timestamp.
- `EA2` live snapshot: present at `2026-09-14T19:14:06.726Z`, live rows `0`.
- `EA2` Route: **PASS** — last success `2026-09-14T19:09:06.754Z`, age `430s`, no Route error, inside the 20-minute threshold.
- `EA2` PreEntry: optional / unconfigured.
- `EA2` Bus/KIT-TBR: **FAIL** — last success `2026-09-12T05:56:25.146Z`, age `220791s`, error `need login`.
- `NE1` live snapshot: present at `2026-09-14T19:16:08.773Z`, live rows `0`.
- `NE1` Route: **PASS** — last success `2026-09-14T19:02:08.615Z`, age `848s`, no Route error.
- `NE1` PreEntry: **PASS** — last success `2026-09-14T19:16:06.087Z`, age `11s`.
- `NE1` Bus/KIT-TBR: **PASS** — last success `2026-09-14T19:16:06.385Z`, age `10s`.
- Health matrix: `EA2 OVERALL=FAIL`, `NE1 OVERALL=PASS`.
- Acceptance truth: `FAILED_HUBS=EA2` and `ALL_CONFIGURED_HUB_SESSIONS_READY=false`.
- The same workflow's separate read-only Turso quota snapshot step: **PASS**.

The source-health failure must not be made green with synthetic credentials, fabricated sessions/HAR data, fake timestamps, forced source traffic, or database writes. A real refreshed EA2 Bus/KIT-TBR login/session/HAR is required before repository-wide source-health acceptance can become green.

## Dependency audit note

The existing `npm ci` audit continues to report three high-severity dependency findings. This is pre-existing repository dependency-audit debt and was not introduced by SUP-11. SUP-11 does not claim the repository is vulnerability-free.

## Closure

SUP-11 code scope is **100% complete and frozen**. There is no open SUP-11 code blocker. Do not redo or roll back SUP-11.

Future work must start forward-only from the latest remote `main` and preserve all SUP-00–SUP-11 contracts.

**NEXT EXACT ACTION:** Start **SUP-12 — Leak / Circuit / Backoff / Kill-switch Contracts** from the latest remote `main`.

SUP-12 must use only existing SUP-10/SUP-11 shared quota evidence and already-observed runtime facts. It must not add provider/source/DB measurement traffic merely to calculate leak/circuit/backoff/kill-switch state. Provider billing/account/monthly totals and provider plan limits remain `UNKNOWN` unless an explicitly approved bounded shared source already supplies them. Thresholds must be deterministic and local to evidence that actually exists; do not invent account limits. Preserve OBSERVE ONLY unless the checkpoint explicitly permits a bounded safety circuit/backoff state that cannot mutate business/source truth. No automatic repair, no synthetic source calls, no continuous AI monitoring, HBI remains click-only, Turso-only / zero-D1, shared visible 4-second realtime remains unchanged, and Production touched `NO`.