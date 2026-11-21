# Release status

| Subject | Last supported status |
|---|---|
| Production | **RELEASE HOLD**, Owner directive |
| DEV Source | PR [#122](https://github.com/Flashdevnak/waiting-trucks-report/pull/122) and [#123](https://github.com/Flashdevnak/waiting-trucks-report/pull/123) merged to DEV. DEV head `afbe6e0e57b5d0a752303e39846538a439dda27d` |
| DEV live | Version 650 rollback target `1e8e7e6a-95b5-40d1-ba8d-5c6fbf763637`, previously verified 100% traffic, Turso, D1=0. [Main Brain acceptance](https://github.com/Flashdevnak/waiting-trucks-report/pull/123#issuecomment-7064118903) |
| WTR-011P | Code merged; `DEPLOY_PENDING`. Offline security ACCEPTED. Provider acceptance OPEN. Historical Builder RCA UNKNOWN. |
| Dispatch | Manual only. Four inputs and exact source, Candidate, Scope and Golden pins apply. Owner approval required; credential policy still BLOCKED. |

[Offline runner proof](https://github.com/Flashdevnak/waiting-trucks-report/actions/runs/44848641565/job/136674466173) · [WTR-011P task record](tasks/TASK_INDEX.md#wtr-011p) · [Workflow source](../.github/workflows/deploy-worker-dev.yml)

Read-only WTR-012 provider check after initial Brain publication: live deployment `dabd7c50-61f0-4b51-ae23-93484304f474`, Version 650 at 100%, Turso, D1=0. [Consolidated Owner decision](WORK_ORDERS/WTR-011P-OWNER-DECISION.md)
