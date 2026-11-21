# Task system

The [registry](tasks/TASK_REGISTRY.json) owns status. Its generated views are lookup aids. GitHub metadata indexing writes a separate evidence snapshot. An updated source observation may lead to a reviewed task change; it does not automatically approve a task or replace its history.

```sh
python3 tools/project-brain/registry.py validate
python3 tools/project-brain/registry.py find WTR-011P
python3 tools/project-brain/registry.py find "PNO"
python3 tools/project-brain/registry.py handoff WTR-011P
python3 tools/project-brain/registry.py render
```

1. **Create or resume.** Find both ID and relevant keyword/PR first. Use an existing ID when resuming. Register a new Work Order for a new task with a stable ID, objective, Owner scope and links. Enter `UNKNOWN` for a missing observation and `NOT_RECOVERED` for a missing artifact or Work Order.
2. **Claim.** Check remote HEAD and current claims. Record actor, verified base, isolated work ref and evidence of authorization in the same fast-forward registry commit. Two claims for one task must reconcile before the second proceeds. Update task history on state changes. Keep an actionable handoff for every active or blocked record.
3. **Update and evidence.** Edit the JSON record, append a dated decision when applicable, and link public and sanitized evidence. Record engineering, merge, release and runtime independently. Keep old evidence and mark replacement/supersession explicitly. A new run may be recorded on its exact SHA, even when a prior run failed.
4. **Complete or reopen.** Record exact implementation SHA, validation and outcome, clear the active claim, leave a next action. To reopen, retain the same ID and append a new status event. Link a superseding task or milestone bidirectionally via dependencies/evidence when applicable.
5. **Publish checkpoint.** Render and validate; inspect git status and scoped diff; check current remote refs and workflow side effects. On conflict preserve both histories and resolve affected records by evidence. Publish via fast-forward on authorized branches and fetch the remote SHA. If publishing is unauthorized, report the exact local artifacts and what remains pending.

Task status and release status use the enum sets in the validator. Core fields are required; old records may explicitly say `UNKNOWN` or `NOT_RECOVERED`. Implementation, deployment and live verification require distinct evidence. GitHub PR closure by itself is not task completion or cancellation.
