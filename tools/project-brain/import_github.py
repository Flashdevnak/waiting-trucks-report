"""Refresh WTR's public evidence index. This CLI only reads Git and GitHub."""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from security import REPO, atomic_write, classifications, public_text, repository_path, strict_json


BASE = f"https://api.github.com/repos/{REPO}"
ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs" / "project-index"
ID = re.compile(
    r"\b(?:WTR[-_ ][A-Z]*[-_ ]?\d{3}[A-Z]*(?:[-_ ](?:DEV[-_ ]?\d{3}[A-Z]*|RC\d{2}|CRED[-_ ]?\d{3}))?"
    r"|(?:REC|SUP|CRED)[-_ ]\d{2,3}[A-Z]*)\b", re.I,
)
SHA = re.compile(r"[a-f0-9]{40}")
GITHUB = f"https://github.com/{REPO}"


def scrub(value):
    if isinstance(value, str):
        return "[redacted]" if classifications(value) else value
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        if any(classifications(key) for key in value):
            raise ValueError("Sensitive metadata key")
        return {key: scrub(item) for key, item in value.items()}
    return value


def number(value):
    if type(value) is not int or value < 1:
        raise ValueError("Malformed GitHub record ID")
    return value


def sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError("Malformed Git SHA")
    return value


def timestamp(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T[0-9:+.Z-]+", value):
        raise ValueError("Malformed metadata timestamp")
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


def flag(value):
    if type(value) is not bool:
        raise ValueError("Malformed metadata flag")
    return value


def field_text(value):
    return public_text(value) if value is not None else None


def record(kind, row):
    if not isinstance(row, dict):
        raise ValueError("Malformed GitHub record")
    if kind == "pr":
        n = number(row["number"])
        title, head = public_text(row["title"]), public_text(row["head"]["ref"])
        mentions = sorted(set(ID.findall(f"{title} {head}")))
        return dict(n=n, title=title, state=public_text(row["state"]), draft=flag(row["draft"]),
                    head=head, headSha=sha(row["head"]["sha"]), base=public_text(row["base"]["ref"]),
                    baseSha=sha(row["base"]["sha"]),
                    mergeSha=sha(row["merge_commit_sha"]) if row["merged_at"] else None,
                    updated=timestamp(row["updated_at"]), merged=timestamp(row["merged_at"]), closed=timestamp(row["closed_at"]),
                    created=timestamp(row["created_at"]), taskMentions=mentions, url=f"{GITHUB}/pull/{n}")
    if kind == "issues":
        n, title = number(row["number"]), public_text(row["title"])
        return dict(n=n, title=title, state=public_text(row["state"]), reason=field_text(row.get("state_reason")),
                    pr=bool(row.get("pull_request")), updated=timestamp(row["updated_at"]), created=timestamp(row["created_at"]),
                    closed=timestamp(row["closed_at"]), labels=[public_text(i["name"]) for i in row["labels"]],
                    taskMentions=sorted(set(ID.findall(title))), url=f"{GITHUB}/issues/{n}")
    if kind == "runs":
        n = number(row["id"])
        return dict(id=n, name=public_text(row["name"]), title=public_text(row["display_title"]),
                    ref=public_text(row["head_branch"]) if row["head_branch"] else None,
                    sha=sha(row["head_sha"]), state=public_text(row["status"]), result=field_text(row["conclusion"]), event=public_text(row["event"]),
                    created=timestamp(row["created_at"]), updated=timestamp(row.get("updated_at")),
                    attempt=number(row["run_attempt"]) if row.get("run_attempt") is not None else None,
                    path=public_text(row["path"]), url=f"{GITHUB}/actions/runs/{n}")
    tag = public_text(row["tag_name"])
    if not re.fullmatch(r"[\w./-]+", tag) or any(part in {".", ".."} for part in tag.split("/")):
        raise ValueError("Unsafe release tag")
    return dict(tag=tag, title=public_text(row["name"] or ""), created=timestamp(row["created_at"]),
                published=timestamp(row["published_at"]), prerelease=flag(row["prerelease"]), draft=flag(row["draft"]),
                url=f"{GITHUB}/releases/tag/{tag}")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_api(route, query):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "wtr-project-brain-index"}
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    with build_opener(NoRedirect()).open(
        Request(f"{BASE}/{route}?{urlencode(query)}", headers=headers), timeout=25
    ) as response:
        return strict_json(response.read())


def scan(kind, page_cap, since=None, opener=read_api):
    route = {"pr": "pulls", "issues": "issues", "runs": "actions/runs", "releases": "releases"}[kind]
    options = {"per_page": 30}
    if kind in {"pr", "issues"}:
        options.update(state="all", sort="updated", direction="desc")
    if since and kind == "issues":
        options["since"] = since
    if since and kind == "runs":
        options["created"] = f">={since}"
    rows, pages, total, complete = [], [], None, False
    seen = set()
    for page in range(1, page_cap + 1):
        data = opener(route, {**options, "page": page})
        if kind == "runs":
            total = data["total_count"]
            if type(total) is not int or total < 0:
                raise ValueError("Malformed run count")
            data = data["workflow_runs"]
        if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
            raise ValueError("Malformed GitHub page")
        pages.append({"page": page, "count": len(data)})
        key = {"pr": "number", "issues": "number", "runs": "id", "releases": "tag_name"}[kind]
        for row in data:
            identity = public_text(row[key]) if kind == "releases" else number(row[key])
            if identity in seen:
                raise ValueError("Duplicate GitHub records across pages; retry from fresh pagination")
            seen.add(identity)
            if (since and kind == "pr" and row["updated_at"] < since) or (
                kind == "issues" and row.get("pull_request")
            ):
                continue
            rows.append(record(kind, row))
        if len(data) < options["per_page"] or (
            since and kind == "pr" and data[-1]["updated_at"] < since
        ):
            complete = True
            break
    return {"pages": pages, "total": total, "complete": complete, "since": since, "data": rows}


