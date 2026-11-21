# WTR-STORAGE-OPT-005 — Turso DEV export and lossless verification (DRAFT)

**Scope:** Manual-only GitHub Actions candidate. NO RUN, MERGE, DEPLOY, DB MUTATION, or Production change was approved.

- Repository: Flashdevnak/waiting-trucks-report
- Base: codex/dev-recovery-contract-v2 at 381126281e6b3e0d6c4c38bd0699e941addceb83
- Target database: waiting-trucks-dev-turso-20260902192750
- Active DEV runtime: Worker Version 651
- Production: RELEASE HOLD

## Proposed future flow (separate authorization required)

1. Manual dispatch only with exact reviewed DEV SHA, database name, and Owner consent phrase. No PR, push, or schedule triggers.
2. Download Turso CLI v1.0.34 from its official release and require SHA256 9eb67f3efece578a6407d1fa535a75e8d7b5cde4f6af3ac1dd79929e99768dc9.
3. Export a private .db and .db-wal to a GitHub-hosted ephemeral Runner. Existing GitHub Secret TURSO_PLATFORM_API_TOKEN is mapped to TURSO_API_TOKEN only inside the export step. No token creation. CLI logs are not printed.
4. Use SQLite backup API to integrate exported WAL into a private normalized working copy. Run VACUUM INTO on copy and measure bytes. Run integrity/foreign-key checks, stream every row of every user table through order-independent SHA256 aggregate equivalence, verify history pointer identities, and run limited asOf probe comparisons.
5. Print aggregate byte counts and booleans only. Cleanup Runner temporary files even on failure. No artifact, cache, raw rows, WAL, database files or token uploads.

## Critical acceptance limits

- NOT RUN: Draft PR is not permission to process private Turso data on GitHub-hosted compute. Separate Owner approval is required for dispatch and runner data handling.
- TRIGGER LIMITATION: GitHub workflow_dispatch generally requires workflow on the repository DEFAULT branch. This DEV-only Draft PR may remain undispatchable even after merging to DEV. Never merge to main or add automatic triggers as a workaround without new Owner approval.
- CREDENTIAL LIMITATION: Secret name exists in prior workflows, but validity and export authorization are not yet verified. Stop on missing/invalid credential; do not create substitutes.
- FORMAT LIMITATION: Only a SQLite-backed .db with matching non-empty .db-wal is supported. A tursodb .db-log is not a WAL; refuse it.
- ROWID LIMITATION: SQLite VACUUM can change rowids in tables lacking explicit INTEGER PRIMARY KEY. WTR ms_route_history has a TEXT PRIMARY KEY and ms_route_latest.history_rowid stores the SQLite rowid. Refuse pointer mismatches, do not rewrite them.
- CONTINUITY LIMITATION: A snapshot is one point in time. New writes after export, live asOf access, zero-downtime cutover, and rollback remain unverified.
- METRIC LIMITATION: Compacting an offline SQLite file does NOT reduce the Turso live quota. Verified live reduction remains 0 MB. Compare normalized working copy and compacted size separately from raw DB+WAL size.
- CLEANUP LIMITATION: Ephemeral deletion is best effort, not an assertion of cryptographic erasure.

## PR review

Review SHA, exact secret scope, CLI digest, no artifact upload, and safe output. This is a review-only candidate, not release authority.

**Result: Draft PR candidate only. Production RELEASE HOLD.**

## WTR-STORAGE-OPT-006 update

**BLOCKED before real export.** GitHub lists the existing repository Secret name and no configured self-hosted runner. The manual workflow file exists only on PR #128's branch, so the repository default branch prerequisite for `workflow_dispatch` is unsatisfied. Permission to process business data on GitHub-hosted compute was not established.

The official Turso CLI v1.0.34 release archive digest matches the existing pin. Its `DatabasesClient.Export` obtains a fresh one-hour database token by posting to the database's `auth/tokens` resource and requesting its default access, with read-only set to false. The current work order permits only the existing `TURSO_PLATFORM_API_TOKEN` and prohibits minting credentials. The workflow now checks the reviewed pilot commit and the separate live DEV SHA before stopping at a credential-free gate. The steps in the draft flow above describe its original design. No live export step is enabled by this update.

The offline verifier replays the exported WAL on a private copy, checks a committed WAL page against the normalized copy, and compares schema, all user-table values, physical history rowids, pointer targets, and sampled asOf SQL. Missing or empty pointer/asOf evidence fails closed. JSON text is compared byte-for-byte. Runtime API behavior and continuity for writes after export must be verified separately. A successful offline run would report the space recovered by `VACUUM INTO` on the normalized copy. Turso billing is measured after an approved cutover.

### Cutover and rollback criteria

1. Obtain a consistent DEV snapshot and replay boundary through a provider-supported path that conforms to the credential and data-handling policy. Verify and retain the original privately. Exported WAL covers the export boundary only.
2. Build the compact copy and fail on any difference in schema, rows or history pointers. Rehearse the staged DEV read APIs with date filters and `asOf` against the original and the compact copy. JSON compression would require transparent decoding for every reader and compatible SQL JSON queries.
3. Before requesting cutover, prove a supported change stream or complete transactional change log from that boundary, with ordering, deletes, replay and reconciliation of every write. During switch, use a fenced writer handoff with buffered requests and serve reads from the old source until the target catches up. Verify that every accepted write is durable and reflected on the target before routing readers. Existing Worker, provider polling and the shared coordinator remain outside the pilot.
4. Keep the original authoritative until validation passes. For rollback after switching, restore routing only after every post-switch write has been replayed and reconciled on the original. Confirm history, API and provider metering after cutover. Retire the old copy only when the rollback window and data-retention approval allow it.

Sources: [Turso CLI v1.0.34 export and token path](https://github.com/tursodatabase/turso-cli/blob/v1.0.34/internal/turso/databases.go), [official release](https://github.com/tursodatabase/turso-cli/releases/tag/v1.0.34), [GitHub workflow dispatch requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
