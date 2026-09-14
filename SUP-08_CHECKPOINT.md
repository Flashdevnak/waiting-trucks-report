# SUP-08 — Terminal / Event Console

Status: **PASS — FINAL (SUP-08 scope)**  
Scope: **DEV ONLY**  
Checkpoint date: **2026-09-14**

## Final accepted runtime

- Start base `main`: `90e79b787262575585449e3c43d83907cd623abb`
- Implementation PR: `#19` — Terminal / Event Console from shared runtime state
- Runtime implementation commit: `4217bfee1a2d4c744fd82e31d67a068769186a4e`
- Acceptance-harness follow-up PR: `#20` — cache-key assertion only, runtime behavior unchanged
- Final accepted `main` before this documentation commit: `1f3e4acd1681f753a3ff4ffa6181270e5b004a76`
- Deploy Worker DEV: **#616 — PASS** (`34870760763`)
- Post Cutover Regression: **#217 — PASS** (`34870760783`)
- Active DEV Worker version: `7a0634ab-10f8-4d92-9d3d-1c1bc16793e3`

## Implemented truth contract

- SUP-08 derives terminal events only from the sanitized Supervisor HUB state already entering the existing shared refresh/coordinator path.
- Event history is **ephemeral in-memory only** inside the existing Supervisor singleton Durable Object.
- Event ring is bounded to **120 events maximum**.
- No event is persisted to Turso, D1, Durable Object storage, KV, R2, browser storage, or any other persistent store.
- Only material observed transitions are retained. Unchanged refresh heartbeats do not generate terminal noise.
- Event classes are bounded and sanitized: `HUB_OBSERVED`, `HUB_HEALTH_CHANGED`, `SOURCE_STATE_CHANGED`, `REFRESH_ERROR`, `REFRESH_RECOVERED`, and `QUEUE_COUNTS_CHANGED`.
- Source labels are bounded to existing observed domains such as Route, PreEntry, KIT/TBR and HBI.
- Event time comes only from an observed runtime timestamp (`observedAt` or `lastSuccessAt`). Missing or malformed time causes the event to be dropped; no timestamp is fabricated.
- Event messages are sanitized and bounded before they enter the ring or frontend snapshot.
- Credentials, authorization headers, cookies, tokens and private source payloads are not emitted into terminal events.
- The Supervisor frontend remains a **one-shot** authenticated consumer of `/api/supervisor/snapshot`.
- Terminal filters `ALL / PASS / WARN / ERROR` operate locally on the already received sanitized snapshot.
- `Copy` copies only the currently visible sanitized events.
- `Clear view` is local UI state only. It does not delete the in-memory event ring, audit truth, incident truth or source data; `Restore view` shows the retained snapshot again.
- The terminal intentionally shows `One-shot` rather than pretending there is a background stream.
- Missing event-console evidence remains `UNAVAILABLE`; events are never fabricated for display.

## Quota and isolation contract

- Additional Supervisor upstream polling: `0`
- Additional Supervisor source calls: `0`
- Supervisor database reads for Terminal / Event Console: `0`
- Supervisor database writes: `0`
- New Supervisor background timers: `0`
- New Supervisor subscriptions: `0`
- New Supervisor WebSocket/EventSource transport: `0`
- Event-console persistent storage writes: `0`
- Supervisor AI monitoring/calls: `0`
- HBI background calls: `0` — HBI remains click-only
- Waiting Trucks visible realtime remains the existing shared 4-second UI cadence.
- Direct HTTP 4-second polling timer remains `0`.
- DEV database backend: `Turso`
- Active DEV D1 bindings: `0`
- Production Worker / DB / routes / secrets touched: **NO**

## Acceptance evidence

The first runtime merge (`4217bfee...`) triggered Deploy Worker DEV `#615`. All six SUP-08 focused tests passed, but the combined check stopped at **92/93** because the older SUP-01 core-shell regression still pinned `supervisor.js` to the previous `sup07` browser cache key. No SUP-08 runtime defect was found.

PR `#20` changed only that stale test assertion to the current `sup08` cache key. Runtime behavior was not changed.

The final DEV acceptance on `1f3e4acd1681f753a3ff4ffa6181270e5b004a76` is PASS:

- `npm run check`: **93/93 PASS**
- SUP-08 focused Event Console regressions: **6/6 PASS**
- SUP-07 Queue/Lifecycle regressions: PASS
- SUP-06 Source Health regressions: PASS
- Supervisor Admin/access guard regressions: PASS
- shared snapshot / Overview / HUB health regressions: PASS
- Waiting Trucks lifecycle / Drop / completion regressions: PASS
- realtime / quota / coordinator / connector / auth / HBI regressions: PASS
- staged DEV runtime contract: PASS
- Deploy Worker DEV `#616`: PASS
- active Worker zero-D1 verification: PASS
- live DEV health and UI smoke: PASS
- Supervisor Admin guard: PASS
- Supervisor extra upstream: `0`
- Supervisor DB reads: `0`
- Supervisor DB writes: `0`
- direct HTTP 4-second timer: `0`
- Post Cutover Regression `#217`: PASS
- DEV Report Truth Acceptance `#22`: PASS
- Mobile Shell Responsive DEV `#335`: PASS
- Production touched: `NO`

The active DEV runtime after acceptance is Worker version `7a0634ab-10f8-4d92-9d3d-1c1bc16793e3`, with Turso backend and zero D1 bindings.

## Repository-wide operational health note

`Current System Acceptance #112` (`34870830288`) is **FAIL** only at `Verify Turso per-HUB source health`. This is a separate live source/session condition, not a SUP-08 regression.

At the acceptance check:

- `EA2` live snapshot: present.
- `EA2` Route: **PASS** — last success `2026-09-14T16:34:07.566Z`, age `838s`, no Route error and still inside the 20-minute threshold.
- `EA2` PreEntry: optional / unconfigured.
- `EA2` Bus/KIT-TBR: **FAIL** — last success `2026-09-12T05:56:25.146Z`, error `need login`, connector inactive.
- `NE1`: **PASS** across live snapshot, Route, PreEntry and Bus/KIT-TBR.
- Acceptance truth: `FAILED_HUBS=EA2` and `ALL_CONFIGURED_HUB_SESSIONS_READY=false`.

This source-health failure must not be made green by fabricating credentials, synthetic refresh evidence, fake timestamps or database writes. A real refreshed EA2 Bus/KIT-TBR login/session/HAR is required before repository-wide source-health acceptance can become green.

## Closure

SUP-08 code scope is **100% complete and frozen**. There is no open SUP-08 code blocker. Do not redo or roll back SUP-08.

Future work must start forward-only from the latest remote `main` and preserve all SUP-00–SUP-08 contracts.

**NEXT EXACT ACTION:** Start **SUP-09 — Alert / Incident / Action Center** from latest remote `main`. It must remain DEV-only and observe-only, dedupe and summarize only bounded sanitized evidence already present in shared Supervisor state / the SUP-08 event ring, preserve missing evidence as `UNKNOWN`, and add no per-render upstream/DB traffic, background polling, persistent event writes, uncontrolled timers/subscriptions, repair automation, or AI monitoring.
