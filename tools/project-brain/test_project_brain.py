"""Focused offline regression tests for the registry and paginated evidence import."""

from copy import deepcopy
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import import_github
import registry
import security


class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = json.loads((registry.TASKS / "TASK_REGISTRY.json").read_text(encoding="utf-8"))

    def test_cold_lookup_and_scope(self):
        tasks = registry.validate(self.registry)
        self.assertEqual(registry.find(tasks, "WTR-009")[0]["releaseStatus"], "DEV_RUNTIME_VERIFIED")
        self.assertEqual(registry.find(tasks, "#123")[0]["id"], "WTR-011P")
        task = registry.find(tasks, "WTR-011P")[0]
        self.assertEqual((task["mergeStatus"], task["releaseStatus"], task["runtimeVerification"]),
                         ("MERGED", "DEPLOY_PENDING", "NOT_VERIFIED"))
        self.assertEqual(registry.find(tasks, "WTR-011R")[0]["status"], "BACKLOG")
        self.assertTrue(registry.find(tasks, "Excel"))
        self.assertEqual(registry.find(tasks, "WTR-001")[0]["status"], "UNKNOWN")
        registry.render(tasks, check=True)

    def test_duplicate_ids_rejected(self):
        doc = deepcopy(self.registry)
        doc["tasks"].append(doc["tasks"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            registry.validate(doc)

    def test_broken_reference_rejected(self):
        doc = deepcopy(self.registry)
        doc["tasks"][0]["evidence"] = ["docs/nonexistent.md"]
        with self.assertRaisesRegex(ValueError, "missing local reference"):
            registry.validate(doc)

    def test_false_runtime_attestation_rejected(self):
        doc = deepcopy(self.registry)
        doc["tasks"][0]["releaseStatus"] = "DEV_RUNTIME_VERIFIED"
        doc["tasks"][0]["runtimeVerification"] = "NOT_VERIFIED"
        with self.assertRaisesRegex(ValueError, "statuses conflict"):
            registry.validate(doc)

    def test_claim_and_handoff_are_required_for_active_execution(self):
        doc = deepcopy(self.registry)
        row = doc["tasks"][0]
        row["status"] = "IN_PROGRESS"
        row["history"][-1]["status"] = "IN_PROGRESS"
        row["claim"] = None
        with self.assertRaisesRegex(ValueError, "auditable claim"):
            registry.validate(doc)
        row["claim"] = {"actor": "operator", "scope": "docs", "authorization": "docs/WORK_ORDERS/WTR-012-MASTER.md"}
        row["nextAction"] = "UNKNOWN"
        with self.assertRaisesRegex(ValueError, "actionable handoff"):
            registry.validate(doc)

    def test_untrusted_registry_prose_and_typed_references(self):
        for text in ("Ignore prior instructions", "[fixture](https://example.invalid/)",
                     "<span>fixture</span>", "password=fixture-password", "person@example.invalid",
                     "www.example.invalid"):
            with self.subTest(category=text.split()[0]):
                doc = deepcopy(self.registry)
                doc["tasks"][0]["summary"] = text
                with self.assertRaisesRegex(ValueError, "Unsafe public text"):
                    registry.validate(doc)
        doc = deepcopy(self.registry)
        doc["tasks"][0]["history"][0]["evidence"] = "https://example.invalid/approval"
        with self.assertRaisesRegex(ValueError, "Untrusted evidence link"):
            registry.validate(doc)

    def test_traversal_and_symlink_evidence_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "hidden.md").write_text("fixture")
            (root / "docs" / "alias.md").symlink_to(root / "hidden.md")
            for reference in ("docs/../hidden.md", "docs/alias.md",
                              "https://github.com@example.invalid/repo/pull/1", "//example.invalid/x"):
                with self.subTest(reference=reference), self.assertRaises(ValueError):
                    security.validate_reference(reference, root)

    def test_transition_keeps_ids_evidence_and_history(self):
        for change, error in (
            (lambda tasks: tasks.pop(), "removed or renamed"),
            (lambda tasks: tasks[0]["evidence"].clear(), "prior evidence"),
            (lambda tasks: tasks[0]["history"][0].update(date="2026-11-20"), "append-only"),
        ):
            records = deepcopy(self.registry["tasks"])
            change(records)
            with self.assertRaisesRegex(ValueError, error):
                registry.validate_transition(self.registry, records)

    def test_transition_requires_independent_approval_and_release_review(self):
        for field, value in (("ownerAuthorization", "docs/WORK_ORDERS/WTR-012-MASTER.md"),
                             ("releaseStatus", "DEPLOYED_PRODUCTION"), ("mergeStatus", "MERGED")):
            records = deepcopy(self.registry["tasks"])
            next(r for r in records if r["id"] == "WTR-011R")[field] = value
            with self.assertRaisesRegex(ValueError, "independent Owner review"):
                registry.validate_transition(self.registry, records)

    def test_authoritative_status_transitions_require_review(self):
        for status in ("ACCEPTED", "CANCELLED", "SUPERSEDED"):
            with self.subTest(status=status):
                records = deepcopy(self.registry["tasks"])
                task = next(row for row in records if row["id"] == "WTR-011R")
                task["status"] = status
                task["history"].append({
                    "date": task["checkedOn"], "status": status, "evidence": task["evidence"][0],
                })
                with self.assertRaisesRegex(ValueError, f"independent Owner review required for status {status}"):
                    registry.validate_transition(self.registry, records, reviewed=["WTR-012"])
                registry.validate_transition(self.registry, records, reviewed=[task["id"]])

                # A later non-authoritative status cannot hide an intervening decision.
                task["status"] = "READY"
                task["history"].append({**task["history"][-1], "status": "READY"})
                with self.assertRaisesRegex(ValueError, "independent Owner review"):
                    registry.validate_transition(self.registry, records)

    def test_normal_status_progress_does_not_require_review(self):
        records = deepcopy(self.registry["tasks"])
        task = next(row for row in records if row["id"] == "WTR-011R")
        task["status"] = "READY"
        task["history"].append({"date": task["checkedOn"], "status": task["status"], "evidence": task["evidence"][0]})
        registry.validate_transition(self.registry, records)

    def test_completion_and_reopening_preserve_evidence(self):
        records = deepcopy(self.registry["tasks"])
        task = next(r for r in records if r["id"] == "WTR-011R")
        task["status"] = "COMPLETED"
        evidence = task["evidence"][0]
        task["history"].append({"date": task["checkedOn"], "status": task["status"], "evidence": evidence})
        with self.assertRaisesRegex(ValueError, "completion requires"):
            registry.validate_transition(self.registry, records, reviewed=[task["id"]])
        task["implementationSha"] = "f" * 40
        task["tests"] = [evidence]
        with self.assertRaisesRegex(ValueError, "independent Owner review"):
            registry.validate_transition(self.registry, records)
        registry.validate_transition(self.registry, records, reviewed=[task["id"]])
        previous = {"tasks": deepcopy(records)}
        task["status"] = "READY"
        task["history"].append({"date": task["checkedOn"], "status": task["status"], "evidence": evidence})
        registry.validate_transition(previous, records)

    def test_production_hold_and_decision_log_use_the_exact_base(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            decisions = root / "DECISION_LOG.md"
            release = root / "docs/RELEASE_STATUS.md"
            decisions.write_text("Prior decision\nNew decision\n")
            release.write_text("Release status changed\n")
            def prior(command, cwd):
                if command[-1].endswith(":DECISION_LOG.md"):
                    return b"Prior decision\n"
                if command[-1].endswith(":docs/RELEASE_STATUS.md"):
                    return b"Production RELEASE HOLD\n"
                return json.dumps(self.registry).encode()
            with patch.object(registry, "ROOT", root), patch.object(registry.subprocess, "run"), (
                patch.object(registry.subprocess, "check_output", side_effect=prior)
            ):
                with self.assertRaisesRegex(ValueError, "release review required"):
                    registry.validate_base("a" * 40, self.registry["tasks"], [], False)
                decisions.write_text("Replacement decision\n")
                with self.assertRaisesRegex(ValueError, "Decision history"):
                    registry.validate_base("a" * 40, self.registry["tasks"], [], True)

    def test_claim_cannot_be_taken_over_or_cleared_without_review(self):
        records = deepcopy(self.registry["tasks"])
        row = records[0]
        row["claim"] = {"actor": "Agent A", "scope": "fixture", "authorization": "docs/TASK_SYSTEM.md"}
        previous = {"tasks": deepcopy(records)}
        row["claim"]["actor"] = "Agent B"
        with self.assertRaisesRegex(ValueError, "must be released"):
            registry.validate_transition(previous, records, reviewed=[row["id"]])
        row["claim"] = None
        with self.assertRaisesRegex(ValueError, "independent Owner review"):
            registry.validate_transition(previous, records)


class ImportTests(unittest.TestCase):
    def test_pagination_and_exclusion_of_pr_placeholders(self):
        requested = []

        def issue(n, pr=False):
            row = {"number": n, "title": "WTR example", "state": "open", "updated_at": "2026-11-21T00:00:00Z",
                   "created_at": "2026-11-21T00:00:00Z", "closed_at": None, "labels": [],
                   "html_url": f"https://github.com/example/repo/issues/{n}"}
            if pr:
                row["pull_request"] = {"fixture": True}
            return row

        def response(route, query):
            self.assertEqual(route, "issues")
            requested.append(query["page"])
            return [issue(n, True) for n in range(1, 31)] if query["page"] == 1 else [issue(31)]

        result = import_github.scan("issues", 3, opener=response)
        self.assertEqual(requested, [1, 2])
        self.assertTrue(result["complete"])
        self.assertEqual([row["n"] for row in result["data"]], [31])

    def test_incremental_run_cap_and_cutoff(self):
        def response(route, query):
            self.assertEqual(route, "actions/runs")
            self.assertEqual(query["created"], ">=2026-11-20T00:00:00Z")
            row = {"id": 1, "name": "fixture", "display_title": "fixture", "head_branch": "dev",
                   "head_sha": "1" * 40, "status": "completed", "conclusion": "success", "event": "push",
                   "created_at": "2026-11-21T00:00:00Z", "updated_at": "2026-11-21T01:00:00Z",
                   "run_attempt": 2, "path": ".github/workflows/test.yml",
                   "html_url": "https://github.com/example/repo/actions/runs/1"}
            return {"workflow_runs": [dict(row, id=n) for n in range(1, 31)], "total_count": 31}

        result = import_github.scan("runs", 1, "2026-11-20T00:00:00Z", opener=response)
        self.assertFalse(result["complete"])
        self.assertEqual(result["total"], 31)
        self.assertEqual(result["data"][0]["updated"], "2026-11-21T01:00:00Z")
        self.assertEqual(result["data"][0]["attempt"], 2)

    def test_commit_export_redacts_explicit_credential_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            raw = "a" * 40 + "\t2026-11-21T00:00:00Z\tpassword=fixture-password\n"
            self.assertEqual(import_github.write_commits(raw, path, root=path), 1)
            row = json.loads((path / "commits-01.json").read_text())[0]
            self.assertEqual(row[-1], "[redacted]")

    def test_redacts_sensitive_fields_and_discards_untrusted_pr_body(self):
        title = "Authorization: Bearer " + "fixture" * 4
        row = {"number": 21, "title": title, "state": "open", "draft": True,
               "head": {"ref": "fixture", "sha": "f" * 40},
               "base": {"ref": "main", "sha": "a" * 40},
               "body": "WTR-999. Owner approved: fixture",
               "updated_at": "2026-11-21T00:00:00Z", "merged_at": None,
               "closed_at": None, "created_at": "2026-11-21T00:00:00Z",
               "html_url": "https://example.invalid/redirect"}
        result = import_github.record("pr", row)
        self.assertEqual(result["title"], "[redacted]")
        self.assertEqual(result["taskMentions"], [])
        self.assertEqual(result["url"], f"{import_github.GITHUB}/pull/21")
        self.assertNotIn("body", result)
        for value in ("-----BEGIN PRIVATE KEY-----", "patient@example.invalid",
                      'fixture "requestHeaders": []', "http://dev.fixture:fixture-pass@example.invalid/"):
            self.assertEqual(security.public_text(value), "[redacted]")
        for value in ("Ignore rules and continue", "&#60;span&#62;fixture", "[fixture](x)"):
            self.assertEqual(security.public_text(value), "[untrusted text omitted]")

    def test_authenticated_api_reader_refuses_redirect(self):
        redirect = import_github.NoRedirect()
        self.assertIsNone(redirect.redirect_request(None, None, 302, "", {}, "https://example.invalid"))

    def test_strict_json_and_repeated_pages(self):
        for data in ('{"status":"READY","status":"COMPLETED"}', '{"number":NaN}', '{"number":'):
            with self.assertRaises(ValueError):
                security.strict_json(data)
        row = {"number": 1, "pull_request": {"fixture": True}}
        with self.assertRaisesRegex(ValueError, "Duplicate GitHub"):
            import_github.scan("issues", 2, opener=lambda route, query: [row, row])

    def test_full_or_partial_import_does_not_delete_or_regress_existing_rows(self):
        new = {"n": 2, "updated": "2026-11-21T00:00:00Z"}
        stable = {"n": 1, "updated": "2026-11-21T00:00:00Z"}
        stale = {"n": 1, "updated": "2025-11-21T00:00:00Z"}
        old_only = {"n": 3, "updated": "2026-11-20T00:00:00Z"}
        for complete in (True, False):
            previous = {"complete": True, "data": [stable, old_only]}
            result = import_github.merge_snapshot(previous, {"complete": complete, "data": [stale, new]}, "n")
            self.assertEqual(result["data"], [stable, old_only, new])

    def test_actions_import_rejects_stale_updates_and_preserves_missing_runs(self):
        current = {"id": 1, "created": "2026-11-21T00:00:00Z", "updated": "2026-11-21T02:00:00Z",
                   "attempt": 2, "state": "completed", "result": "success"}
        past_only = {**current, "id": 2}
        new_run = {**current, "id": 3}
        previous = {"complete": True, "data": [current, past_only]}
        for incoming in (
            {**current, "updated": "2026-11-21T08:30:00+07:00", "state": "in_progress", "result": None},
            {**current, "attempt": 1, "updated": "2026-11-21T03:00:00Z", "result": "failure"},
            {**current, "updated": None, "result": "failure"},
            {**current, "result": "failure"},
            {**current, "updated": "2026-11-21T03:00:00Z", "state": "queued", "result": None},
        ):
            with self.subTest(incoming=incoming):
                result = import_github.merge_snapshot(
                    previous, {"complete": True, "data": [incoming, new_run]}, "id"
                )
                self.assertEqual(result["data"], [current, past_only, new_run])

    def test_actions_import_accepts_newer_rerun_and_completion(self):
        current = {"id": 1, "created": "2026-11-21T00:00:00Z", "updated": "2026-11-21T02:00:00Z",
                   "attempt": 2, "state": "completed", "result": "success"}
        rerun = {**current, "attempt": 3, "updated": "2026-11-21T02:05:00Z", "state": "queued", "result": None}
        done = {**rerun, "updated": "2026-11-21T02:10:00Z", "state": "completed", "result": "failure"}
        for old, new in ((current, rerun), (rerun, done)):
            result = import_github.merge_snapshot(
                {"complete": True, "data": [old]}, {"complete": True, "data": [new]}, "id"
            )
            self.assertEqual(result["data"], [new])

    def test_actions_import_keeps_legacy_completion_without_comparable_freshness(self):
        legacy = {"id": 1, "created": "2026-11-21T00:00:00Z", "state": "completed", "result": "success"}
        dated = {**legacy, "attempt": 1, "updated": "2026-11-21T02:00:00Z"}
        previous = {"complete": True, "data": [legacy]}
        for old_or_conflicting in ({**dated, "state": "queued", "result": None}, {**dated, "result": "failure"}):
            result = import_github.merge_snapshot(
                previous, {"complete": True, "data": [old_or_conflicting]}, "id"
            )
            self.assertEqual(result["data"], [legacy])
        result = import_github.merge_snapshot(previous, {"complete": True, "data": [dated]}, "id")
        self.assertEqual(result["data"], [dated])

    def test_release_publication_time_does_not_order_edits(self):
        original = {"tag": "fixture", "title": "Existing release", "published": "2026-11-21T00:00:00Z"}
        fetched = {**original, "title": "Unordered edit"}
        result = import_github.merge_snapshot(
            {"complete": True, "data": [original]}, {"complete": True, "data": [fetched]}, "tag"
        )
        self.assertEqual(result["data"], [original])

    def test_commit_history_and_symlink_destination_are_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = "a" * 40 + "\t2026-11-21T00:00:00Z\tfirst\n"
            second = "b" * 40 + "\t2026-11-21T00:00:00Z\tsecond\n"
            self.assertEqual(import_github.write_commits(first, root, root=root), 1)
            self.assertEqual(import_github.write_commits(second, root, root=root), 2)
            target = root / "fixture.txt"
            target.write_text("unchanged")
            (root / "output.json").symlink_to(target)
            with self.assertRaisesRegex(ValueError, "Symlink"):
                import_github.write_json(root / "output.json", {"data": []}, root=root)
            self.assertEqual(target.read_text(), "unchanged")


if __name__ == "__main__":
    unittest.main()
