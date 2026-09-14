# SUP-10 — Piggyback Quota Instrumentation

Status: **PASS — FINAL (SUP-10 scope)**  
Scope: **DEV ONLY**  
Checkpoint date: **2026-09-15 (Asia/Bangkok)**

## Final accepted runtime

- Start base `main`: `73d79b271e084f56c2575232df4787838c5ae4a9`
- Implementation PR: `#22` — Piggyback quota instrumentation
- Runtime implementation / squash merge: `abda642d1d78b49416bf84689816c4d0f99f20ec`
- Deploy Worker DEV: **#618 — PASS** (`34882478343`)
- Post Cutover Regression: **#219 — PASS** (`34882478313`)
- Cutover Dry Run: **#379 — PASS** (`34882478390`)
- DEV Report Truth Acceptance: **#24 — PASS** (`34882543127`)
- Mobile Shell Responsive DEV: **#337 — PASS** (`34882543025`)
- GitHub Pages build: **#1677 — PASS** (`34882477366`)
- Active DEV Worker version: `b44c16d3-010c-41f9-a56b-716a8a31a3a7`

## Implemented quota truth contract

SUP-10 adds passive quota instrumentation only. It does not create quota/provider/source work in order to measure quota.

### Evidence source

- The existing Turso adapter already maintains in-memory runtime counters for work that actually occurred in the current Worker isolate.
- The existing `QUOTA_DIAGNOSTICS()` function is sampled synchronously after normal per-HUB work has already run.
- The sanitized quota observation is attached to the **same existing Supervisor `/supervisor/ingest` message** used by the per-HUB coordinator. No second ingest request or measurement request is created.
- The shared Supervisor singleton stores only bounded sanitized observations in memory.
- Maximum retained quota observations: **50 HUBs**.

### Exposed sanitized fields

Per HUB, SUP-10 may expose only:

- `scope = current-worker-isolate`
- `since`
- `observedAt`
- `lastObservedAt`
- `httpRequests`
- `statements`
- `rowsRead`
- `rowsWritten`
- `errors`
- `providerLimitErrors`
- `heavyReadEvents`
- `providerReadCircuitOpen`

Private SQL text, URLs, tokens, passwords, connector credentials, source payloads, and business rows are not copied into quota telemetry.

Counters are accepted only when they are actual non-negative safe integers. Malformed/null/string values remain unknown (`null`) rather than being coerced to zero.

### Truth labeling

The shared snapshot exposes a bounded block:

- `mode = PIGGYBACK_ISOLATE_COUNTERS`
- `billingTruth = UNKNOWN`
- availability is `AVAILABLE`, `PARTIAL`, `UNKNOWN`, or `UNAVAILABLE` according to actual evidence and HUB coverage.

These values are **current Worker-isolate runtime observations only**. They are not Turso provider billing totals, account quota usage, monthly plan limits, or Cloudflare account billing truth. SUP-10 never promotes isolate-local counters into provider truth.

If an observed HUB has no valid quota evidence, shared quota coverage remains `PARTIAL`. If no quota evidence exists, it remains `UNKNOWN`/`UNAVAILABLE` instead of fabricating zero usage.

## Quota and isolation contract

- Additional Supervisor upstream/source calls for quota measurement: `0`
- Additional provider billing/API calls for Supervisor quota measurement: `0`
- Additional Supervisor database reads for SUP-10: `0`
- Additional Supervisor database writes for SUP-10: `0`
- Additional Supervisor ingest requests: `0` — quota rides the existing ingest message
- New Supervisor background timers: `0`
- New Supervisor subscriptions: `0`
- New Supervisor WebSocket/EventSource transports: `0`
- New quota persistence / telemetry tables: `0`
- New repair execution / mutations: `0`
- Supervisor AI monitoring/calls: `0`
- HBI background calls: `0` — HBI remains click-only
- Supervisor page transport remains the existing authenticated one-shot shared snapshot read.
- Waiting Trucks visible realtime remains the existing shared 4-second UI cadence.
- Direct HTTP 4-second polling timer remains `0`.
- DEV database backend: `Turso`
- Active DEV D1 bindings: `0`
- Production Worker / DB / routes / secrets / workflows touched: **NO**

## Acceptance evidence

Final acceptance on `abda642d1d78b49416bf84689816c4d0f99f20ec`:

