"""Validate and search the WTR task registry without any third-party packages."""

import argparse
import json
import re
import subprocess
from datetime import date
from pathlib import Path

from security import (
    atomic_write, markdown_text, repository_path, require_public_text,
    strict_json, validate_reference,
)


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


TASK_ID = re.compile(r"[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+")
SHA = re.compile(r"[a-f0-9]{40}")
MISSING = {"UNKNOWN", "NOT_RECOVERED"}
LIST_FIELDS = ("tags", "dependencies", "blockers", "risks", "releaseRisks")
PROTECTED = ("ownerAuthorization", "mergeStatus", "releaseStatus", "runtimeVerification")
REVIEWED_STATUSES = {"ACCEPTED", "CANCELLED", "SUPERSEDED"}
CANONICAL_BASE_REF = "refs/remotes/origin/project-brain/wtr"


EXECUTION_TOOLS = {"MAIN_BRAIN", "CHATGPT_WORK", "CODEX_CLOUD", "CODEX_PC", "UNKNOWN"}


def validate_execution(execution):
    fields = {"tool", "model", "reasoningEffort", "workingSha"}
    if not isinstance(execution, dict) or set(execution) != fields:
        raise ValueError("Malformed execution checkpoint")
    for field in fields:
        if not isinstance(execution[field], str) or not execution[field].strip():
            raise ValueError(f"Missing execution {field}")
        require_public_text(execution[field], f"execution.{field}")
    if execution["tool"] not in EXECUTION_TOOLS:
        raise ValueError("Unknown execution tool")
    sha = execution["workingSha"]
    if sha not in MISSING and not SHA.fullmatch(sha):
        raise ValueError("Malformed execution working SHA")


def validate_claim(claim, task, root):
    legacy_fields = {"actor", "scope", "authorization"}
    if not isinstance(claim, dict) or set(claim) not in (legacy_fields, legacy_fields | {"id"}):
        raise ValueError("Task needs an auditable claim")
    for field in ("actor", "scope"):
        if not isinstance(claim[field], str) or not claim[field].strip():
            raise ValueError("Task needs an auditable claim")
        require_public_text(claim[field], f"claim.{field}")
    validate_reference(claim["authorization"], root)
    if "id" in claim:
        if task["status"] in {"COMPLETED", "CANCELLED", "SUPERSEDED"}:
            raise ValueError("Closed tasks must release their active claim")
        if not isinstance(claim["id"], str) or not TASK_ID.fullmatch(claim["id"]):
            raise ValueError("Malformed claim ID")
        if (task.get("ownerAuthorization") != claim["authorization"]
                or not SHA.fullmatch(task["baseSha"]) or task["workingBranch"] in MISSING
                or not task.get("execution") or task["execution"]["tool"] == "UNKNOWN"
                or not SHA.fullmatch(task["execution"]["workingSha"])):
            raise ValueError("Active claim requires Owner scope, execution tool and exact base and working refs")


def validate_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Malformed registry date")
    date.fromisoformat(value)


