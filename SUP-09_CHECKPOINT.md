# SUP-09 — Alert / Incident / Action Center

Status: **PASS — FINAL (SUP-09 scope)**  
Scope: **DEV ONLY**  
Checkpoint date: **2026-09-14**

## Final accepted runtime

- Start base `main`: `ef7bbce9fc4950a6f80e6a476006fb8d8bdc9b61`
- Implementation PR: `#21` — Alert / Incident / Action Center from shared evidence
- Runtime implementation / squash merge: `36dfa4616a1d14f9f1da14cd34a739b4795ffa2c`
- Deploy Worker DEV: **#617 — PASS** (`34875014127`)
- Post Cutover Regression: **#218 — PASS** (`34875014204`)
- DEV Report Truth Acceptance: **#23 — PASS** (`34875093281`)
- Mobile Shell Responsive DEV: **#336 — PASS** (`34875093352`)
- Active DEV Worker version: `89ed37e8-9cb1-4aeb-b497-4e4c5cd4996a`

## Implemented truth contract

SUP-09 is a frontend-derived, observe-only incident/action layer built only from the sanitized Supervisor snapshot that already exists plus the SUP-08 ephemeral event ring.

### Incident truth

- **Current sanitized HUB/source state is authoritative for whether an incident is currently OPEN.**
- A historical WARN/ERROR event does not keep an incident open after the current shared state has recovered.
- Event history alone never asserts that an incident is still open.
- Missing current HUB evidence remains `UNKNOWN` / `UNAVAILABLE`; it is not treated as HEALTHY or as an incident.
- Current source states map conservatively:
  - `ERROR`, `CRITICAL`, `BLOCKED` → ERROR incident severity.
  - `AUTH_REQUIRED`, `WARNING`, `STALE`, `PARTIAL` → WARN incident severity.
- HBI `CLICK_ONLY + UNKNOWN` does not create an incident because absence of a click result is not evidence of failure.
- `QUEUE_COUNTS_CHANGED` remains an informational event and does not become an incident merely because counts changed.
- Source incidents are deduped by current HUB/source key, for example `SOURCE:<HUB>:KIT_TBR`.
- Current refresh errors use a bounded `REFRESH:<HUB>` key.
- A generic `HUB:<HUB>` fallback incident is created only when current HUB health requires review and no more specific current source/refresh incident explains it.
- Event-ring timestamps may be used as supporting evidence when valid. Missing or malformed time remains unknown; no timestamp is fabricated.

### Action Center truth

- Every SUP-09 action is a manual recommendation only.
- Supported bounded action kinds are `MANUAL_REAUTH`, `MANUAL_FRESHNESS_REVIEW`, `MANUAL_SOURCE_REVIEW`, `MANUAL_REFRESH_REVIEW`, and `MANUAL_HUB_REVIEW`.
- Every action has `canExecute=false` and `mode=OBSERVE_ONLY`.
- The Action Center has no repair execution button, mutation endpoint, write path, shell execution, credential fabrication, synthetic refresh, or auto-remediation.
- Re-auth guidance explicitly requires a real refreshed session/HAR and the existing shared refresh/coordinator to confirm recovery.
- A recovered current state removes the pending action; historical event evidence remains history only.

## Quota and isolation contract

- Additional Supervisor upstream polling: `0`
- Additional Supervisor source calls: `0`
- Additional Supervisor database reads for SUP-09: `0`
- Additional Supervisor database writes: `0`
- New Supervisor background timers: `0`
- New Supervisor subscriptions: `0`
- New Supervisor WebSocket/EventSource transports: `0`
- New persistent incident/event writes: `0`
- New repair executions / mutations: `0`
- Supervisor AI monitoring/calls: `0`
- HBI background calls: `0` — HBI remains click-only
- Supervisor still performs one authenticated same-origin `/api/supervisor/snapshot` read at page load.
- Waiting Trucks visible realtime remains the existing shared 4-second UI cadence.
- Direct HTTP 4-second polling timer remains `0`.
- DEV database backend: `Turso`
- Active DEV D1 bindings: `0`
- Production Worker / DB / routes / secrets / workflows touched: **NO**

## Acceptance evidence

Final acceptance on `36dfa4616a1d14f9f1da14cd34a739b4795ffa2c`:

