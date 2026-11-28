# Waiting Trucks Report

[New AI handoff](docs/NEW_AI_HANDOFF.md) · [Find a task](docs/tasks/TASK_INDEX.md) · [Machine-readable registry](docs/tasks/TASK_REGISTRY.json) · [Next task](NEXT_TASK.md) · [Release status](docs/RELEASE_STATUS.md) · [Decision log](DECISION_LOG.md)

The registry on `project-brain/wtr` is the canonical task state. Markdown views are generated from it. [Task system](docs/TASK_SYSTEM.md) explains how to claim and publish a checkpoint. [Evidence index](docs/EVIDENCE_INDEX.md) separates GitHub records, reported local results and missing history. The [previous Brain snapshot](https://github.com/Flashdevnak/waiting-trucks-report/tree/52f2859d5688ba35583ef9e5d56117b7745dff9f/docs/project-brain) is retained as evidence. Dates and statuses in that snapshot describe its own capture window.

[Architecture](docs/ARCHITECTURE.md) · [Operational contract](docs/OPERATIONAL_CONTRACT.md) · [System baseline](docs/SYSTEM_BASELINE.md) · [WTR-012 master work order](docs/WORK_ORDERS/WTR-012-MASTER.md)

The DEV release source remains `codex/dev-recovery-contract-v2`. Obtain the latest refs from GitHub in each session.

## Current work

[Migration recovery](NEXT_TASK.md#critical-path--migration-recovery) is the current critical path. The latest executor-reported R4Q checkpoint is blocked at INTERLOCK_RECOVERY_REQUIRED. ChatGPT Work prepares incident containment and fixture correction. Codex PC holds without retry. Keep Slot 71 and Full B2 gated, I03 open, and Builder RCA unknown. [Reconciled evidence](docs/EVIDENCE/WTR-012U-CONTINUITY.md) · [Pilot evidence](docs/EVIDENCE/WTR-D1-HYBRID-001.md) · [Adapter work order](docs/WORK_ORDERS/WTR-D1-HYBRID-002.md)

Main Brain, ChatGPT Work, Codex Cloud and Codex PC use the same task IDs, evidence and claim records. Start from the [cross-tool handoff](docs/NEW_AI_HANDOFF.md) on each new session. DEV Version 651 is the last supported acceptance checkpoint. Turso remains the default and D1 bindings are zero. Production RELEASE HOLD.
