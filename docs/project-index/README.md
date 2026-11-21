# GitHub evidence snapshots

These files hold read-only metadata for the [task registry](../tasks/TASK_REGISTRY.json). PRs and issues use public GitHub collection endpoints with pagination; the Git log holds commit IDs, committer dates and sanitized subjects. The archive contains no PR bodies, logs, authentication data, or private ZIP bytes. Exact links allow independent GitHub follow-up.

- [PRs](pr.json) · [Issues](issues.json) · [Recent Actions](runs.json) · [GitHub Releases](releases.json) · [Refs](refs.json).
- Commit files `commits-NN.json` contain three-column rows `[sha, committerDate, subject]` ordered by `git log`.
- [Coverage and recovery gaps](../tasks/RECOVERY_GAPS.md) explains partial collections and provenance. `complete` is scoped to the requested pagination window.

Use the standard-library importer from a checkout with public GitHub network access. An optional read-only `GH_TOKEN` can be provided through the environment for API rate limits.

```sh
python3 tools/project-brain/import_github.py pr --max-pages 10
python3 tools/project-brain/import_github.py issues --max-pages 10
python3 tools/project-brain/import_github.py releases
python3 tools/project-brain/import_github.py runs --max-pages 10
python3 tools/project-brain/import_github.py refs
```

Use `--since YYYY-MM-DDTHH:MM:SSZ` for PR, issue and run updates. Use a small overlap with the previous successful scan to avoid gaps; the stable number/ID deduplicates rows. A capped update fails before saving if it would advance a partial window. For old Actions history, partition by retired/older time ranges with reproducible API queries, record incomplete windows, and only treat an inspected log as test evidence. The importer never advances the task statuses automatically.

For a full commit snapshot, fetch the relevant histories into separate local refs, then run:

```sh
git fetch --no-tags origin 'refs/heads/*:refs/wtr-index/heads/*' 'refs/pull/*/head:refs/wtr-index/pulls/*'
git for-each-ref --format='%(objectname)' refs/wtr-index |
  sort -u | git log --stdin --format='%H%x09%cI%x09%s' > wtr-commits.tsv
python3 tools/project-brain/import_github.py commits --history-input wtr-commits.tsv
```

Before publishing a refresh, inspect public-safe metadata and preserve prior evidence when a record disappears. Reconcile registry rows based on Work Order, exact commit/PR identity and any required Owner approval.

WTR-012 intake covered **2,631 unique commits** reachable from 170 branch heads and 123 advertised PR heads. The fetched PR heads did not add new unique commits to the branch-ancestry count. The two Brain checkpoint commits are recorded separately in the live ref and [baseline](../SYSTEM_BASELINE.md).

New imports use public metadata fields, canonical WTR GitHub links and title/ref-derived task hints. A task hint supplies a search lead. Historic hints may have originated in PR/issue bodies and require the same evidence review. Missing rows in a new scan retain their existing observation, including in full scans, and an older observation cannot replace a newer timestamp. Open the underlying GitHub record for current state. Commit shards retain already indexed commits if an input omits their former branch.
