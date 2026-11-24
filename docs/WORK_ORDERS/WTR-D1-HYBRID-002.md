# WTR-D1-HYBRID-002 — Storage Adapter & Runtime Compatibility

Checkpoint: 2026-11-25. Owner reports local Codex implementation in progress. This records the Main Brain work order; it does not report implementation or new test results, and grants no authority beyond the Owner-approved scope.

## Execution

- Repository: Flashdevnak/waiting-trucks-report. Local Codex PC / WSL Ubuntu, isolated worktree. Preferred GPT-6.2 High; fallback GPT-6 High; no Astra/Astra Pro. Report actual available model/effort rather than assume.
- DEV branch `codex/dev-recovery-contract-v2`, expected SHA `381126281e6b3e0d6c4c38bd0699e941addceb83`. Main expected `39df260b214526c398e92e12444b5e144510812b`. Recheck all remote refs, CI, git status and claims before work; inspect changed base if moved.
- Read [canonical Brain](../../PROJECT_BRAIN.md), [AGENTS](../../AGENTS.md), [operational contract](../OPERATIONAL_CONTRACT.md), [pilot evidence](../EVIDENCE/WTR-D1-HYBRID-001.md), and [PR #128](https://github.com/Flashdevnak/waiting-trucks-report/pull/128). Preserve exact staged runtime and ordered patches. Existing WTR-011P/011R and other release gates remain independent.
- IMPLEMENTATION AND ISOLATED TEST ONLY. No commit, push, merge, workflow dispatch, deployment, live DB access, cutover, or production changes under this work order. Main Brain's separately approved docs-only publication is not Codex implementation approval.

## Objective and constraints

Map all DB access points (Route/KIT, PreEntry, BusTime/TBR, HBI, PNO, history, proof, settings, authentication, cache, audit); propose and implement a shared storage contract with Turso adapter preserving current semantics and a disabled D1 binding-based candidate adapter. No live D1 binding or automatic fallback/dual write. Turso remains default. Explicit opt-in only in isolated fixtures; no split-brain/stale-read behavior.

Preserve parameter binding, NULL, integer, REAL, text, blob, rowid/primary keys, pointers, indexes and transaction/batch semantics. Check official Turso/libSQL and D1 differences. Preserve API shape, business rules, exact-trip provenance, KIT/TBR earliest arrival (KIT wins tie), Route state 2 unloading completion, Schedule E timing only, actualDepartureAt drop release, queue expiry >=12h, read-only historical asOf, PNO Option B A-to-B lifecycle and QR/Excel functionality. Maintain existing shared coordinator/cache/dedupe/quota/rate limit: UI ~4s, Route ~3s, healthy BusTime ~12s, PNO passive 120s, cron 1m, freshness 20m, cooldown 5m. No new upstream polling, timers or retry loops. Check exact runtime contracts rather than reimplementing them from this summary.

Design for future lossless compression (codec/version/checksum/backward compatibility/D1 size constraints), without enabling compression or migrating a real schema. Offline JSON savings are not actual DB savings.

Use only synthetic/isolated fixtures for code tests. No real databases, SQL dumps, private provider payloads, cookies, credentials, raw HAR or sensitive records in Codex context, GitHub, CI or logs. The isolated D1 pilot and both existing D1 databases are protected; no access or modification. Keep trust checks I01–I04, exact builder/stager/origin composer, identity and golden hash unchanged. Do not execute/import an untrusted candidate before validation or bypass gates. I03 remains unresolved unless separately proven.

## Test and handoff

Node.js 22; actual version and exact commands required. Run original Turso regression, shared adapter contract, D1 isolated emulator tests, typed bindings, rowid/history pointer, historical asOf, batch/transaction semantics, concurrent writes/idempotency, partial failures, backend default/disabled gate, coordinator and no-added-polling, PNO lifecycle, builder/stager/origin, required workflow/identity/trust gates. Separate baseline failures from candidate regressions and synthetic from live proof.

Deliver local candidate patch, dependency map and compatibility matrix, actual test logs/counts, regression and risk/rollback report, draft Brain/decision update, handoff and proposed HYBRID-003 work order. Provide exact baseline/candidate identity and manifest; do not claim any run that did not occur. Report PASS/FAIL/NOT RUN/BLOCKED for Turso default, D1 disabled, existing contracts, adapter/regression/trusted gates. Live D1 runtime NOT VERIFIED; DEV cutover NOT RUN; Production RELEASE HOLD. Return to Main Brain for independent review; no automatic next work or publication.

## Proposed sequence (not authorization)

HYBRID-003 lossless compression; 004 API/asOf; 005 concurrent writes/catch-up; 006 performance/cost/rollback; 007 controlled DEV cutover (separate approval); 008 production release (HOLD). Do not confuse the sequence with existing release authority or allow it to bypass prior unresolved gates.