- `npm run check`: **100/100 PASS**
- SUP-09 focused Incident/Action regressions: **7/7 PASS**
  1. current `AUTH_REQUIRED` creates one deduped manual re-auth incident/action;
  2. recovered current state closes a historical warning;
  3. event history alone never asserts an open incident;
  4. queue-count event remains informational;
  5. source incidents dedupe by HUB/source key without a redundant HUB incident;
  6. pure derivation adds no source/DB/timer/transport/persistence/repair/AI work;
  7. frontend preserves one-shot snapshot transport and disabled action execution.
- SUP-08 Event Console regressions: PASS
- SUP-07 Queue/Lifecycle regressions: PASS
- SUP-06 Source Health regressions: PASS
- Supervisor Admin/access guard regressions: PASS
- Shared snapshot / Overview / HUB health regressions: PASS
- Waiting Trucks lifecycle / Drop / completion regressions: PASS
- Realtime / coordinator / auth / HBI / quota guards: PASS
- Staged DEV runtime contract: PASS
- `DEV_D1_CONFIG_BINDING=0`
- `WORKER_D1_BINDING_ZERO=PASS`
- live DEV health and UI smoke: PASS
- `DEV_SUPERVISOR_EXTRA_UPSTREAM=0`
- `DEV_SUPERVISOR_DB_READS=0`
- `DEV_SUPERVISOR_DB_WRITES=0`
- `DEV_REALTIME_VISIBLE_4S=PASS`
- `DEV_DIRECT_HTTP_4S_TIMER=0`
- `DEV_DATABASE_BACKEND=TURSO`
- `DEV_D1_RUNTIME_BINDING=0`
- `PRODUCTION_TOUCHED=NO`
- Post Cutover Regression `#218`: PASS
- DEV Report Truth Acceptance `#23`: PASS
- Mobile Shell Responsive DEV `#336`: PASS

The accepted DEV runtime is Worker version `89ed37e8-9cb1-4aeb-b497-4e4c5cd4996a`.

## Repository-wide operational health note

`Current System Acceptance #113` (`34875093254`) is **FAIL** only at `Verify Turso per-HUB source health`. This is a separate live source/session condition and is not a SUP-09 regression.

At the acceptance check:

- `EA2` live snapshot: present (`2026-09-14T17:13:07.117Z`).
- `EA2` Route: **PASS** — last success `2026-09-14T17:21:06.710Z`, age `544s`, no Route error and inside the 20-minute threshold.
- `EA2` PreEntry: optional / unconfigured.
- `EA2` Bus/KIT-TBR: **FAIL** — last success `2026-09-12T05:56:25.146Z`, error `need login`, connector inactive.
- `NE1`: **PASS** — Route last success `2026-09-14T17:29:07.902Z`, PreEntry `17:22:06.861Z`, Bus/KIT-TBR `17:19:06.027Z`.
- Acceptance truth: `FAILED_HUBS=EA2` and `ALL_CONFIGURED_HUB_SESSIONS_READY=false`.

This source-health failure must not be made green by synthetic credentials, fabricated session/HAR data, fake timestamps, forced source traffic, or database writes. A real refreshed EA2 Bus/KIT-TBR login/session/HAR is required before repository-wide source-health acceptance can become green.

## Dependency audit note

The existing `npm ci` audit still reports three high-severity dependency findings. This is pre-existing repository dependency-audit debt and was not introduced by SUP-09. SUP-09 does not claim the repository is vulnerability-free.

## Closure

SUP-09 code scope is **100% complete and frozen**. There is no open SUP-09 code blocker. Do not redo or roll back SUP-09.

Future work must start forward-only from the latest remote `main` and preserve all SUP-00–SUP-09 contracts.

The authoritative forward plan in `SUPERVISOR_CHECKPOINTS.md` assigns SUP-10–SUP-12 to quota work before any repair execution.

**NEXT EXACT ACTION:** Start **SUP-10 — Piggyback Quota Instrumentation** from the latest remote `main`. Instrument only work that already occurs and expose bounded sanitized counters through existing shared Supervisor state. It must not create provider/source calls merely to measure quota, must not add per-render or per-client DB traffic, must not add new background timers/subscriptions, must preserve HBI click-only, Turso-only / zero-D1, the 4-second shared realtime contract, OBSERVE ONLY, and Production touched `NO`.