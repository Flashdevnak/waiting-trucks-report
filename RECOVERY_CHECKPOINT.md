# DEV Recovery Checkpoint

## Safety boundary

- DEV only.
- Do not deploy, migrate, edit secrets, or write data in Production.
- Preserve the current UI unless a verified data-truth defect requires a UI correction.
- Do not fabricate missing historical evidence.

## Recovery base

- Initial base commit: `22ece8665266211d4e88688bb0c073745bdd5e6c`
- Initial branch: `main`
- Initial worktree: clean
- Live DEV asset was verified byte-for-byte against the staged runtime produced from the base commit before recovery began.

## Canonical operational contract

1. Only Destination and Drop participate in the inbound queue.
2. Queue arrival is the earliest valid Route KIT (`actualArrivalAt`) or TBR (`scheduleTbrArrivalAt`); KIT wins an exact tie.
3. Route `unloadingState=1` is unloading. Schedule S is a permitted start-time fallback.
4. Schedule E is timing/display evidence only. It must not advance or complete lifecycle by itself.
5. Destination completes lifecycle when Route reports `unloadingState=2`.
6. Drop remains active until Route provides `actualDepartureAt`.
7. Waiting, unloading, and Drop-awaiting-release leave the active operational queue at the exact 12-hour cutoff without fabricating completion or departure.
8. Visible live refresh remains approximately four seconds through the shared coordinator; client count must not scale upstream reads.
9. Upper metrics, lower cards, filters, Supervisor telemetry, and exports must use the same lifecycle predicates.
10. Historical claims must identify their evidence boundary. Missing PNO membership or transient TBR evidence must be reported as unavailable, never reconstructed as fact.

## Completed recovery slices

- Recovery slice 1: make `queueInfo` use Route-owned completion truth, matching the existing operational-stage predicate. Schedule E no longer completes Destination or moves Drop to awaiting-release by itself.
- Recovery slice 2: run the staged Drop/KIT/TBR queue-lifecycle regression as part of the standard `npm run check`, not only inside the deploy workflow.
- Recovery slice 3: bound daily-history snapshots, cancellations, and completion verification to the selected range cutoff so future snapshots cannot rewrite an earlier report.

## Next safe slices

1. Expand the executable lifecycle contract to cover exact 12-hour expiry, summary/list parity, and Supervisor parity against the final staged runtime.
2. Persist sufficient audit provenance for future transient TBR and PNO evidence; do not rewrite old history.
3. Consolidate verified staged rules into canonical source in bounded commits while keeping staged output byte-behavior stable.
4. Verify locally, deploy DEV only, then collect live traces before continuing.

## Resume procedure

1. Read this file.
2. Run `git status --short --branch` and `git log -5 --oneline`.
3. Run the focused tests named in the latest commit/checkpoint.
4. Continue only from the first unfinished recovery slice; do not reapply completed patches.
