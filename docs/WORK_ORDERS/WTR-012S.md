# WTR-012S — Permanent Project Brain Security Hardening

Owner work order authorizes a focused hardening patch, tests, Push to an isolated branch and a Draft PR against `project-brain/wtr`. The starting Brain commit is `d5c131a22f120bd7e82effef453f33f06c372de8`. Review and merge require a separate decision. Release and runtime evidence remain under their existing tasks.

## Review scope

- Confirm the WTR-012 publication diff and history were screened for exposed credentials and private evidence. Use sanitized outcomes rather than reproducing matches.
- Verify allowlisted import metadata, filtering of unsafe text, strict JSON, safe destinations, evidence links and append-only baseline validation.
- Verify cold lookup, resume and reopen paths. The original 160 entries are preserved; this work order adds one entry.
- Verify the branch trigger and compare the diff to the stated Brain base. Preserve DEV, Production, runtime code and the four-input release contract.

## GitHub controls for the Owner

Direct inspection of classic protection via the available integration returned HTTP 403. The readable Rulesets list and protected-branch listing were empty. **Effective branch protection: NOT VERIFIED.** [Repository Rulesets](https://github.com/Flashdevnak/waiting-trucks-report/settings/rules) · [Branch settings](https://github.com/Flashdevnak/waiting-trucks-report/settings/branches)

1. Under **Settings → Rules → Rulesets**, verify the rules matching exactly `project-brain/wtr`, including inherited rules and bypass actors. Confirm classic protection under **Settings → Branches**.
2. For the Brain ref, review an active ruleset blocking force pushes/deletion, requiring a PR, fresh review after new commits, and an independent reviewer. Limit bypasses and write access to the needed maintainer role. Review before merging any settings proposal.
3. Require the focused Brain validator and tests as a status check after the Owner approves provisioning a credential-free check, establishes its exact name and verifies it on the intended base. This patch adds no workflow. Avoid privileged `pull_request_target` or equivalent runners executing PR-supplied code. If using a scanner, share no provider secrets and give the runner only required permissions.
4. Prefer read-only GitHub App access for AI readers. Scope writer credentials to this repository with the minimum Contents / Pull requests permissions for the approved task. Review collaborator roles, app installation scope, ruleset bypass and any write-enabled tokens independently.

[GitHub ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) · [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)

After security review, resume WTR-011R from the registry and the existing qualification evidence. Plan how to prove exact trip occurrence and prior TBR-only admission with read-only evidence. WTR-011P credential and release decisions remain in their existing record. Production RELEASE HOLD.

## Candidate verification

- Historical screening covered the 22-file bootstrap and later 41-file WTR-012 snapshot, including both commit messages. No confirmed exposed credential was found; matching examples were synthetic fixtures. Pattern screening cannot prove the absence of all private data.
- All 20 focused offline tests passed. The pre-publication baseline check passed with the existing 160 records identical and one new review record. Operational Contract, Release Status, Decision Log and Next Task match the base.
- Repository workflow scan found no matching automatic trigger for the planned Push or Draft PR. The separate Cloudflare Browser-Test integration can upload a preview version for the branch. DEV and Production release workflows are outside this work order.