def validate(registry, root=ROOT):
    if (not isinstance(registry, dict) or set(registry) != {"schemaVersion", "tasks"}
            or type(registry["schemaVersion"]) is not int or registry["schemaVersion"] != 1):
        raise ValueError("Unknown task registry schema")
    records = registry["tasks"]
    if not isinstance(records, list) or not records:
        raise ValueError("Registry must contain a non-empty task list")
    ids = set()
    claim_ids = set()
    allowed_fields = set(TEXT_FIELDS + LINK_FIELDS + LIST_FIELDS) | {
        "id", "status", "history", "claim", "historical", "artifacts",
        "ownerAuthorization", "testSummary", "execution",
    }
    for task in records:
        if not isinstance(task, dict) or task.keys() - allowed_fields:
            raise ValueError("Malformed task or unknown task field")
        task_id = task.get("id")
        if not isinstance(task_id, str) or not TASK_ID.fullmatch(task_id) or task_id in ids:
            raise ValueError("Invalid or duplicate task ID")
        ids.add(task_id)
        for name in TEXT_FIELDS:
            if not isinstance(task.get(name), str) or not task[name].strip():
                raise ValueError(f"{task_id}: missing {name}")
            require_public_text(task[name], name)
        validate_date(task["checkedOn"])
        if "testSummary" in task:
            require_public_text(task["testSummary"], "testSummary")
        if "historical" in task and type(task["historical"]) is not bool:
            raise ValueError("Malformed historical flag")
        for field, allowed in (
            ("status", TASK_STATUSES), ("releaseStatus", RELEASE_STATUSES),
            ("mergeStatus", MERGE_STATUSES), ("runtimeVerification", RUNTIME_STATUSES),
        ):
            if task.get(field) not in allowed:
                raise ValueError(f"{task_id}: invalid {field}")
        for field in ("baseSha", "implementationSha"):
            if task[field] not in MISSING and not SHA.fullmatch(task[field]):
                raise ValueError(f"{task_id}: malformed {field}")
        for field in LINK_FIELDS:
            references = task.get(field)
            if not isinstance(references, list):
                raise ValueError(f"{task_id}: {field} must be a list of references")
            for reference in references:
                validate_reference(reference, root)
        for field in LIST_FIELDS:
            values = task.get(field, [] if field == "releaseRisks" else None)
            if not isinstance(values, list):
                raise ValueError(f"{task_id}: {field} must be a list of strings")
            for value in values:
                require_public_text(value, field)
        if "ownerAuthorization" in task and task["ownerAuthorization"] not in tuple(MISSING):
            validate_reference(task["ownerAuthorization"], root)
        validate_artifacts(task.get("artifacts", []), root)
        history = task.get("history")
        if not isinstance(history, list) or not history:
            raise ValueError(f"{task_id}: missing history")
        for event in history:
            if (not isinstance(event, dict) or set(event) != {"date", "status", "evidence"}
                    or event["status"] not in TASK_STATUSES):
                raise ValueError(f"{task_id}: malformed history event")
            validate_date(event["date"])
            validate_reference(event["evidence"], root)
        if history[-1]["status"] != task["status"]:
            raise ValueError(f"{task_id}: current status must match last history entry")
        if [e["date"] for e in history] != sorted(e["date"] for e in history):
            raise ValueError(f"{task_id}: history dates are out of order")
        if "execution" in task:
            validate_execution(task["execution"])
        claim = task.get("claim")
        if task["status"] == "IN_PROGRESS" or claim is not None:
            validate_claim(claim, task, root)
            if "id" in claim:
                if claim["id"] in claim_ids:
                    raise ValueError("Duplicate active claim ID")
                claim_ids.add(claim["id"])
        if task["status"] == "BLOCKED" and not task["blockers"]:
            raise ValueError(f"{task_id}: missing blocker")
        if task["status"] in {"IN_PROGRESS", "BLOCKED"} and {task["nextAction"], task["handoff"]} & MISSING:
            raise ValueError(f"{task_id}: actionable handoff required")
        if task["releaseStatus"] == "DEV_RUNTIME_VERIFIED" and task["runtimeVerification"] != "VERIFIED":
            raise ValueError(f"{task_id}: release and runtime statuses conflict")
        if task["releaseStatus"] in {"DEV_RUNTIME_VERIFIED", "DEPLOYED_DEV", "DEPLOYED_PRODUCTION"} and not task["evidence"]:
            raise ValueError(f"{task_id}: deployment requires evidence")
    for task in records:
        for dependency in task["dependencies"]:
            if dependency not in ids or dependency == task["id"]:
                raise ValueError(f"{task['id']}: invalid dependency")
    return records


