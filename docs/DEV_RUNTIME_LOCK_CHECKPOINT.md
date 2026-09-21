# DEV Runtime Lock Checkpoint

Checkpoint: REC-00 — Remote baseline, safety, and recovery contract

Assessment date: 2026-09-21

Status while this document is committed: pending remote-backup verification

Scope: DEV only

## Baseline lock

| Item | Locked value |
| --- | --- |
| Repository | `Flashdevnak/waiting-trucks-report` |
| Expected remote `main` | `3591527c1c3bc25a1731f46a82529d684e25be05` |
| Observed remote `main` | `3591527c1c3bc25a1731f46a82529d684e25be05` |
| Base commit message | `docs(dev): record recovery deployment status` |
| Recovery branch | `codex/dev-recovery-contract-v2` |
| Old local CP-00…CP-14 history | unrecoverable; not claimed or reconstructed |
| Production | locked and untouched |
| `main` merge | forbidden |

The remote branch did not exist before REC-00. It was created locally from the
exact remote `main` commit above. REC-00 is PASS only after its commit is pushed
and the remote branch SHA is verified equal to local HEAD.

## Repository bootstrap evidence

- The baseline contains 379 tracked files.
- No repository `AGENTS.md` exists at the locked commit.
- Canonical backend source is `worker/src/index.js`.
- DEV entrypoint is `worker/src/turso-index.js`.
- DEV configuration is `worker/wrangler.dev.jsonc`.
- The current DEV workflow is `.github/workflows/deploy-worker-dev.yml`.
- Current staging is assembled by
  `.github/dev-tools/stage-dev-runtime.mjs` plus an ordered patch chain.
- The required authoritative exact builder
  `.github/dev-tools/build-exact-dev-runtime.mjs` does not exist.
- The current repository has extensive tests under `worker/tests/`,
  `.github/dev-tools/`, `.github/tests/`, and
  `cloudflare-browser-test/scripts/`.

## Workflow safety result

Pushing `codex/dev-recovery-contract-v2` with only the REC-00 documentation
changes does not trigger a Production workflow:

- deployment and operational push workflows are restricted to `main`, except
  `branch-ms-lower-card-truth-v1.yml`, which is restricted to its own named
  branch;
- five `one-shot-quota-guard-hotfix*.yml` workflows accept pushes from any
  branch, but each has a single marker-file path filter under
  `.github/dev-tools/`; REC-00 changes only `docs/**`;
- `deploy-worker-dev.yml` deploys only `waiting-trucks-report-api-dev`, is
  restricted to `main`, and uses `worker/wrangler.dev.jsonc`;
- `coordinated-turso-cutover.yml`, the production example config, and
  Production read-only workflows are restricted to `main` or manual dispatch
  and are not invoked by this recovery branch push.

Future checkpoints must repeat a focused trigger/path check for their exact
diff before every push. No workflow may be manually dispatched during early
recovery.

## Current runtime lock

`worker/wrangler.dev.jsonc` currently declares:

- Worker name `waiting-trucks-report-api-dev`;
- entrypoint `src/turso-index.js`;
- `DB_BACKEND=turso`;
- `workers_dev=true`;
- one-minute cron;
- per-HUB `MS_REFRESH_COORDINATOR` Durable Object;
- no `d1_databases` section.

Therefore the configured DEV D1 binding count is zero. This is configuration
evidence only; active deployment binding verification remains a later exact
runtime/deploy gate.

The current deploy workflow copies canonical source into `.dev-runtime`, then
mutates the copy through staging patches and deploys
`.dev-runtime/src/turso-index.js`. It tests many staged functions, but there is
no single authoritative builder and no final, repository-level test command
that constructs and tests the exact deploy artifact as one immutable target.

## Recovery gap matrix

Status meanings:

- **PRESENT**: locked remote baseline has executable implementation and direct
  regression evidence.
- **PARTIAL**: useful implementation exists but one or more required semantics
  or final-artifact proofs are absent.
- **MISSING**: no implementation/test evidence for the required contract.
- **CONFLICTING**: baseline behavior or tests contradict the recovery contract.

