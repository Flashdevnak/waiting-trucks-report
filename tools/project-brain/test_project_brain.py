"""Focused offline regression tests for the registry and paginated evidence import."""

from copy import deepcopy
import json
import tempfile
import unittest
from pathlib import Path

import import_github
import registry


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
        doc["tasks"][0]["evidence"] = ["nonexistent.txt"]
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
        row["claim"] = {"actor": "operator", "scope": "docs", "authorization": "Work Order"}
        row["nextAction"] = "UNKNOWN"
        with self.assertRaisesRegex(ValueError, "actionable handoff"):
            registry.validate(doc)


class ImportTests(unittest.TestCase):
    def test_pagination_and_exclusion_of_pr_placeholders(self):
        requested = []

        def issue(n, pr=False):
            row = {"number": n, "title": "WTR example", "state": "open", "updated_at": "2026-11-21",
                   "created_at": "2026-11-21", "closed_at": None, "labels": [],
                   "html_url": f"https://github.com/example/repo/issues/{n}"}
            if pr:
                row["pull_request"] = {"fixture": True}
            return row

        def response(route, query):
            self.assertEqual(route, "issues")
            requested.append(query["page"])
            return [issue(n, True) for n in range(30)] if query["page"] == 1 else [issue(30)]

        result = import_github.scan("issues", 3, opener=response)
        self.assertEqual(requested, [1, 2])
        self.assertTrue(result["complete"])
        self.assertEqual([row["n"] for row in result["data"]], [30])

    def test_incremental_run_cap_and_cutoff(self):
        def response(route, query):
            self.assertEqual(route, "actions/runs")
            self.assertEqual(query["created"], ">=2026-11-20T00:00:00Z")
            row = {"id": 1, "name": "fixture", "display_title": "fixture", "head_branch": "dev",
                   "head_sha": "1" * 40, "status": "completed", "conclusion": "success", "event": "push",
                   "created_at": "2026-11-21", "path": ".github/workflows/test.yml",
                   "html_url": "https://github.com/example/repo/actions/runs/1"}
            return {"workflow_runs": [dict(row, id=n) for n in range(30)], "total_count": 31}

        result = import_github.scan("runs", 1, "2026-11-20T00:00:00Z", opener=response)
        self.assertFalse(result["complete"])
        self.assertEqual(result["total"], 31)

    def test_commit_export_redacts_explicit_credential_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            raw = "a" * 40 + "\t2026-11-21\tpassword=fixture-password\n"
            self.assertEqual(import_github.write_commits(raw, path), 1)
            row = json.loads((path / "commits-01.json").read_text())[0]
            self.assertEqual(row[-1], "[redacted]")


if __name__ == "__main__":
    unittest.main()
