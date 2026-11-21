"""Validate and search the WTR task registry without any third-party packages."""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
TASKS = ROOT / "docs" / "tasks"
TASK_STATUSES = (
    "PROPOSED BACKLOG READY IN_PROGRESS BLOCKED IMPLEMENTED TESTED IN_REVIEW "
    "ACCEPTED COMPLETED CANCELLED SUPERSEDED UNKNOWN"
).split()
RELEASE_STATUSES = (
    "NOT_DEPLOYED DEPLOY_PENDING DEPLOYED_DEV DEV_RUNTIME_VERIFIED "
    "PRODUCTION_HOLD DEPLOYED_PRODUCTION UNKNOWN"
).split()
MERGE_STATUSES = "UNMERGED MERGED CLOSED_UNMERGED NOT_APPLICABLE UNKNOWN".split()
RUNTIME_STATUSES = "VERIFIED NOT_VERIFIED NOT_APPLICABLE UNKNOWN".split()
VIEWS = {
    "TASK_INDEX.md": ("All tasks", TASK_STATUSES),
    "ACTIVE_TASKS.md": ("Active tasks", "READY IN_PROGRESS IMPLEMENTED TESTED IN_REVIEW ACCEPTED".split()),
    "BACKLOG.md": ("Backlog", "PROPOSED BACKLOG".split()),
    "COMPLETED_TASKS.md": ("Completed and closed tasks", "COMPLETED CANCELLED SUPERSEDED".split()),
    "BLOCKED_TASKS.md": ("Blocked tasks", ["BLOCKED"]),
    "HISTORICAL_TASKS.md": ("Historical and unresolved records", TASK_STATUSES),
}
LINK_FIELDS = ("workOrders", "pullRequests", "issues", "evidence", "tests")
TEXT_FIELDS = (
    "title", "summary", "kind", "checkedOn", "sourceBranch", "workingBranch", "baseSha",
    "implementationSha", "mergeStatus", "releaseStatus", "runtimeVerification", "nextAction",
    "handoff",
)


def validate(registry, root=ROOT):
    if registry.get("schemaVersion") != 1:
        raise ValueError("Unknown task registry schema")
    records = registry.get("tasks", [])
    if not isinstance(records, list) or not records:
        raise ValueError("Registry must contain a non-empty task list")
    ids = set()
    for task in records:
        task_id = task.get("id", "")
        if not re.fullmatch(r"[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+", task_id) or task_id in ids:
            raise ValueError(f"Invalid or duplicate task ID {task_id!r}")
        ids.add(task_id)
        for name in TEXT_FIELDS:
            if not isinstance(task.get(name), str) or not task[name].strip():
                raise ValueError(f"{task_id}: missing {name}")
        for field, allowed in (
            ("status", TASK_STATUSES), ("releaseStatus", RELEASE_STATUSES),
            ("mergeStatus", MERGE_STATUSES), ("runtimeVerification", RUNTIME_STATUSES),
        ):
            if task.get(field) not in allowed:
                raise ValueError(f"{task_id}: invalid {field}")
        for field in ("baseSha", "implementationSha"):
            value = task[field]
            if value not in ("UNKNOWN", "NOT_RECOVERED") and not re.fullmatch(r"[a-f0-9]{40}", value):
                raise ValueError(f"{task_id}: malformed {field}")
        for field in LINK_FIELDS:
            references = task.get(field)
            if not isinstance(references, list):
                raise ValueError(f"{task_id}: {field} must be a list of references")
            for ref in references:
                web = urlparse(ref)
                if web.scheme:
                    if web.scheme != "https" or not web.netloc:
                        raise ValueError(f"{task_id}: invalid reference in {field}")
                    continue
                local = (root / web.path).resolve()
                if not local.is_relative_to(root.resolve()) or not local.is_file():
                    raise ValueError(f"{task_id}: missing local reference {ref}")
        for field in ("tags", "dependencies", "blockers", "risks"):
            if not isinstance(task.get(field), list) or not all(isinstance(v, str) for v in task[field]):
                raise ValueError(f"{task_id}: {field} must be a list of strings")
        history = task.get("history")
        if not isinstance(history, list) or not history or history[-1].get("status") != task["status"]:
            raise ValueError(f"{task_id}: current status must match last history entry")
        for event in history:
            if event.get("status") not in TASK_STATUSES or not event.get("date") or not event.get("evidence"):
                raise ValueError(f"{task_id}: incomplete history event")
        if task["status"] == "IN_PROGRESS":
            claim = task.get("claim")
            if not isinstance(claim, dict) or not all(claim.get(key) for key in ("actor", "scope", "authorization")):
                raise ValueError(f"{task_id}: needs an auditable claim")
        if task["status"] == "BLOCKED" and not task["blockers"]:
            raise ValueError(f"{task_id}: missing blocker")
        if task["status"] in {"IN_PROGRESS", "BLOCKED"} and {task["nextAction"], task["handoff"]} & {"UNKNOWN", "NOT_RECOVERED"}:
            raise ValueError(f"{task_id}: actionable handoff required")
        if task["releaseStatus"] == "DEV_RUNTIME_VERIFIED" and task["runtimeVerification"] != "VERIFIED":
            raise ValueError(f"{task_id}: release and runtime statuses conflict")
        if task["releaseStatus"] in {"DEV_RUNTIME_VERIFIED", "DEPLOYED_DEV", "DEPLOYED_PRODUCTION"} and not task["evidence"]:
            raise ValueError(f"{task_id}: deployment requires evidence")
    for task in records:
        for dependency in task["dependencies"]:
            if dependency not in ids or dependency == task["id"]:
                raise ValueError(f"{task['id']}: invalid dependency {dependency}")
    return records