def validate_artifacts(artifacts, root):
    if not isinstance(artifacts, list):
        raise ValueError("Malformed artifact list")
    for artifact in artifacts:
        if not isinstance(artifact, dict) or set(artifact) != {"name", "sha256", "availability", "durableDownload"}:
            raise ValueError("Malformed artifact metadata")
        if any(not isinstance(value, str) for value in artifact.values()):
            raise ValueError("Malformed artifact metadata")
        require_public_text(artifact["name"], "artifact.name")
        if not re.fullmatch(r"[A-Za-z0-9_. ()-]+", artifact["name"]) or not re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]):
            raise ValueError("Malformed artifact metadata")
        if artifact["availability"] not in {"LOCAL_ONLY", "PUBLIC", "NOT_RECOVERED", "UNKNOWN"}:
            raise ValueError("Malformed artifact availability")
        if artifact["durableDownload"] not in MISSING:
            validate_reference(artifact["durableDownload"], root)


def validate_transition(previous, records, reviewed=()):
    """Check a fresh trusted base. Review flags come from the operator, not the registry."""
    old_tasks = {task["id"]: task for task in previous["tasks"]}
    new_tasks = {task["id"]: task for task in records}
    if old_tasks.keys() - new_tasks.keys():
        raise ValueError("Existing task IDs cannot be removed or renamed")
    if set(reviewed) - new_tasks.keys():
        raise ValueError("Reviewed task ID is absent")
    for task_id, task in new_tasks.items():
        old = old_tasks.get(task_id)
        if old:
            history = old["history"]
            if task["history"][:len(history)] != history:
                raise ValueError(f"{task_id}: history must be append-only")
            if any(not set(old[field]).issubset(task[field]) for field in LINK_FIELDS):
                raise ValueError(f"{task_id}: prior evidence must be preserved")
            if any(artifact not in task.get("artifacts", []) for artifact in old.get("artifacts", [])):
                raise ValueError(f"{task_id}: prior artifact metadata must be preserved")
            if old.get("claim") and task.get("claim"):
                old_claim = old["claim"]
                claim = task["claim"]
                if (old_claim["actor"] != claim["actor"] or old_claim.get("id") != claim.get("id")
                        or old.get("execution", {}).get("tool") != task.get("execution", {}).get("tool")
                        or old["baseSha"] != task["baseSha"] or old["workingBranch"] != task["workingBranch"]):
                    raise ValueError(f"{task_id}: existing claim must be released before transfer")
        claim = task.get("claim")
        old_claim = old.get("claim") if old else None
        if (old and claim != old_claim and any(c and "id" in c for c in (claim, old_claim))
                and task["history"] == old["history"]):
            raise ValueError(f"{task_id}: active claim changes require a history entry")
        if claim and "id" not in claim and claim != old_claim:
            raise ValueError(f"{task_id}: new or revised claims require an execution checkpoint and claim ID")
        checked_fields = [field for field in PROTECTED if old and old.get(field) != task.get(field)]
        if old:
            statuses = [old["status"]] + [
                event["status"] for event in task["history"][len(old["history"]):]
            ]
            checked_fields.extend(
                f"status {status}" for previous_status, status in zip(statuses, statuses[1:])
                if status in REVIEWED_STATUSES and status != previous_status
            )
        if not old and (task.get("ownerAuthorization") not in (None, *MISSING)
                        or task["mergeStatus"] == "MERGED"
                        or task["releaseStatus"] not in {"UNKNOWN", "NOT_DEPLOYED"}
                        or task["runtimeVerification"] not in {"UNKNOWN", "NOT_VERIFIED", "NOT_APPLICABLE"}):
            checked_fields.append("new authority or release assertion")
        if (old.get("claim") if old else None) != task.get("claim"):
            checked_fields.append("claim")
        if checked_fields and task_id not in reviewed:
            raise ValueError(f"{task_id}: independent Owner review required for {', '.join(checked_fields)}")
        if task["status"] == "COMPLETED" and (not old or old["status"] != "COMPLETED"):
            if (not SHA.fullmatch(task["implementationSha"]) or not task["evidence"] or not task["tests"]
                    or task["history"][-1]["evidence"] not in task["tests"] + task["evidence"]):
                raise ValueError(f"{task_id}: completion requires implementation, tests and outcome evidence")
            if task_id not in reviewed:
                raise ValueError(f"{task_id}: independent Owner review required for completion")


