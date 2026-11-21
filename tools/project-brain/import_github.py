"""Refresh WTR's public evidence index. This CLI only reads Git and GitHub."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REPO = "Flashdevnak/waiting-trucks-report"
BASE = f"https://api.github.com/repos/{REPO}"
ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs" / "project-index"
ID = re.compile(
    r"\b(?:WTR[-_ ][A-Z]*[-_ ]?\d{3}[A-Z]*(?:[-_ ](?:DEV[-_ ]?\d{3}[A-Z]*|RC\d{2}|CRED[-_ ]?\d{3}))?"
    r"|(?:REC|SUP|CRED)[-_ ]\d{2,3}[A-Z]*)\b", re.I,
)
SENSITIVE = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    r"eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b|"
    r"(?i:(?:authorization|cookie|password|token|secret)\s*[:=]\s*\S+)"
)


def safe(value):
    if isinstance(value, str):
        return SENSITIVE.sub("[redacted]", value)
    if isinstance(value, list):
        return [safe(v) for v in value]
    if isinstance(value, dict):
        return {k: safe(v) for k, v in value.items()}
    return value


def record(kind, row):
    if kind == "pr":
        mentions = sorted(set(ID.findall(f'{row["title"]} {row["head"]["ref"]} {row.get("body") or ""}')))
        return dict(n=row["number"], title=row["title"], state=row["state"], draft=row["draft"],
                    head=row["head"]["ref"], headSha=row["head"]["sha"], base=row["base"]["ref"],
                    baseSha=row["base"]["sha"], mergeSha=row["merge_commit_sha"] if row["merged_at"] else None,
                    updated=row["updated_at"], merged=row["merged_at"], closed=row["closed_at"],
                    created=row["created_at"], taskMentions=mentions, url=row["html_url"])
    if kind == "issues":
        return dict(n=row["number"], title=row["title"], state=row["state"], reason=row.get("state_reason"),
                    pr=bool(row.get("pull_request")), updated=row["updated_at"], created=row["created_at"],
                    closed=row["closed_at"], labels=[i["name"] for i in row["labels"]],
                    taskMentions=sorted(set(ID.findall(f'{row["title"]} {row.get("body") or ""}'))),
                    url=row["html_url"])
    if kind == "runs":
        return dict(id=row["id"], name=row["name"], title=row["display_title"], ref=row["head_branch"],
                    sha=row["head_sha"], state=row["status"], result=row["conclusion"], event=row["event"],
                    created=row["created_at"], path=row["path"], url=row["html_url"])
    return dict(tag=row["tag_name"], title=row["name"], created=row["created_at"],
                published=row["published_at"], prerelease=row["prerelease"], draft=row["draft"],
                url=row["html_url"])


def read_api(route, query):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "wtr-project-brain-index"}
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    with urlopen(Request(f"{BASE}/{route}?{urlencode(query)}", headers=headers), timeout=25) as response:
        return json.load(response)


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
    for page in range(1, page_cap + 1):
        data = opener(route, {**options, "page": page})
        if kind == "runs":
            total = data["total_count"]
            data = data["workflow_runs"]
        pages.append({"page": page, "count": len(data)})
        if since and kind == "pr":
            rows.extend(record(kind, row) for row in data if row["updated_at"] >= since)
        else:
            rows.extend(record(kind, row) for row in data if kind != "issues" or not row.get("pull_request"))
        if len(data) < options["per_page"] or (
            since and kind == "pr" and data[-1]["updated_at"] < since
        ):
            complete = True
            break
    return {"pages": pages, "total": total, "complete": complete, "since": since, "data": rows}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(safe(data), ensure_ascii=False, separators=(",", ":")) + "\n"
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(payload, encoding="utf-8")
    temp.replace(path)


def git_snapshot():
    remote = f"https://github.com/{REPO}.git"
    dev = subprocess.check_output(["git", "ls-remote", "--heads", "--tags", remote], text=True).splitlines()
    refs = {ref: sha for sha, ref in (line.split("\t") for line in dev)}
    return {"heads": {r.removeprefix("refs/heads/"): s for r, s in refs.items() if r.startswith("refs/heads/")},
            "tags": {r.removeprefix("refs/tags/"): s for r, s in refs.items() if r.startswith("refs/tags/")}}


def write_commits(raw, target):
    rows = []
    for line in raw.splitlines():
        sha, date, title = line.split("\t", 2)
        rows.append([sha, date, title])
    count = 0
    for start in range(0, len(rows), 300):
        count += 1
        write_json(target / f"commits-{count:02}.json", rows[start:start + 300])
    for path in target.glob("commits-*.json"):
        if re.fullmatch(r"commits-\d+.json", path.name) and int(path.stem.split("-")[1]) > count:
            path.unlink()
    return len(rows)


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
        write_json(INDEX / "refs.json", git_snapshot())
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
    path = INDEX / f"{args.kind}.json"
    if path.exists() and (args.since or not scan_result["complete"]):
        previous = json.loads(path.read_text(encoding="utf-8"))
        combined = {row[key]: row for row in previous["data"]}
        combined.update({row[key]: row for row in scan_result["data"]})
        scan_result["data"] = list(combined.values())
        scan_result["previousFullScan"] = previous.get(
            "previousFullScan", previous["complete"] and not previous.get("since")
        )
    write_json(path, scan_result)
    print(f"{args.kind}: {len(scan_result['data'])} indexed; complete request={scan_result['complete']}")


if __name__ == "__main__":
    main()