def find(tasks, query):
    exact = [t for t in tasks if t["id"].casefold() == query.casefold()]
    if exact:
        return exact
    if match := re.fullmatch(r"(?i)(?:PR\s*)?#(\d+)", query):
        refs = (f"/pull/{match[1]}", f"/issues/{match[1]}")
        return [t for t in tasks if any(url.endswith(refs) for url in t["pullRequests"] + t["issues"])]
    return [t for t in tasks if query.casefold() in json.dumps(t, ensure_ascii=False).casefold()]


def render(tasks, *, check=False):
    for filename, (title, statuses) in VIEWS.items():
        lines = [f"# {title}", "", "Generated from [TASK_REGISTRY.json](TASK_REGISTRY.json).", ""]
        for task in sorted(tasks, key=lambda r: r["id"]):
            if task["status"] not in statuses:
                continue
            if filename == "HISTORICAL_TASKS.md" and not task.get("historical"):
                continue
            if filename == "ACTIVE_TASKS.md" and task.get("historical"):
                if task["status"] not in {"READY", "IN_PROGRESS", "IN_REVIEW"}:
                    continue
            lines += [
                f"## {task['id']}", "",
                f"**{task['title']}** · {task['status']} · {task['releaseStatus']}",
                "", task["summary"], "", f"Next action — {task['nextAction']}", "",
            ]
            links = list(dict.fromkeys(task["workOrders"] + task["pullRequests"] + task["evidence"]))[:3]
            if links:
                lines += [" · ".join(
                    f"[Evidence {i}]({link if link.startswith('https://') else '../../' + link})"
                    for i, link in enumerate(links, 1)
                ), ""]
        result = "\n".join(lines)
        path = TASKS / filename
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != result:
                raise ValueError(f"Stale generated view {filename}; run render")
        else:
            path.write_text(result, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "render", "find", "handoff"))
    parser.add_argument("query", nargs="?")
    args = parser.parse_args()
    tasks = validate(json.loads((TASKS / "TASK_REGISTRY.json").read_text(encoding="utf-8")))
    if args.command in ("validate", "render"):
        render(tasks, check=args.command == "validate")
        print(f"Registry {args.command}: {len(tasks)} tasks")
        return
    if not args.query:
        parser.error("find or handoff needs a query")
    results = find(tasks, args.query)
    if args.command == "handoff":
        if len(results) != 1:
            parser.error("handoff needs an unambiguous task ID")
        print(json.dumps(results[0], ensure_ascii=False, indent=2))
    else:
        for task in results:
            print(f"{task['id']}  {task['status']:<14}  {task['releaseStatus']:<22}  {task['title']}")
    if not results:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
