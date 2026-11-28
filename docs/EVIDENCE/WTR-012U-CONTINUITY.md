# WTR-012U continuity reconciliation

## Exact source and overlapping drafts

Reviewed GitHub Brain `e8c3a0eda92d2380bedc0b8632534b9e46a8e19c`, DEV `381126281e6b3e0d6c4c38bd0699e941addceb83`, and the following evidence on 2026-11-28 (Asia/Bangkok).

| Source | Supported disposition |
|---|---|
| [PR #124](https://github.com/Flashdevnak/waiting-trucks-report/pull/124) | Closed and merged into Brain at `e8c3a0eda92d2380bedc0b8632534b9e46a8e19c`. Exact reviewed head `133f3c54258a9e4a40032c11268a62048db44054`. Historical Owner merge approval scoped to #124; no independent GitHub approval was recorded. |
| [PR #126](https://github.com/Flashdevnak/waiting-trucks-report/pull/126) | Open Draft at `499d18ad94f3c321f30b894a261195ec46bcd0d8`, based on canonical Brain. Twelve changed files. Reconciled Gate B evidence, WTR-012S merge metadata and WTR-013 issue link. WTR-011R stays in backlog with blockers because B1/B2 and the business-policy acceptance are unresolved. |
| [PR #127 acceptance](https://github.com/Flashdevnak/waiting-trucks-report/pull/127#issuecomment-7069135491) | Closed and merged to DEV at the observed DEV SHA. Version 651, 100% traffic, Turso and zero D1 bindings verified by Main Brain at the checkpoint. Public workflow smoke passed. Work reported desktop and mobile visual smoke. |
| [PR #128](https://github.com/Flashdevnak/waiting-trucks-report/pull/128) | Open Draft at `635370f8bf02803912dc247f9ffc1bd632d505ac`, target DEV. Three added files, including disabled workflow and verifier. Preserve 005–007 evidence and the separate provider-certified snapshot boundary blocker. |
| [PR #129](https://github.com/Flashdevnak/waiting-trucks-report/pull/129) | Open Draft at `b33ffc0c5c653e16d7bf844bb7995d05335bd549`, based on canonical Brain. Four Markdown files record composite pilot evidence and HYBRID-002. Later PR comments carry composition, qualification, storage and recovery checkpoints. |
| [Issue #125](https://github.com/Flashdevnak/waiting-trucks-report/issues/125) | Open WTR-013, last in feature and repair backlog. Intermittent degraded UI report, with private incident artifacts and no proven provider outage. |

The exact #126 and #129 changed-path sets have zero direct intersection. Both touch the same Brain state semantically. #126 proposes registry, decision, next-task and handoff changes based on November 22 evidence, while #129 changes discovery and evidence routing for the later Migration work. The unified candidate incorporates the bounded evidence from both and uses one registry and routing. The original Drafts remain open and unmodified. Review their overlap against a refreshed Brain if any is published first.

## HYBRID checkpoints

- **001–002T.** Composite isolated pilot data parity supported moving to isolated adapter work. The original bookmark failure and unverified durable migration boundary remain. Composition V3 reported 28/28/28 inventories and a composition-only PASS. Full B2 remained separate. [Pilot evidence](WTR-D1-HYBRID-001.md) · [Adapter work order](../WORK_ORDERS/WTR-D1-HYBRID-002.md) · [Composition result](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7180785273)
- **003–005.** Lossless codec, SQLite/API/asOf, and ordered catch-up were accepted as reported for synthetic scope. Preserve source-linked results, pointer and API parity, replay and recovery. [003](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7226993728) · [004](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7227102224) · [005](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7227229696)
- **006–006B.** Synthetic parity and local rollback evidence retained. Compression regressed modeled read latency and fixture-dependent results cannot establish production savings. Raw JSON selected as migration default. Further compression/dedup tuning deferred. [006 performance disposition](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7227427866) · [006A](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7227573442) · [006B raw-first decision](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7227685740)
- **007–008.** No DEV cutover or Production release authorized. Require source boundary, original acceptance predicates, read performance non-regression and 100% data preservation. Retain I01–I04, I03 OPEN, Builder RCA UNKNOWN, Turso default and disabled D1. [Scope and gates](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7226865872)

## Migration recovery

The approved historical Stage DEV Full B2 retest failed after 70/84 captures, with 42/47 offline groups complete, 15/15 focused, SUP-12 PASS and 28/28/28 inventories. Slot 71 started and aborted in **that run**, with 13 subsequent slots NOT_RUN. The exact supervisor exit cause remains unknown. Retain four historical Full B2 ledger records and both diagnostic histories. Latest focused execution remained **NOT_RUN**. [Historical retest](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7221763304)

| Checkpoint | Evidence and outcome |
|---|---|
| 001 | Bounded inert evidence collected. Main Brain completed a supported-route comparison. Ordinary CI or an emulator alone cannot substitute for Full B2. No duplicate assessment or another full-matrix diagnostic for evidence collection. [Evidence delta](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7226722246) · [Route assessment](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7226789297) |
| 002 | Exact focused scope preparation, execution NOT_RUN. [Checkpoint](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7228045062) |
| 003 | Local source draft and 5/5 inert tests reported, execution NOT_RUN. [Checkpoint and reported artifact hashes](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7228206539) |
| 004 | Local custody and authority draft, 5/5 additional inert tests reported, execution NOT_RUN. [Checkpoint and reported artifact hashes](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7228465235) |
| 005 | Read-only WSL custody preflight reported PASS. Focused authority issuance blocked, execution NOT_RUN. [Checkpoint](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7228738123) |
| 006 | Stopped first at Owner attestation, then at the expired time window. No focused reservation or workload. Ledger counts 4/2/2 retained. [Attestation](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7228864590) · [Window](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7240005182) |

### RECOVERY-006R4

This is the earlier checkpoint. See [R4Q](#recovery-006r4q) for the subsequent WSL outcome and current routing.

**Source is the Owner's WTR-012U execution brief. Acceptance is pending.** Owner reports local implementation complete. Windows 32 PASS and 7 Linux cases skipped. WSL qualification PENDING. Focused Slot 71 NOT_RUN, Full B2 BLOCKED, I03 OPEN. Owner-reported adapter SHA-256 `9aa36563ca5bcd13f7c7d53bea9398c39c26e3e6b249e109eca7c1aec91a5e7c`. Exact local Git SHAs, artifact bytes and tests were not inspected during this reconciliation. No R1–R3 checkpoint was available in the reviewed evidence. Preserve the current executor's work and wait for its independently accepted WSL checkpoint. Any protected execution requires separately reviewed exact scope and fresh Owner authorization.

### RECOVERY-006R4Q

**BLOCKED · First gate INTERLOCK_RECOVERY_REQUIRED.** The executor confirmed a protected-state incident in the report. One WSL2 kernel fixture run returned **3 PASS / 3 FAIL / 1 ERROR / 0 skipped**. The earliest failing kernel assertion was lock custody. The renewal lock pending marker was preserved and the ledger stayed **4 / 2 / 2**. The combined protected snapshot equality check failed. The effective privilege boundary remains **UNQUALIFIED**. The executor reports that the exact adapter hash matched the earlier R4 record. This Brain checkpoint records the reported run. Independent acceptance is pending. [Executor checkpoint](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7241029228)

Focused Slot 71 **NOT_RUN** · Full B2 **BLOCKED** · I03 **OPEN** · Builder RCA **UNKNOWN**. ChatGPT Work prepares Incident Containment & Fixture Correction for independent review. Codex PC is on HOLD with no retry. Codex Cloud may run only isolated Linux qualification after the corrected fixture has been reviewed and the Owner explicitly authorizes that run. Protected-state recovery requires separate review and authorization.

## Publication boundary

Repository workflow triggers and external Browser-Test Preview are distinct. Prior Draft #126 and #129 generated external previews despite documentation-only changes. No GitHub mutation or external CI or preview was started for WTR-012U. A read-only Cloudflare check for the final checkpoint found a Browser-Test Preview trigger that matches the proposed branch and changed paths. Account-specific remaining minutes and cost could not be confirmed. Candidate stays local under Production RELEASE HOLD. [#126 Preview](https://github.com/Flashdevnak/waiting-trucks-report/pull/126#issuecomment-7067763944) · [#129 Preview](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7142650521)

Publication of the updated candidate remains pending actual independent review and explicit Owner scope for one branch push and one Draft PR. Before approving the push, confirm that effective Cloudflare build controls exclude the branch or explicitly approve the possible Preview build and its account-specific quota and cost exposure. A docs-only diff or Draft PR does not establish a Cloudflare exclusion. [Workers build branch settings](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) · [Workers Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
