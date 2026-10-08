import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildExactDevRuntime } from "./build-exact-dev-runtime.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const rec07Expected = Object.freeze({
  // Historical REC-07 handoff artifact. These values remain locked as evidence.
  entrypointSha256: "3847b6a26565b3506376a8d1c0a519c7473e36686375b772668435b37136e2db",
  stagedIndexSha256: "fff97c3138c27b56ca8884238e69d6ee75e925e9ff655aa863806055b966b764",
  runtimeTreeSha256: "4ba09bfaeed2e9e79ce2e4c132e76e1b0e165a919d308c0ac233dc811b34545f",
  runtimeFileCount: 23,
});
const currentRuntimeExpected = Object.freeze({
  entrypointSha256: "3847b6a26565b3506376a8d1c0a519c7473e36686375b772668435b37136e2db",
  stagedIndexSha256: "f03b4dabd63e6a273728bd788ecb90d2d7a89997812a0a0728ff529c99f15e71",
  runtimeTreeSha256: "e226e51097f6a0dceff18c7d6b80ed8f232d3a3ce7fb7ed062fa5f7c78acf0f4",
  runtimeFileCount: 27,
});
const currentRuntimePaths = [
  "bus-time-hot-lane-v14.js",
  "dev-acceptance-evidence.js",
  "index.js",
  "ms-history-pointer-v1.js",
  "ms-operational-truth-v1.js",
  "origin-manifest-v1.js",
  "pno-inbound-scan-evidence.js",
  "pno-passive-coverage.js",
  "proof-control.js",
  "proof-editor.js",
  "proof-history-v10.js",
  "proof-live-v2.js",
  "proof-plate-search-v5.js",
  "proof-preview.js",
  "proof-route-meta-v15.js",
  "proof-route-meta-v16.js",
  "proof-service-date-dev.js",
  "proof-ui-v10.js",
  "proof-ui-v14.js",
  "proof-ui-v15.js",
  "proof-ui-v16.js",
  "proof-ui-v5.js",
  "proof-v7-deploy-marker.txt",
  "sync-policy.js",
  "tbr-provenance-dev.js",
  "turso-d1.js",
  "turso-index.js",
];

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

test("REC-07 locks the exact local DEV deployment handoff", async (context) => {
  const [workflow, configSource, readiness] = await Promise.all([
    readFile(resolve(repoRoot, ".github/workflows/deploy-worker-dev.yml"), "utf8"),
    readFile(resolve(repoRoot, "worker/wrangler.dev.jsonc"), "utf8"),
    readFile(resolve(repoRoot, "docs/REC-07_DEV_DEPLOYMENT_READINESS.md"), "utf8"),
  ]);
  const config = JSON.parse(configSource);

  await context.test("authoritative builder reproduces the exact current DEV runtime artifact", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "rec-07-builder-"));
    const isolatedRepo = resolve(temporaryRoot, "repo");
    try {
      await cp(repoRoot, isolatedRepo, {
        recursive: true,
        filter(source) {
          const parts = relative(repoRoot, source).split(sep);
          return !parts.some((part) => part === ".git" || part === "node_modules" || part === ".dev-runtime");
        },
      });
      const result = await buildExactDevRuntime({ repoRoot: isolatedRepo });
      assert.deepEqual({
        entrypointSha256: result.entrypointSha256,
        stagedIndexSha256: result.stagedIndexSha256,
        runtimeTreeSha256: result.runtimeTreeSha256,
        runtimeFileCount: result.runtimeFileCount,
      }, currentRuntimeExpected);
      assert.deepEqual(result.files.map((file) => file.path), currentRuntimePaths);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await context.test("generated runtime remains ignored and untracked", () => {
    assert.equal(git("ls-files", "worker/.dev-runtime"), "");
    execFileSync("git", ["check-ignore", "-q", "worker/.dev-runtime/src/turso-index.js"], {
      cwd: repoRoot,
    });
  });

  await context.test("DEV config remains Turso-only with zero D1 bindings", () => {
    assert.equal(config.name, "waiting-trucks-report-api-dev");
    assert.equal(config.main, "src/turso-index.js");
    assert.equal(config.workers_dev, true);
    assert.equal(config.vars?.DB_BACKEND, "turso");
    assert.deepEqual(config.triggers?.crons, ["* * * * *"]);
    assert.equal(Object.hasOwn(config, "d1_databases"), false);
    assert.deepEqual(config.durable_objects?.bindings, [{
      name: "MS_REFRESH_COORDINATOR",
      class_name: "MsRefreshCoordinator",
    }]);
  });

  await context.test("DEV deploy workflow is manual, recovery-ref guarded, and targets the exact artifact", () => {
    assert.match(workflow, /^name: Deploy Worker DEV$/m);
    assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow, /^\s{2}push:/m);
    assert.match(workflow, /- name: Authorize DEV source ref/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/codex\/dev-recovery-contract-v2'/);
    assert.match(workflow, /working-directory: worker/);
    assert.match(workflow, /wrangler deploy \.dev-runtime\/src\/turso-index\.js --config wrangler\.dev\.jsonc/);
  });

  await context.test("readiness record contains the exact non-secret REC-08 handoff", () => {
    for (const value of [
      "47c8eeae7611503371c2ece227e7554739dc1725",
      "3591527c1c3bc25a1731f46a82529d684e25be05",
      "codex/dev-recovery-contract-v2",
      "waiting-trucks-report-api-dev",
      "worker/wrangler.dev.jsonc",
      "worker/.dev-runtime/src/turso-index.js",
      rec07Expected.entrypointSha256,
      rec07Expected.stagedIndexSha256,
      rec07Expected.runtimeTreeSha256,
      "Runtime file count | `23`",
      "D1 bindings | `0`",
      "Deployment: NOT PERFORMED",
      "Workflow dispatch: NOT PERFORMED",
      "Production: UNTOUCHED",
      "Main merge: NONE",
      "REC-07 does not authorize deployment",
      "REC-08 deployment requires explicit",
    ]) assert.ok(readiness.includes(value), `readiness record missing ${value}`);
  });
});
