# System baseline

| Ref | Verified SHA at intake |
|---|---|
| `codex/dev-recovery-contract-v2` | `afbe6e0e57b5d0a752303e39846538a439dda27d` |
| `main` | `39df260b214526c398e92e12444b5e144510812b` |
| Prior docs reference `docs/wtr-main-brain-v1` | `52f2859d5688ba35583ef9e5d56117b7745dff9f` |

GitHub refs verified 21 November 2026 (Asia/Bangkok). [DEV recovery checkpoint](../RECOVERY_CHECKPOINT.md), [Runtime lock](DEV_RUNTIME_LOCK_CHECKPOINT.md), [REC-07 snapshot](REC-07_DEV_DEPLOYMENT_READINESS.md) and [Supervisor checkpoints](../SUPERVISOR_CHECKPOINTS.md) retain their own dates/status. [Operational contract](OPERATIONAL_CONTRACT.md) applies on the verified DEV source. See [release status](RELEASE_STATUS.md) for runtime observations.

The first verified Brain checkpoint is [521033cac670d7501db7e75d9bc3870bd89e9660](https://github.com/Flashdevnak/waiting-trucks-report/commit/521033cac670d7501db7e75d9bc3870bd89e9660). Review current companion docs for the latest handoff.

Publication controls observed during WTR-012: 77 DEV workflows, 75 default-main workflows; no matching push/create trigger for the Brain branch in checked YAML. GitHub Pages builds from `main` at root. No Cloudflare Pages project returned; connected active deployment triggers seen for other sites were scoped to `main`. The separate Browser-Test preview uses `wrangler versions upload` and matched this Brain branch; initial preview succeeded (build `c11acdc1-bad7-4d35-8205-2fe79795b089`). The DEV API Worker was still version 650, Turso, D1=0 at 100% traffic after that push. Check current trigger settings before future publications.

WTR-012 maintenance tools passed 8 focused offline tests, including cold task lookup, paginated import behavior, invalid claims/status and missing evidence references. An offline comparison of PR #122's and PR #123's workflow passed checks for the two step-scoped tokens, credential-free preparation, candidate/ref guards, unchanged Scope/Golden/Sealed Publisher, and four manual inputs.
