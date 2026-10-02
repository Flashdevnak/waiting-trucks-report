# PNO scan-in evidence truth and UX checkpoint

Parent: `34f0bd6c8213831a6d38d28260a3d99a29b0cd60`.
This candidate is local/artifact only. No publication, deployment, live acceptance,
provider diagnostic request, history request, TBR acquisition, or all-HUB audit.

## Source trace before editing

The effective DEV path is:

1. `readPendingParcelPage` returns `DataList` with each original row spread intact.
2. `readCanonicalPnoPage` carries the exact HUB, proof, day, line/van-line, source
   store and target store to the single per-HUB detail authority.
3. `readSharedPnoPage` passes those raw rows (maximum 200) into
   `observePnoEvidencePage` before building the UI projection.
4. `pnoEvidenceKeys` requires all seven identity dimensions and a strict provider
   arrival timestamp for the occurrence key.
5. `observePnoSnapshot` validates the current source action, action timestamp,
   target store, arrival window and observation time.
6. The view is attached as `scanEvidence`; the frontend renders only the current
   visible evidence rows from the existing filter/pagination path.

No source projection loss of `LastAction`, `LastActionTime`, `store_id`, or
`real_arrive_time` before evidence validation was found. The existing worker
already projects `LastAction` as `lastActionCode`, `LastAction_name` as
`lastAction`, and the timestamps as `lastActionAt` and `arrivalAnchorAt`.
The frontend previously displayed only the action name. A supplied accepted code
with no name therefore displayed an unhelpful empty action. The UI now uses that
already-acquired code's Thai label only when a name is unavailable; missing or
unsupported code remains unavailable. This is display mapping, not stage proof.
The bounded projection now also retains `store_id` as `evidenceStoreId`.

The prompt's `.github/dev-tools/pno-passive-coverage.mjs` does not exist at the
parent. The actual implementation is `worker/src/pno-passive-coverage.js`, staged
by `.github/dev-tools/patch-pno-passive-coverage.mjs`; both were inspected.

## What is and is not proven about the owner's 200 unknown rows

The screenshot shows unknowns, not 200 supported scan gaps. On the shared-page
path, missing identity exits before the reducer as `LOCATOR_INCOMPLETE`, and
missing/invalid arrival anchor exits in the pre-arrival branch. Therefore the
old `OCCURRENCE_OR_SOURCE_INVALID` displayed through this path narrows the current
invalid predicates to action time, action code, parcel target store, action before
arrival, or observation time. Observation time is generated as an ISO timestamp
by the normal shared-page reader; a failed conversion would instead enter the
storage-unavailable fallback.

The old catch-all does not identify which predicate failed for any particular
owner row. No already-acquired payload for those 200 rows was supplied in this
checkpoint, so their exact common cause remains **unproven / potentially mixed**.
No provider truth is guessed. The deterministic fixture reproduces the visible
shape with synthetic missing-action rows as one source-supported scenario,
not as a claim that every owner's row had that defect.

## Repair

- Diagnostic validation preserves the original truth requirements and emits
  specific reasons; multiple invalid predicates retain `validationReasons`.
- Identity diagnostics contain only field names and MISSING/INVALID categories.
- Occurrence comparison includes all persisted dimensions; new records also
  retain PNO. Existing records without this additive PNO field remain compatible
  with the unchanged exact occurrence storage key.
- A weak later action/time/store snapshot cannot erase a persisted positive when
  identity and arrival anchor still establish the same occurrence. Its validation
  issue remains separate as `observationIssue`; no new fact is persisted.
- Another identity/arrival remains unknown. Missing anchor never borrows a positive.
- Suspected gap still requires complete local coverage, monitoring before arrival,
  downstream stage and no positive. Passive latest-state pages never attest to
  complete coverage. Passive cadence remains 120 seconds, 2 routes/4 requests,
  concurrency 1, canonical per-HUB authority.
- The normal UI renders Thai reasons, separates supported gaps and unknowns,
  renders a compact zero-gap note, and groups actual current-page unknown reasons.
- Desktop and mobile use the same classification groups and operational fields.
- Provider, aggregate remaining, filter results and current-page evidence counts
  remain separate. Global prepared-data behavior and 200-row pagination are kept.
- Asset cache version changes only to serve the new PNO UI on a later deployment.

## Deterministic validation

All required checks after the final code edit passed:

| Bounded group | Passed tests |
| --- | ---: |
| Evidence, specific truth/UX fixture, exact-history caller exclusion | 56 |
| Passive authority/coverage, pending reconciliation, weak refresh, detail/affordance | 92 |
| Global Filter, pagination, source contract, destination/next-store truth | 118 |
| Realtime/render resilience, foreground, BusTime, CENTRAL, quota | 128 |
| Staging and DEV deployment ref guards | 33 |

`npm run check` also passed. All generated DEV JavaScript was parse-checked.
The actual final DEV composition was regenerated with the workflow's accepted
staging CLI and Origin Manifest patch; it was not deployed.

One additional historical test,
`rec-07-dev-deployment-readiness.test.mjs`, has a fixed post-REC-08 23-file/hash
manifest. Its manifest equality test fails on both the unchanged parent and this
candidate (both currently have 27 runtime files). Its other four guards pass.
This baseline mismatch was verified rather than changing historical locked
hashes or weakening that test. Mandatory current staging/ref guards pass.

Live data truth and owner UX acceptance remain for the separate exact candidate
publication/deployment/acceptance checkpoint. No live PASS is claimed here.