| Contract | Status | Baseline evidence and gap |
| --- | --- | --- |
| Inbound admission | PRESENT | `.github/tests/ms-queue-first-source-v1.test.mjs` proves Destination/Drop TBR-first admission and Origin exclusion in the staged DEV runtime. |
| KIT/TBR authority and tie | PRESENT | The queue-first test and `.github/dev-tools/ms-drop-lifecycle.test.mjs` prove Route `actualArrivalAt`, schedule TBR, earliest timestamp, KIT tie, and no schedule-KIT authority. |
| Missing TBR semantics | MISSING | No `MISSING_UNCONFIRMED` field state or required-enrichment state exists; UI/API generally use a blank/dash. KIT is not copied to TBR, but missing evidence is not modeled. |
| Lifecycle independent from completeness | MISSING | No `ENRICHMENT_PENDING` or aggregate completeness state exists. |
| P1/P2/P3 enrichment | CONFLICTING | `bus-time-hot-lane-v14.test.mjs` proves active shared work, but also explicitly expects completed-only Route state to make zero BusTime calls; required P2 progress is absent. |
| Historical backfill | MISSING | Bounded history reads exist, but no bounded/resumable missing-enrichment P3 backfill, checkpoint, or late-evidence provenance exists. |
| Point-in-time history | PARTIAL | `msDailyArchive` has `historyCutoff`, `historyMode: POINT_IN_TIME`, and `asOf`; late enrichment provenance and current-vs-historical completeness are not modeled. |
| Business-day authority | CONFLICTING | `worker/src/index.js` daily-history SQL chooses `estimatedDepartureAt`/`estimatedArrivalAt` before actual values and does not use earliest KIT/TBR. This directly conflicts with the contract. |
| Unloading start | PRESENT | `ms-unloading-start-truth-v2.test.mjs` proves Schedule S, persisted effective start, first state-1 observation, and provenance-safe display/fallback. |
| Unloading completion | PRESENT | Route state 2 is authoritative; Schedule E is timing-only after Route completion. Covered by `ms-unloading-start-truth-v2.test.mjs`, `ms-drop-lifecycle.test.mjs`, and sync-policy tests. |
| Drop release | PRESENT | `ms-drop-lifecycle.test.mjs` proves state 2 completes unload while only `actualDepartureAt` releases Drop. |
| Twelve-hour expiry | PARTIAL | `patch-ms-operational-expiry-anchor-v2.mjs` and focused tests prove exact `>=12h`, earliest arrival, unloading-start fallback, no ETA, and Drop departure finality. Expiry does not yet preserve a modeled enrichment obligation. |
| Realtime cadence | PRESENT | Staged tests prove ~4s UI, ~3s shared Route, ~12s healthy BusTime, per-HUB Durable Object coordination, and no direct 4s client HTTP polling. |
| TBR Intelligence isolation | CONFLICTING | Existing policies prove `extraMsPolling=0`, `tursoWrites=0`, and `queueAuthority=false`, but other authority flags are absent and `tbr-intelligence.js` writes Intelligence state to KV via `STATE.put`, conflicting with `otherPersistentWrites=0`. |
| HBI / PNO on-demand | PRESENT | Worker tests prove HBI click-only and PNO lazy/click-only with shared cache/in-flight work and no 4s polling. |
| Exact DEV runtime builder | MISSING | Required `build-exact-dev-runtime.mjs` is absent. Current workflow performs shell copy plus patch staging and then deploys a different tree from canonical source. |
| Aggregate completeness | MISSING | `DATA_COMPLETE`, `DATA_INCOMPLETE`, `DATA_UNKNOWN`, and `SOURCE_UNAVAILABLE` are not implemented as a canonical aggregate. |
| Field evidence/provenance | MISSING | `OBSERVED`, `MISSING_UNCONFIRMED`, `UNKNOWN`, `SOURCE_UNAVAILABLE`, and `NOT_APPLICABLE` are not a canonical field-level contract. |
| Source freshness | PARTIAL | Supervisor has the correct 20-minute `>` boundary and HBI `ON_DEMAND`, plus generic `AUTH_REQUIRED`; telemetry is mainly `lastSuccessAt` and lacks the full timestamp set and canonical `SOURCE_UNAVAILABLE` evidence. |
| Supervisor projection | PARTIAL | Admin guard, Thai/English, one-shot shared snapshot, lifecycle, freshness, quota telemetry, generic guidance, and observe-only behavior are tested. Completeness and P1/P2/P3 telemetry are absent. |
| EA2/source isolation | PARTIAL | Generic auth-required handling and per-HUB state exist; canonical `SOURCE_UNAVAILABLE` plus complete field evidence and explicit other-HUB isolation coverage remain incomplete. |
| Multi-client reader matrix | PARTIAL | BusTime has a 100-client coalescing test; Route has per-HUB Durable Object and cross-isolate claim tests. The exact 1/10/100 Route+BusTime+PreEntry matrix, reconnect-burst test, and viewer-isolation matrix are not all present. |
| Symptom regression coverage | PARTIAL | TBR-first, HAR recovery, unloading-start, lifecycle, expiry, summary/list parity, and auth tests exist. Missing-TBR evidence/completeness and full exact-artifact coverage remain absent. |

