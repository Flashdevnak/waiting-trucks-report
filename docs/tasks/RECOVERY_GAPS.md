# Recovery coverage and gaps

Snapshot captured during WTR-012 on 21 November 2026 (Asia/Bangkok). Counts describe the accessible sources at capture. Task IDs are curated from evidence. When the original ID is missing, the registry groups unmapped PRs by exact head branch and uses the first observed PR number as the stable ID. An inferred group preserves GitHub artifacts and remains provisional until an original Work Order links them.

| Source | Coverage | Evidence boundary |
|---|---|---|
| GitHub PR metadata | 123 PRs across five pages; 120 merged, two closed without merge, one open | Title, dates, refs, exact SHAs and explicit task mentions. Selected PR comments preserved by link. No claim of complete comment, review or diff coverage. |
| Issues | Five API pages, 123 entries including PR placeholders; zero standalone issues returned | No inference from deleted/missing issues. |
| Branch history | 170 remote branches, no tag refs at intake | Snapshot before canonical Brain branch creation. Git log covers fetched heads and advertised PR heads; see index README for commit count. |
| GitHub Actions | 120 most recent run metadata rows plus the explicitly verified DEV 650 run; API reported 5,242 runs at intake | Old run/log/artifact history remains partial. Incremental and paginated import are provided. Expired artifacts may be unavailable. |
| GitHub Releases | Zero records returned, one finite API page | Releases are separate from Worker deployment evidence. |
| Deployments | Main Brain receipt and Cloudflare read-only snapshot for DEV 650; Browser-Test preview for the first Brain push | GitHub Deployments API family unavailable through the connection. No complete Cloudflare historical deployments or Production claim. |
| Documents and decisions | Current DEV recovery/supervisor contracts and prior Brain branch indexed | Earlier files in source history remain accessible by their original commit. |
| Local-only | WTR-011 family ZIP outputs identified by name and freshly hashed where present | Recovered public-safe metadata. Original ZIP bytes, raw HAR, private logs, and unpushed deltas remain outside the repository. Recover them from the authorized keeper by filename/SHA. |
| IDs with uncertain evidence | WTR-001 through WTR-008 and WTR-010 have placeholders. WTR-009's verified 009C phase is linked, earlier phases remain incomplete. | Fill an existing ID when an authoritative Work Order or result is recovered. Historical cancellation/supersession requires evidence. Closed PRs alone do not prove that disposition. |
| Sessions and integrations | Chat-only history, unadvertised/deleted refs, CP-00…CP-14 local recovery, unrelated external archives not reconstructed | A found document or citation may be indexed without changing status. |

[Source metadata](../project-index/README.md) · [Historical task views](HISTORICAL_TASKS.md) · [Original Work Orders](../WORK_ORDERS/README.md)