- `npm run check`: **107/107 PASS**
- SUP-10 focused quota instrumentation regressions: **7/7 PASS**
  1. only sanitized isolate-local quota facts are exposed;
  2. malformed counters remain PARTIAL/unknown and are never fabricated as zero;
  3. shared snapshot exposes quota telemetry while `billingTruth` stays `UNKNOWN`;
  4. missing HUB quota evidence produces `PARTIAL` coverage;
  5. quota observations are bounded to 50 HUBs;
  6. telemetry piggybacks onto the existing ingest request with no measurement I/O;
  7. `QUOTA_DIAGNOSTICS()` is a passive snapshot and does not increment work merely by being read.
- SUP-09 Incident / Action regressions: PASS
- SUP-08 Event Console regressions: PASS
- SUP-07 Queue/Lifecycle regressions: PASS
- SUP-06 Source Health regressions: PASS
- Supervisor access/shared snapshot/overview regressions: PASS
- Waiting Trucks lifecycle / Drop / completion regressions: PASS
- Realtime / coordinator / auth / HBI / quota-safe-live guards: PASS
- Staged DEV runtime contract: PASS
- `DEV_D1_CONFIG_BINDING=0`
- `WORKER_D1_BINDING_ZERO=PASS`
- live DEV health/UI smoke: PASS
- `DEV_SUPERVISOR_EXTRA_UPSTREAM=0`
- `DEV_SUPERVISOR_DB_READS=0`
- `DEV_SUPERVISOR_DB_WRITES=0`
- `DEV_REALTIME_VISIBLE_4S=PASS`
- `DEV_DIRECT_HTTP_4S_TIMER=0`
- `DEV_DATABASE_BACKEND=TURSO`
- `DEV_D1_RUNTIME_BINDING=0`
- `PRODUCTION_TOUCHED=NO`

Accepted DEV runtime version: `b44c16d3-010c-41f9-a56b-716a8a31a3a7`.

## Repository-wide operational health note

`Current System Acceptance #114` (`34882543052`) is **FAIL** only at `Verify Turso per-HUB source health`. This is a separate live source/session condition and is not a SUP-10 regression.

At that acceptance check:

- `EA2` live snapshot: present (`2026-09-14T18:29:07.318Z`).
- `EA2` Route: **PASS** — last success `2026-09-14T18:38:06.779Z`, age `332s`, no Route error and inside the 20-minute threshold.
- `EA2` PreEntry: optional / unconfigured.
- `EA2` Bus/KIT-TBR: **FAIL** — last success `2026-09-12T05:56:25.146Z`, age `218833s`, error `need login`, connector inactive.
- `NE1`: **PASS** — Route last success `2026-09-14T18:30:08.631Z`, PreEntry `2026-09-14T18:43:06.876Z`, Bus/KIT-TBR `2026-09-14T18:33:06.153Z`.
- Acceptance truth: `FAILED_HUBS=EA2` and `ALL_CONFIGURED_HUB_SESSIONS_READY=false`.
- The same workflow's separate read-only Turso quota snapshot step: **PASS**.

This source-health failure must not be made green by synthetic credentials, fabricated session/HAR data, fake timestamps, forced source traffic, or database writes. A real refreshed EA2 Bus/KIT-TBR login/session/HAR is required before repository-wide source-health acceptance can become green.

## Dependency audit note

The existing `npm ci` audit continues to report three high-severity dependency findings. This is pre-existing repository dependency-audit debt and was not introduced by SUP-10. SUP-10 does not claim the repository is vulnerability-free.

## Closure

SUP-10 code scope is **100% complete and frozen**. There is no open SUP-10 code blocker. Do not redo or roll back SUP-10.

Future work must start forward-only from the latest remote `main` and preserve all SUP-00–SUP-10 contracts.

The authoritative forward plan in `SUPERVISOR_CHECKPOINTS.md` assigns SUP-10–SUP-12 to quota work: piggyback instrumentation, then shared Quota Center, then leak/circuit/backoff/kill-switch contracts.

**NEXT EXACT ACTION:** Start **SUP-11 — Shared Quota Center** from the latest remote `main`. Build the Supervisor quota presentation only from SUP-10 shared sanitized telemetry and already-available truth. Provider/account billing or plan-limit data that is not already available through an approved bounded shared source must remain `UNKNOWN`; rendering the Quota Center must not trigger provider/source calls, per-render/per-client database traffic, new background timers/subscriptions, persistence, repair execution, or AI monitoring. Preserve HBI click-only, Turso-only / zero-D1, the shared 4-second realtime contract, OBSERVE ONLY, and Production touched `NO`.