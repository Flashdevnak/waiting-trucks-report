# REC-07 DEV Deployment Readiness

Status: local gate complete; remote backup pending

Scope: DEV only

## Source lock

| Item | Locked value |
| --- | --- |
| REC-07 source SHA | `PENDING_UNTIL_THIS_DOCUMENT_IS_COMMITTED` |
| Base REC-06 SHA | `47c8eeae7611503371c2ece227e7554739dc1725` |
| Remote `main` lock | `3591527c1c3bc25a1731f46a82529d684e25be05` |
| Recovery branch | `codex/dev-recovery-contract-v2` |

The exact REC-07 source SHA is the commit containing this document. It must be
reported and independently verified after the incremental REC-07 bundle is
pushed by the owner.

## Exact DEV runtime

| Item | Locked value |
| --- | --- |
| DEV Worker | `waiting-trucks-report-api-dev` |
| DEV config | `worker/wrangler.dev.jsonc` |
| Generated entrypoint | `worker/.dev-runtime/src/turso-index.js` |
| Entrypoint SHA-256 | `3847b6a26565b3506376a8d1c0a519c7473e36686375b772668435b37136e2db` |
| Staged index SHA-256 | `fff97c3138c27b56ca8884238e69d6ee75e925e9ff655aa863806055b966b764` |
| Runtime tree SHA-256 | `4ba09bfaeed2e9e79ce2e4c132e76e1b0e165a919d308c0ac233dc811b34545f` |
| Runtime file count | `23` |
| Database backend | `Turso` |
| D1 bindings | `0` |

The authoritative REC-06 builder reproduced these values on two consecutive
REC-07 builds. The REC-06 focused test also rebuilt the artifact and proved it
byte-identical to the current DEV workflow staging intent. Generated files
under `worker/.dev-runtime/` remain ignored and untracked.

## Local gate evidence

- REC-01 through REC-06 checkpoint suite: PASS, 62/62 tests.
- Worker full gate (`npm run check`): PASS.
- TBR diagnostic and Intelligence gate: PASS, 14/14 tests.
- Intelligence fixed time: `2026-09-21T12:00:00.000Z`.
- `2026-09-07` is correctly outside the rolling 14-day window.
- Builder/workflow byte parity: PASS.
- DEV config is Turso-only and contains no D1 binding.
- Git generated-artifact tracking check: PASS; tracked runtime files = 0.

## Workflow and deployment safety

- `.github/workflows/deploy-worker-dev.yml` is named `Deploy Worker DEV`.
- Its push trigger is restricted to `main`.
- Manual `workflow_dispatch` exists but was not invoked.
- Its deployment command uses `worker/wrangler.dev.jsonc` and
  `.dev-runtime/src/turso-index.js` from the Worker working directory.
- Recovery-branch changes do not trigger this main-only deployment workflow.
- Deployment: NOT PERFORMED.
- Workflow dispatch: NOT PERFORMED.
- Live DEV calls: 0.
- Secrets read: 0.
- Production: UNTOUCHED.
- Main merge: NONE.

## REC-08 authorization boundary

REC-07 does not authorize deployment. REC-08 deployment requires explicit
owner authorization after PROJECT BRAIN independently verifies the remote
REC-07 SHA. Until both conditions are satisfied, no DEV deployment or workflow
dispatch is permitted.
