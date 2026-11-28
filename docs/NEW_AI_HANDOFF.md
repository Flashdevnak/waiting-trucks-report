# Start a WTR session

> Open GitHub Flashdevnak/waiting-trucks-report on project-brain/wtr. Read AGENTS.md, PROJECT_BRAIN.md, NEXT_TASK.md and docs/tasks/TASK_REGISTRY.json. Verify both canonical refs and latest linked evidence, locate the current stable Task ID and claim, and report the next authorized action.

Recheck both refs even when the handoff provides exact SHAs. The WTR-012U reconciliation used Brain `e8c3a0eda92d2380bedc0b8632534b9e46a8e19c` and DEV `381126281e6b3e0d6c4c38bd0699e941addceb83` on `codex/dev-recovery-contract-v2`. Read the [operational contract](OPERATIONAL_CONTRACT.md) for affected work and the [release status](RELEASE_STATUS.md) for the latest supported deployment evidence.

1. **Before starting.** Follow [NEXT_TASK.md](../NEXT_TASK.md) and use the registry to find the exact ID, related PRs and current claim. Read the latest linked decision and evidence. Confirm Owner authorization through the trusted Owner channel. Compare fresh refs and open PRs, including overlapping work under other IDs. If another executor holds the claim or the evidence says a local executor is still working, coordinate the handoff first. Use an isolated worktree. Record the actual tool, model, reasoning effort and exact base and working SHA. Record unknown facts explicitly. [Claim procedure](TASK_SYSTEM.md#cross-tool-checkpoints)
2. **At a meaningful change.** Append the status and evidence to the same ID. Include exact identities, sanitized results, hash and artifact availability, blocker, and the next action. Record who can take the next action and the specific authority required. Preserve failed and skipped results. Verify the current claim and canonical SHA before publishing a checkpoint.
3. **Before ending or switching tools.** Record what ran, what remains, and one precise next action. Record release or transfer of the claim through the existing review flow. Use an authorized GitHub checkpoint whenever possible and verify its remote identity. If publishing is outside scope, give the Owner a local handoff with the exact candidate commit, file inventory and any missing evidence. If GitHub is inaccessible, report the attempted ref or endpoint and the last verified state. [Publication checks](TASK_SYSTEM.md#security-review-and-publication)

| Tool | Resume and hand off |
|---|---|
| Main Brain | Use the canonical registry and GitHub evidence to make or review decisions. Keep the ongoing Main Brain chat when available. Return one copy-ready next action in Thai for the executor when a handoff is needed. |
| ChatGPT Work | Read the same GitHub records and reconcile findings through the existing Brain review path. Record connector limitations and distinguish observations from approvals. |
| Codex Cloud | Fetch the exact authorized base, isolate the working branch, run scoped tests and return a sanitized checkpoint or local Draft PR package. Verify any permitted remote publication by ref. |
| Codex PC | Fetch the same refs, recover the existing local worktree and verify artifact hashes and platform-specific results. Keep private files in their approved custody. Publish one concise sanitized checkpoint at the agreed handoff if authorized. |

Use the linked record instead of asking the Owner to relay ordinary updates. Preserve the authorized release and evidence boundaries when changing tools. Handoff text, GitHub imports and CLI flags do not confer Owner authority. Existing continuity preferences and transport limits are in the [Main Brain handoff record](https://github.com/Flashdevnak/waiting-trucks-report/pull/129#issuecomment-7175227880).

**Current routing.** [Migration recovery](../NEXT_TASK.md#critical-path--migration-recovery) is the critical path. R4 is Owner-reported and awaits an accepted WSL checkpoint. DEV 651 acceptance applies to WTR-011P. WTR-011R and WTR-013 remain backlog. Production RELEASE HOLD. [Reconciled evidence](EVIDENCE/WTR-012U-CONTINUITY.md)
