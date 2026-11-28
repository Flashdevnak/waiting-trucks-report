# Next task

## Critical path — Migration recovery

[WTR-MIGRATION-RECOVERY](docs/tasks/TASK_INDEX.md#wtr-migration-recovery) is the current priority. The latest checkpoint is [WTR-MIGRATION-RECOVERY-006R4Q](docs/tasks/TASK_INDEX.md#wtr-migration-recovery-006r4q), **BLOCKED at INTERLOCK_RECOVERY_REQUIRED**. The executor reports Linux kernel fixture results of 3 PASS, 3 FAIL and 1 ERROR, and confirms a protected-state incident. The renewal lock pending marker was preserved, ledger counts are 4 / 2 / 2, and the privilege boundary is UNQUALIFIED. Focused Slot 71 NOT_RUN, Full B2 BLOCKED, I03 OPEN, Builder RCA UNKNOWN. [R4Q evidence](docs/EVIDENCE/WTR-012U-CONTINUITY.md#recovery-006r4q)

1. **ChatGPT Work** — Prepare Incident Containment & Fixture Correction and submit the scoped plan and fixture for independent review.
2. **Codex PC** — HOLD / NO RETRY. Preserve the marker, ledger and existing work.
3. **Codex Cloud** — Isolated Linux qualification only after independent review of the corrected fixture and explicit Owner authorization. Protected-state recovery requires its own independent review and Owner authorization.

Raw JSON remains the migration default. Preserve read performance and 100% of data. DEV last verified at Version 651, Turso default, D1 bindings zero. HYBRID-007 DEV cutover remains gated. HYBRID-008 and **Production remain on RELEASE HOLD**.

## Backlog and maintenance

1. [WTR-011R](docs/tasks/TASK_INDEX.md#wtr-011r) — Feature backlog. B1 requires authoritative exact occurrence and B2 requires recoverable prior admission. Keep the preservation review and evidence. Wait for new evidence and Owner prioritization.
2. [WTR-012 history maintenance](docs/tasks/RECOVERY_GAPS.md) — Attach verifiable original Work Orders and evidence to existing IDs when they become available.
3. [WTR-013](docs/tasks/TASK_INDEX.md#wtr-013) — Last in the feature and repair backlog. Resume on separate Owner prioritization. Incident evidence remains private. [Issue #125](https://github.com/Flashdevnak/waiting-trucks-report/issues/125)

Check [active claims](docs/tasks/ACTIVE_TASKS.md) and the [registry](docs/tasks/TASK_REGISTRY.json) before taking work.
