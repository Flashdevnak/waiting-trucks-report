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
