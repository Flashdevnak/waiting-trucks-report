# SUP-06 — Source Health

Status: **PASS / DEV DEPLOYED**

Scope: **DEV ONLY**  
Checkpoint date: 2026-09-14  
Base remote main: `53b36dff7ab328c665bbe18aa89e81a6cb2c459c`  
PR: `#15` — SUP-06: Source Health from shared refresh telemetry  
SUP-06 code/deploy main: `24e5ff72b2e0fe05f83728203499f7a287f0cb74`

## Implemented

- Source Health is derived per observed HUB for Route, PreEntry/FBI, Bus/KIT/TBR, and HBI.
- Telemetry piggybacks only on data/state already produced by the existing shared refresh/coordinator path.
- Route uses the existing refresh outcome and source error classification.
- PreEntry/FBI uses the existing returned enrichment Map outcome; no additional reader is invoked.
- Bus/KIT/TBR uses the existing in-memory BusTime diagnostics and the Map returned by the normal refresh.
- HBI uses only existing click-triggered in-memory diagnostics and remains `CLICK_ONLY`; Supervisor never polls HBI to measure health.
- Sanitized source fields include state, configured, last success, last used, retry time, error code, recovery, mode, and observed state.
- Missing evidence remains `UNKNOWN`; missing data is never treated as healthy.
- Freshness threshold is 20 minutes for refresh-driven sources. A previously healthy source whose observed success becomes older than the threshold derives to `STALE`.
- HBI is exempt from age-based stale classification because it is explicitly on-demand.
- HUB cards and aggregate Source Health use the same freshness derivation so they cannot disagree on stale state.

## Hard runtime contracts

- Additional Supervisor upstream polling: `0`
- Additional Supervisor database reads: `0`
- Additional Supervisor database writes: `0`
- Additional Supervisor timers: `0`
- Additional Supervisor subscriptions: `0`
- Additional Supervisor AI calls: `0`
- Supervisor frontend transport: exactly one authenticated same-origin `/api/supervisor/snapshot` read on page load; no polling timer/WebSocket/EventSource added.
- HBI background reads: `0`
- Production touched: `NO`

## Regression coverage

Focused SUP-06 tests are in `worker/tests/supervisor-source-health.test.mjs` and are wired into `npm run check`.

Verified cases:

1. Fresh/STALE/UNKNOWN derivation is truth-safe.
2. Overview Source Health uses the same freshness truth as HUB cards.
3. HBI remains click-only/on-demand and is not marked stale from age alone.
4. Source-specific auth/error states produce bounded review action without exposing private error text.
5. Staged Source Health helper contains no DB query, source fetch/read, timer, WebSocket, EventSource, persistence, repair, or AI work.
6. Supervisor frontend remains one-shot snapshot only.

DEV workflow `Deploy Worker DEV #611` passed the SUP-06 tests `6/6` and the first combined `npm run check` suite `81/81`, with `0` failures. Existing Supervisor, realtime, quota, lifecycle, Turso, HBI, Proof, staging, and safety suites also passed.

## DEV deployment

GitHub Actions run: `Deploy Worker DEV #611`  
Run ID: `34861631223`  
Deployed Worker: `waiting-trucks-report-api-dev`  
DEV URL: `https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev`  
Active DEV Version ID: `c84d994a-5cc9-401f-af75-66bd9675581b`

Deployment verification:

- `DEV_TURSO_CONFIG=PASS`
- `DEV_D1_CONFIG_BINDING=0`
- `WORKER_D1_BINDING_ZERO=PASS`
- `DEV_HEALTH=PASS`
- `DEV_SUPERVISOR_CORE_SHELL=PASS`
- `DEV_SUPERVISOR_ADMIN_GUARD=PASS`
- `DEV_SUPERVISOR_EXTRA_UPSTREAM=0`
- `DEV_SUPERVISOR_DB_READS=0`
- `DEV_SUPERVISOR_DB_WRITES=0`
- `DEV_REALTIME_WS_V1=PASS`
- `DEV_REALTIME_VISIBLE_4S=PASS`
- `DEV_DIRECT_HTTP_4S_TIMER=0`
- `DEV_DATABASE_BACKEND=TURSO`
- `DEV_D1_RUNTIME_BINDING=0`
- `PRODUCTION_TOUCHED=NO`

The live smoke also verified that an unauthenticated direct request to `/supervisor.html` is rejected with `403` and the Supervisor shell is not leaked.

## Compatibility and quota evidence

- Existing TBR patch chain remains compatible; the SUP-06 implementation does not modify the PreEntry reader body used by downstream patch anchors.
- `TBR_EXTRA_MS_POLLING=0`
- `BUS_TIME_TELEMETRY_DB_WRITES=0`
- `BUS_TIME_LIVE_ACCEPTANCE_ROUTE_CALLS=0`
- `BUS_TIME_LIVE_ACCEPTANCE_PREENTRY_CALLS=0`
- `BUS_TIME_LIVE_ACCEPTANCE_TURSO_WRITES=0`
- HBI regression confirms it remains outside realtime refresh.
- Existing 4-second visible realtime and 12-second shared Route source cadence remain unchanged.

## Production guard

No Production Worker, Production deployment, Production route/config, Production database, Production secret, or Production workflow was modified or deployed for SUP-06.

**Production touched: NO.**

## Next exact action

Start **SUP-07 Queue / Lifecycle Diagnostics** from the latest remote `main` after this checkpoint-document commit. Preserve all SUP-00 through SUP-06 PASS contracts and continue DEV ONLY.
