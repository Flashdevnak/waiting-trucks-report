# MS Operational Contract V1

Status: normative recovery contract

Scope: DEV only

Recovery base: `3591527c1c3bc25a1731f46a82529d684e25be05`

Recovery branch: `codex/dev-recovery-contract-v2`

This document is the behavioral source of truth for recovering the Waiting
Trucks DEV implementation. It does not assert that the lost local CP-00 through
CP-14 commits or their Git objects still exist. Recovery must reproduce the
contracts and tests from the exact remote baseline; it must not manufacture old
history, guessed commits, or historical evidence.

## Safety boundary

- Production deployment, configuration, database, secrets, migrations,
  routes, domains, and tests are forbidden.
- `main` must not be changed or merged by recovery work.
- Recovery commits must be made only on
  `codex/dev-recovery-contract-v2`, pushed without force, and verified against
  the remote branch before the next checkpoint begins.
- DEV runtime database authority is Turso. Active DEV D1 bindings must remain
  exactly zero.
- A lifecycle result must never be fabricated to compensate for missing source
  evidence. Quota protection must come from sharing, batching, deduplication,
  bounded work, missing-only work, cooldowns, and incremental progress.

## Canonical terms and authority

- **KIT** is Route `actualArrivalAt`.
- **TBR** is schedule-management `scheduleTbrArrivalAt`.
- **usedArrival** is the earliest valid KIT or TBR. KIT wins an exact tie.
- `scheduleKitArrivalAt` is metadata only. It is never queue-admission,
  freshness, business-day, or fallback-KIT authority.
- **Route state 1** is observed unloading.
- **Route state 2** is unloading-completion authority.
- Schedule S and E are timing evidence; Schedule E is never lifecycle
  completion authority.
- Prediction is not evidence.

## 1. Inbound admission

- Destination (`ปลายทาง`) and Drop (`จุดดรอป`) may enter the inbound queue.
- Origin (`ต้นทาง`) must never enter the inbound queue. Origin remains a
  separate workflow.
- Destination and Drop may be admitted by valid TBR before Route KIT exists,
  without fabricating `actualArrivalAt`.

## 2. KIT and TBR truth

- The operational clock is `usedArrival`.
- Matching and deduplication must preserve proof and attendance identity.
- An exact KIT/TBR timestamp tie resolves to KIT.
- A late KIT or TBR may enrich current truth but must not silently rewrite what
  was knowable in an earlier point-in-time view.

## 3. Missing TBR

- Missing TBR means `MISSING_UNCONFIRMED`, not “TBR does not exist.”
- KIT must never be copied into the TBR field.
- A KIT-only record may operate when lifecycle evidence is sufficient, while
  required TBR enrichment remains unresolved.
- UI, API, history, and Supervisor projections must preserve field-level
  evidence and provenance.

## 4. Lifecycle and completeness are independent

- A record may be complete, released, or expired while required enrichment is
  still unresolved.
- Such a record must remain eligible for `ENRICHMENT_PENDING` work.
- Lifecycle completion must not terminate required enrichment.

## 5. Shared enrichment

Required missing enrichment must be shared, batched, deduplicated,
incremental, missing-only, bounded, and rate-limited.

- P1: active operational records with unresolved enrichment.
- P2: complete, released, or expired records with unresolved enrichment.
- P3: bounded historical backfill.
- P1 has highest priority. P2 must continue making progress. P3 may consume
  bounded leftover capacity.
- Per-row calls, per-client scaling, uncontrolled retry, duplicate provider
  calls, and full-history scans every 12 seconds are forbidden.

## 6. Historical backfill

Backfill must bound HUBs, dates, records, and pages. It must have cooldowns,
resumable checkpoints, and provenance. Late enrichment must be recorded as
late evidence and must not be represented as though it was known at the
historical point in time.

## 7. History truth

Current enriched truth and point-in-time truth are separate products.
Historical reads must declare an `asOf` boundary and use only evidence accepted
at or before that boundary. Late/backfilled values require provenance.

## 8. Business day

- Destination and Drop use the day of earliest valid observed KIT/TBR.
- Origin uses Route `actualDepartureAt`.
- ETA and `scheduleKitArrivalAt` are never business-day authority.

## 9. Unloading start

The authoritative order is:

1. `scheduleUnloadingStartedAt`;
2. persisted effective unloading start;
3. first backend observation of `unloadingState=1`.

Arrival, KIT, TBR, and ETA must never substitute for unloading start.

## 10. Unloading completion

Route `unloadingState=2` is completion authority. Schedule E may supply
timing/display evidence only after Route completion is established.

## 11. Drop lifecycle

