# WTR-D1-HYBRID-001 — Sanitized pilot evidence / handoff

The text below preserves the original PR #129 checkpoint. For current sequencing and qualification, see the [WTR-012U reconciliation](WTR-012U-CONTINUITY.md).

Checkpoint recorded 2026-11-25 (Asia/Bangkok). This is a Main Brain documentation record of Owner-run private-host logs and earlier read-only provider observations, not a new independent replay or release approval. Raw databases, SQL, WAL, credentials, signed URLs, individual records and private paths are intentionally excluded from this public repository. Owner retains original artifacts privately; hashes for those artifacts have not been independently obtained in this documentation task.

## Source and boundaries

- Repository DEV source observed at `381126281e6b3e0d6c4c38bd0699e941addceb83`; main `39df260b214526c398e92e12444b5e144510812b`.
- [Draft storage PR #128](https://github.com/Flashdevnak/waiting-trucks-report/pull/128) head `635370f8bf02803912dc247f9ffc1bd632d505ac` remains open, unmerged. Its earlier external-export blocker is historical for the offline pilot only; a provider-confirmed source generation and durable migration boundary for live cutover are still NOT VERIFIED.
- [DEV CI run](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44948044758) completed successfully on DEV SHA above. Last reported DEV Worker version 651; this documentation task does not revalidate live traffic, change runtime configuration or authorize deployment.
- The pilot D1 is isolated; Turso remains the intended live/default backend. Existing D1 databases must not be touched. No binding, production data access, dual write, cutover, or deployment authorized.

## Evidence ledger (reported local runs and read-only observations)

| Check | Result | Scope / evidence limitation |
|---|---|---|
| Offline history JSON compression | PASS | 872,509 rows; original 1,024.080 MiB, compressed 524.486 MiB, potential JSON savings 499.595 MiB / 48.78%; lossless roundtrip reported PASS. Not actual runtime database savings. |
| Local normalized snapshot and SQLite replay | PASS | 30 tables / 1,246,862 rows; schema, integrity, history pointer parity reported PASS. |
| D1 import | PASS | 176/176 data files, schema and post phase; 15/15 parameter-bound large rows; resumable import recovered from HTTP 500/502. |
| Remote count / pointer | PASS | 30 tables, 1,246,862 rows; 70,438 history pointers, 0 invalid; prior read-only provider observation. |
| D1 size | Observed | 1,782,689,792 bytes after import; not compressed runtime size. |
| First full live comparison | PARTIAL ACCEPTANCE / FINAL GATE STOPPED | Owner log compared all 30 tables; final `REMOTE_BOOKMARK_CHANGED_NO_PASS`, checkpoint `PASS_STATUS=False`. Do not rewrite this outcome. Cause of bookmark change not proven. |
| D1 SQL export / offline restore | PASS | 1,457,811,231 bytes SQL export; restore integrity passed. |
| Offline exported value multiset | PASS | 30/30 tables; 1,246,862 source rows; 0 value mismatch tables, SHA-256 typed-row comparison. |
| Offline full rowid and value parity | 28/30 PASS | Export/restore differences in `hub_settings` (42) and `ms_routes` (962); values unchanged. |
| Targeted live D1 rowid and value parity | PASS | Both exceptional tables / 1,004 rows; target identity PASS, bookmark stability PASS. Supports export/restore rowid discrepancy, not a live mismatch. |
| API / asOf / concurrent writes / rollback / cost | NOT VERIFIED | Requires implementation and separately authorized runtime qualification. |
| DEV cutover / Production | NOT RUN / RELEASE HOLD | No change approved. |

**Disposition:** Main Brain accepted pilot data parity for proceeding to isolated adapter development based on composite evidence. This is not one single-bookmark all-table live proof, provider-certified live migration boundary, runtime qualification, or production approval. Keep original failed gate and all caveats. No synthetic result substitutes for private-host evidence.

## Next work and authority

Owner reports Codex PC is executing HYBRID-002 locally. No result or candidate SHA has been received at this checkpoint. See [HYBRID-002 work order](../WORK_ORDERS/WTR-D1-HYBRID-002.md). HYBRID-003 through 008 are proposed sequence only; do not start automatically.

Before a future cutover: resolve source generation/durable boundary, certify ordered catch-up and rollback, confirm actual compression savings, API/asOf and concurrent-write behavior, credential handling, performance/quota, current trusted release gates including unresolved I03 and builder RCA, and request specific Owner approval.

## Publication state

This supplement is proposed in a docs-only Draft PR. Canonical registry/decision/next-task/handoff reconciliation remains pending: existing Draft PR #126 modifies overlapping registry and handoff files, and exact-base Python registry render/validate/unit tests were not executed in this chat environment. Do not mark the task registry synchronized, merge-ready, or substitute this supplement for the canonical release ledger. [Canonical Brain](../../PROJECT_BRAIN.md) remains authoritative.