def validate_base(ref, tasks, reviewed, review_release):
    if not SHA.fullmatch(ref):
        raise ValueError("Fresh exact Brain base SHA required")

    canonical = subprocess.run(
        ["git", "rev-parse", "--verify", CANONICAL_BASE_REF], cwd=ROOT, capture_output=True,
        text=True, check=False,
    )
    if canonical.returncode:
        raise ValueError("Fetch origin/project-brain/wtr before exact-base validation")
    if ref != canonical.stdout.strip():
        raise ValueError("Base SHA must match the fetched canonical Brain tip")

    def prior(name):
        return subprocess.check_output(["git", "show", f"{ref}:{name}"], cwd=ROOT)

    subprocess.run(["git", "merge-base", "--is-ancestor", ref, "HEAD"], check=True, cwd=ROOT)
    validate_transition(strict_json(prior("docs/tasks/TASK_REGISTRY.json")), tasks, reviewed)
    decisions = repository_path(ROOT, "DECISION_LOG.md").read_bytes()
    if not decisions.startswith(prior("DECISION_LOG.md")):
        raise ValueError("Decision history must be append-only")
    release = repository_path(ROOT, "docs/RELEASE_STATUS.md").read_bytes()
    if release != prior("docs/RELEASE_STATUS.md") and not review_release:
        raise ValueError("Independent Owner release review required")


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
        if filename == "ACTIVE_TASKS.md":
            lines += ["## Active claims", ""]
            for task in sorted(tasks, key=lambda record: record["id"]):
                claim = task.get("claim")
                if claim:
                    tool = task.get("execution", {}).get("tool", "UNKNOWN")
                    claim_id = claim.get("id", "LEGACY")
                    branch = markdown_text(task["workingBranch"])
                    actor = markdown_text(claim["actor"])
                    lines.append(f"- {task['id']} · {claim_id} · {actor} · {tool} · {branch}")
            if lines[-1] == "":
                lines.append("No recorded active claims.")
            lines.append("")
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
                f"**{markdown_text(task['title'])}** · {task['status']} · {task['releaseStatus']}",
                "", markdown_text(task["summary"]), "", f"Next action — {markdown_text(task['nextAction'])}", "",
            ]
            links = list(dict.fromkeys(task["workOrders"] + task["pullRequests"] + task["evidence"]))[:3]
            if links:
                lines += [" · ".join(
                    f"[Evidence {i}]({link if link.startswith('https://') else '../../' + link})"
                    for i, link in enumerate(links, 1)
                ), ""]
        result = "\n".join(lines)
        path = repository_path(ROOT, (TASKS / filename).relative_to(ROOT))
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != result:
                raise ValueError(f"Stale generated view {filename}; run render")
        else:
            atomic_write(ROOT, path, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "render", "find", "handoff"))
    parser.add_argument("query", nargs="?")
    parser.add_argument("--base-ref", help="full SHA of the freshly fetched origin/project-brain/wtr tip")
    parser.add_argument("--reviewed-task", action="append", default=[], help="ID after independent Owner review")
    parser.add_argument("--review-release", action="store_true", help="confirm separate Owner review for release document")
    args = parser.parse_args()
    path = repository_path(ROOT, "docs/tasks/TASK_REGISTRY.json")
    tasks = validate(strict_json(path.read_bytes()))
    if args.base_ref:
        validate_base(args.base_ref, tasks, args.reviewed_task, args.review_release)
    elif args.reviewed_task or args.review_release:
        parser.error("review flags require --base-ref")
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
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        message = "Registry JSON is malformed" if isinstance(error, json.JSONDecodeError) else str(error)
        raise SystemExit(message) from None