## Baseline test evidence

All tests below ran against a byte-for-byte read-only materialization of remote
commit `3591527c1c3bc25a1731f46a82529d684e25be05`:

1. `cd worker && npm run check` — PASS. The command completed all configured
   syntax and regression groups, including 142 core Worker/Supervisor tests,
   25 BusTime tests, 17 unloading/drop tests, and the staged runtime suite.
2. Focused recovery suite covering queue-first, lifecycle, 12-hour expiry,
   history, Durable Object coordination, cross-isolate dedupe, Supervisor, and
   realtime — PASS, 79/79.
3. `cloudflare-browser-test` Intelligence pipeline — FAIL before dry-run at
   `scripts/tbr-intelligence.test.mjs:161`: a fixed 2026-09-07 sample produced
   `rolling14.candidates=0` while the test expected 1 on 2026-09-21. This is a
   date-dependent/non-deterministic baseline test and is not recorded as PASS.

The Intelligence failure does not affect operational runtime truth during
REC-00. It must be addressed in the Supervisor/Intelligence recovery group,
without granting Intelligence authority or persistent writes.

## Recovery checkpoints

The smallest safe grouping from this baseline is:

1. **REC-01 — Core operational truth:** close lifecycle-adjacent gaps, preserve
   the already-present KIT/TBR, unloading, Drop, and expiry behavior, and add
   missing/completeness regression scaffolding without altering provider work.
2. **REC-02 — Completeness and enrichment:** implement field evidence,
   aggregate completeness, `ENRICHMENT_PENDING`, shared missing-only P1/P2
   work, and provenance.
3. **REC-03 — Bounded backfill and quota:** implement P3 checkpointed backfill,
   explicit P1/P2/P3 telemetry, exact 1/10/100 reader matrix, reconnect and
   cross-isolate quota tests.
4. **REC-04 — History, business day, and freshness:** fix the conflicting
   business-day SQL/logic, preserve point-in-time truth, add late-evidence
   provenance, and complete canonical freshness timestamps/states.
5. **REC-05 — Supervisor and Intelligence isolation:** project completeness and
   priorities, remove Intelligence persistence/implicit authorities, make its
   tests deterministic, and prove viewer isolation.
6. **REC-06 — Exact runtime:** add the authoritative builder, create the exact
   artifact, run all contract suites against that artifact, hash it, and prove
   workflow/Production safety and D1=0.
7. **REC-07 — Full local gate and DEV deployment preparation:** run the full
   exact-artifact gate, verify a clean/pushed remote checkpoint, and prepare
   REC-08 deployment without dispatching it.

REC-08 and live CP-15 through CP-17 are intentionally outside REC-00. No
deployment is authorized by this checkpoint.

## REC-00 exit criteria

REC-00 may be marked PASS only when:

- both contract/checkpoint documents are committed;
- local status is clean;
- `codex/dev-recovery-contract-v2` is pushed without force;
- remote branch SHA exactly equals local HEAD;
- Production remains untouched and `main` remains unmerged.

If push or SHA verification fails, REC-00 is PARTIAL and REC-01 must not begin.