def write_json(path, data, root=ROOT):
    payload = json.dumps(scrub(data), ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    atomic_write(root, path, payload)


def index_file(directory, filename, root=ROOT):
    return repository_path(root, (directory / filename).relative_to(root))


def git_snapshot():
    remote = f"{GITHUB}.git"
    remote_refs = subprocess.check_output(["git", "ls-remote", "--heads", "--tags", remote], text=True)
    refs = {}
    for line in remote_refs.splitlines():
        digest, ref = line.split("\t", 1)
        if public_text(ref) != ref or not ref.startswith(("refs/heads/", "refs/tags/")):
            raise ValueError("Unsafe Git ref")
        refs[ref] = sha(digest)
    heads = {r.removeprefix("refs/heads/"): h for r, h in refs.items() if r.startswith("refs/heads/")}
    tags = {r.removeprefix("refs/tags/"): h for r, h in refs.items() if r.startswith("refs/tags/")}
    if not heads:
        raise ValueError("Empty remote branch listing")
    return {"heads": heads, "tags": tags}


def write_commits(raw, target, root=ROOT):
    # Preserve indexed history even when the input omits old branches or commits.
    new_rows = {}
    for line in raw.splitlines():
        digest, stamp, title = line.split("\t", 2)
        new_rows.setdefault(sha(digest), [digest, timestamp(stamp), public_text(title)])
    if not new_rows:
        raise ValueError("Commit input is empty")
    rows = {}
    directory = index_file(target, "commits-01.json", root).parent
    for path in sorted(directory.glob("commits-*.json")):
        previous = index_file(target, path.name, root)
        for row in strict_json(previous.read_bytes()):
            rows.setdefault(sha(row[0]), row)
    for digest, row in new_rows.items():
        rows.setdefault(digest, row)
    entries = list(rows.values())
    for offset in range(0, len(entries), 300):
        path = index_file(target, f"commits-{offset // 300 + 1:02}.json", root)
        write_json(path, entries[offset:offset + 300], root)
    return len(entries)


def update_time(row):
    value = timestamp(row.get("updated"))
    if value is None:
        return None
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.utcoffset() is None:
        raise ValueError("Metadata update timestamp must include an offset")
    return instant


def use_new_observation(old, new, key):
    if key == "tag":
        # Release creation/publication dates do not order edits to a release.
        return False
    old_time, new_time = update_time(old), update_time(new)
    if new_time is None or (old_time is not None and new_time < old_time):
        return False
    if key != "id":
        return old_time is None or new_time > old_time

    old_attempt, new_attempt = old.get("attempt"), new.get("attempt")
    if old_attempt is not None and (new_attempt is None or new_attempt < old_attempt):
        return False
    newer_attempt = old_attempt is not None and new_attempt is not None and new_attempt > old_attempt
    if old_time is None:
        # The legacy index saved only created_at, which is shared across attempts.
        same_result = (old.get("state"), old.get("result")) == (new.get("state"), new.get("result"))
        return same_result or (old.get("state") != "completed" and new.get("state") == "completed")
    if old.get("state") == "completed" and not newer_attempt:
        if new.get("state") != "completed":
            return False
    return new_time > old_time or newer_attempt


def merge_snapshot(previous, snapshot, key):
    combined = {row[key]: row for row in previous.get("data", [])}
    for row in snapshot["data"]:
        old = combined.get(row[key])
        if old is None or use_new_observation(old, row, key):
            combined[row[key]] = row
    result = {**snapshot, "data": list(combined.values())}
    if previous and (snapshot.get("since") or not snapshot["complete"]):
        result["previousFullScan"] = previous.get(
            "previousFullScan", previous["complete"] and not previous.get("since")
        )
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("pr", "issues", "runs", "releases", "refs", "commits"))
    parser.add_argument("--max-pages", type=int, default=4)
    parser.add_argument("--since", help="ISO UTC cutoff; use overlap and advance only after complete window")
    parser.add_argument("--history-input", type=Path, help="Git log TSV: full SHA, %%cI, subject")
    args = parser.parse_args()
    if args.max_pages < 1:
        parser.error("--max-pages must be positive")
    if args.kind == "refs":
        path = index_file(INDEX, "refs.json")
        previous = strict_json(path.read_bytes()) if path.exists() else {}
        write_json(path, {**previous, **git_snapshot()})
        return
    if args.kind == "commits":
        if not args.history_input:
            parser.error("commits needs --history-input")
        print(f"Indexed {write_commits(args.history_input.read_text(encoding='utf-8'), INDEX)} commits")
        return
    key = {"pr": "n", "issues": "n", "runs": "id", "releases": "tag"}[args.kind]
    scan_result = scan(args.kind, args.max_pages, args.since)
    if args.since and not scan_result["complete"]:
        parser.error("page cap hit; increase cap before advancing incremental checkpoint")
    path = index_file(INDEX, f"{args.kind}.json")
    previous = strict_json(path.read_bytes()) if path.exists() else {}
    merged = merge_snapshot(previous, scan_result, key)
    write_json(path, merged)
    print(f"{args.kind}: {len(merged['data'])} indexed; complete request={merged['complete']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
        raise SystemExit("Import stopped: source, metadata or destination failed validation") from None