Route state 2 completes Drop unloading. Only Route `actualDepartureAt` releases
Drop. Schedule E or state 2 alone must not release it.

## 12. Twelve-hour expiry

- Applies to Waiting, Unloading, and Drop awaiting release.
- Expires when age is greater than or equal to 12 hours.
- Primary anchor is earliest valid KIT/TBR.
- When arrival is absent, only a proven unloading-start fallback is allowed.
- ETA is forbidden as an expiry anchor.
- Expiry must not erase or resolve an enrichment obligation.

## 13. Realtime and quota

- Visible UI evaluation target: approximately 4 seconds.
- Shared Route source target: approximately 3 seconds.
- Healthy BusTime target: approximately 12 seconds.
- Provider work is shared per HUB. Browser count, reconnects, Supervisor
  viewers, and Intelligence viewers must not multiply provider calls.
- Cross-isolate coordination must prevent duplicate provider flights.
- For the same HUB, 1, 10, and 100 readers must each produce one shared Route,
  BusTime, and PreEntry reader, not a reader per client.

## 14. TBR Intelligence

Intelligence is SHADOW / ADVISORY / DIAGNOSTIC / READ-ONLY only.

The following are hard constants:

```text
queueAuthority=false
providerAuthority=false
freshnessAuthority=false
completenessAuthority=false
lifecycleAuthority=false
historyAuthority=false
businessDayAuthority=false
extraMsPolling=0
tursoWrites=0
otherPersistentWrites=0
```

Intelligence failure must not affect operational truth.

## 15. HBI and PNO

- HBI is click-only and on-demand.
- PNO is on-demand.
- Both must reuse shared cache/in-flight work and must not join background
  polling without an explicit future contract change.

## 16. Exact DEV runtime

- Authoritative builder target:
  `.github/dev-tools/build-exact-dev-runtime.mjs`.
- Expected deploy artifact:
  `worker/.dev-runtime/src/turso-index.js`.
- Final tests must execute against the exact artifact that will be deployed.
- Testing canonical source while deploying a separately patched/staged source
  is insufficient unless the exact artifact is independently verified.

## 17. Completeness and field evidence

Aggregate completeness states are:

```text
DATA_COMPLETE
DATA_INCOMPLETE
DATA_UNKNOWN
SOURCE_UNAVAILABLE
```

Field evidence states are:

```text
OBSERVED
MISSING_UNCONFIRMED
UNKNOWN
SOURCE_UNAVAILABLE
NOT_APPLICABLE
```

Origin inbound-only fields may be `NOT_APPLICABLE`. Every non-obvious state
must carry provenance.

## 18. Freshness

Canonical freshness states are `FRESH`, `STALE`, `SOURCE_UNAVAILABLE`,
`UNKNOWN`, and `ON_DEMAND`.

At minimum, source telemetry must keep separate values for:

```text
lastAttemptAt
lastSuccessAt
lastMeaningfulObservationAt
lastErrorAt
dataObservedAt
sourceValueTimestamp
acceptedDataAt
```

Data existing in cache does not prove source freshness. A successful request
with no new match/event may still be `FRESH` while the field evidence is
`MISSING_UNCONFIRMED`. HTTP 401/403 or an expired session maps to
`SOURCE_UNAVAILABLE` and `AUTH_REQUIRED`. HBI and PNO are `ON_DEMAND`.

The stale threshold is 20 minutes:

- below threshold: `FRESH`;
- exactly threshold: `FRESH`;
- one millisecond above threshold: `STALE`.

## 19. Supervisor

- Path: `/supervisor.html`.
- Admin-only, Thai by default, English supported.
- Read-only projection of canonical freshness, completeness, lifecycle,
  P1/P2/P3 telemetry, and source health.
- Route, PreEntry, BusTime/TBR, and HBI appear in the source matrix.
- Cause, impact, and recommendation are generic; HUB-specific repair logic is
  forbidden.
- Additional provider polls, healthy-state database writes, and per-client
  upstream scaling are all zero.
- Bot V1 observes and diagnoses only; it performs no automatic repair.
- A source authentication failure in one HUB, including the known EA2
  condition, must become generic `SOURCE_UNAVAILABLE` / `AUTH_REQUIRED` and
  must not affect other HUBs.

## 20. Required regression coverage

Recovery tests must protect against missing TBR display/update, HAR upload not
refreshing TBR, missing unloading-start display, slow or stuck lifecycle,
12-hour boundary errors, card/list count mismatch, stale/auth source handling,
and multi-client amplification.

Every final gate must exercise the exact DEV artifact and prove Turso runtime,
zero D1 bindings, Production untouched, and no merge to `main`.
