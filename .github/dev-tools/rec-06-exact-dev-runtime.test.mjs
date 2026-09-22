import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, cp, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hashRuntimeTree } from "./build-exact-dev-runtime.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const builder = resolve(repoRoot, ".github/dev-tools/build-exact-dev-runtime.mjs");
const runtimeRoot = resolve(repoRoot, "worker/.dev-runtime");
const runtimeSource = resolve(runtimeRoot, "src");
const canonicalSource = resolve(repoRoot, "worker/src");

const workflowAssets = [
  "waiting.html", "admin.html", "admin.js", "admin.css", "supervisor.html",
  "supervisor.js", "supervisor-context.js", "supervisor-i18n.js",
  "supervisor-modules.js", "supervisor-view.js", "supervisor.css",
  "ms-report.html", "ms-report.js", "ms.html", "ms.js", "proof.html",
  "proof.js", "style.css", "ms-v4.css", "sw.js", "favicon.svg",
  "proof-v2-core.js", "proof-v2-ui.js", "proof-v2-actions.js",
];

const requiredStagedMarkers = [
  "MS_COMPLETENESS_ENRICHMENT_V1",
  "MS_BOUNDED_P3_BACKFILL_V1",
  "MS_REC04_HISTORY_FRESHNESS_TRUTH_V1",
  "SUPERVISOR_REC05_CANONICAL_PROJECTION_V1",
];

const stagedOnlyMarkers = [
  ...requiredStagedMarkers,
  "MS_REALTIME_WS_V1",
  "DEV_ROOT_ENTRY_V1",
];

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runNode(args, cwd = repoRoot) {
  return execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function reportFrom(output) {
  const values = Object.fromEntries(
    output.trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  return {
    entrypointSha256: values.ENTRYPOINT_SHA256,
    stagedIndexSha256: values.STAGED_INDEX_SHA256,
    runtimeTreeSha256: values.RUNTIME_TREE_SHA256,
    runtimeFileCount: Number(values.RUNTIME_FILE_COUNT),
  };
}

async function regularFileMap(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = new Map();
  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [path, bytes] of await regularFileMap(root, target)) result.set(path, bytes);
    } else if (entry.isFile()) {
      result.set(relative(root, target).split(sep).join("/"), await readFile(target));
    }
  }
  return new Map([...result].sort(([left], [right]) => lexicalCompare(left, right)));
}

function assertByteMapsEqual(actual, expected, label) {
  assert.deepEqual([...actual.keys()], [...expected.keys()], `${label} file paths differ`);
  for (const [path, bytes] of actual) {
    assert.deepEqual(bytes, expected.get(path), `${label} differs at ${path}`);
  }
}

async function assertLocalImportClosure(entrypoint) {
  const pending = [entrypoint];
  const visited = new Set();
  while (pending.length) {
    const target = pending.pop();
    if (visited.has(target)) continue;
    visited.add(target);
    assert.equal((await stat(target)).isFile(), true, `missing runtime module ${target}`);
    const source = await readFile(target, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:import|export)\s+(?:[^"']*?\sfrom\s*)?["'](\.[^"']+)["']/g),
      ...source.matchAll(/import\s*\(\s*["'](\.[^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const dependency = resolve(dirname(target), specifier);
      assert.ok(dependency.startsWith(`${runtimeSource}${sep}`), `local import escapes runtime: ${specifier}`);
      pending.push(dependency);
    }
  }
  return visited;
}

async function workflowReferenceBuild(root) {
  const assets = resolve(root, ".dev-assets");
  const runtime = resolve(root, ".dev-runtime");
  await mkdir(assets, { recursive: true });
  await cp(canonicalSource, resolve(runtime, "src"), { recursive: true });
  for (const name of workflowAssets) {
    await copyFile(resolve(repoRoot, name), resolve(assets, name));
  }
  await copyFile(
    resolve(repoRoot, ".github/dev-tools/safe-parity.html"),
    resolve(assets, "safe-parity.html"),
  );
  runNode([
    resolve(repoRoot, ".github/dev-tools/stage-dev-runtime.mjs"),
    resolve(assets, "ms.js"),
    resolve(runtime, "src/index.js"),
  ]);
  runNode([
    resolve(repoRoot, ".github/dev-tools/patch-dev-origin-manifest-session-v2.mjs"),
    resolve(assets, "ms.js"),
    resolve(runtime, "src/origin-manifest-v1.js"),
  ]);
  return resolve(runtime, "src");
}

test("REC-06 builds the exact deterministic DEV runtime", async (context) => {
  const builderSource = await readFile(builder, "utf8");
  const workflow = await readFile(resolve(repoRoot, ".github/workflows/deploy-worker-dev.yml"), "utf8");
  const wrangler = await readFile(resolve(repoRoot, "worker/wrangler.dev.jsonc"), "utf8");
  const canonicalBefore = await regularFileMap(canonicalSource);

  await context.test("builder is offline, secret-free, and orchestrates canonical helpers", () => {
    assert.doesNotMatch(builderSource, /\bfetch\s*\(|https?:\/\/|wrangler|process\.env/);
    for (const secret of ["TURSO_AUTH_TOKEN", "TURSO_DATABASE_URL", "CLOUDFLARE_API_TOKEN", "AUTH_SECRET", "PASSWORD_PEPPER", "GITHUB_TOKEN"])
      assert.doesNotMatch(builderSource, new RegExp(secret));
    assert.match(builderSource, /stage-dev-runtime\.mjs/);
    assert.match(builderSource, /patch-dev-origin-manifest-session-v2\.mjs/);
  });

  await context.test("DEV config is Turso-only with zero D1 bindings", () => {
    assert.match(wrangler, /"main"\s*:\s*"src\/turso-index\.js"/);
    assert.match(wrangler, /"DB_BACKEND"\s*:\s*"turso"/);
    assert.doesNotMatch(wrangler, /d1_databases/);
  });

  const outputA = runNode([builder]);
  const buildA = reportFrom(outputA);
  const filesA = await regularFileMap(runtimeSource);

  await rm(runtimeRoot, { recursive: true, force: true });
  const outputB = runNode([builder]);
  const buildB = reportFrom(outputB);
  const filesB = await regularFileMap(runtimeSource);

  await writeFile(resolve(runtimeRoot, "stale-injected.txt"), "REC-06 stale file\n", "utf8");
  const outputC = runNode([builder]);
  const buildC = reportFrom(outputC);
  const filesC = await regularFileMap(runtimeSource);

  await context.test("Build A equals clean Build B byte-for-byte", () => {
    assert.deepEqual(buildA, buildB);
    assertByteMapsEqual(filesA, filesB, "Build A/B");
  });

  await context.test("idempotent Build C equals Build B and removes stale output", async () => {
    assert.deepEqual(buildB, buildC);
    assertByteMapsEqual(filesB, filesC, "Build B/C");
    await assert.rejects(stat(resolve(runtimeRoot, "stale-injected.txt")), { code: "ENOENT" });
  });

  await context.test("hash report covers the complete stable regular-file tree", async () => {
    const direct = await hashRuntimeTree(runtimeRoot);
    assert.deepEqual({
      entrypointSha256: direct.entrypointSha256,
      stagedIndexSha256: direct.stagedIndexSha256,
      runtimeTreeSha256: direct.runtimeTreeSha256,
      runtimeFileCount: direct.runtimeFileCount,
    }, buildC);
    assert.equal(direct.files.length, filesC.size);
    assert.deepEqual(direct.files.map((file) => file.path), [...filesC.keys()]);
  });

  await context.test("entrypoint and its generated local dependency closure are valid", async () => {
    const entrypoint = resolve(runtimeSource, "turso-index.js");
    const stagedIndex = resolve(runtimeSource, "index.js");
    runNode(["--check", entrypoint]);
    runNode(["--check", stagedIndex]);
    const closure = await assertLocalImportClosure(entrypoint);
    assert.ok(closure.has(stagedIndex));
    for (const modulePath of closure) runNode(["--check", modulePath]);
    const source = await readFile(entrypoint, "utf8");
    assert.match(source, /from "\.\/index\.js"/);
    assert.match(source, /import \{ databaseEnv \} from "\.\/turso-d1\.js"/);
    assert.doesNotMatch(source, /from\s+["'](?:https?:|\/)/);
  });

  await context.test("REC-01 through REC-05 contracts stay staged-only", async () => {
    const staged = await readFile(resolve(runtimeSource, "index.js"), "utf8");
    const canonical = await readFile(resolve(canonicalSource, "index.js"), "utf8");
    for (const lifecycleContract of [
      "MS_OPERATIONAL_STAGE_SHARED_V1",
      "function resolveUnloadingStartTruth",
      "completionTruth = resolveCompletionTruth",
      "actualDepartureAt",
    ]) assert.ok(staged.includes(lifecycleContract), `REC-01 contract missing: ${lifecycleContract}`);
    for (const marker of requiredStagedMarkers) assert.match(staged, new RegExp(marker));
    for (const marker of stagedOnlyMarkers) assert.doesNotMatch(canonical, new RegExp(marker));
  });

  const referenceRoot = await mkdtemp(join(tmpdir(), "rec-06-workflow-"));
  try {
    const referenceSource = await workflowReferenceBuild(referenceRoot);
    await context.test("builder output is byte-identical to current workflow staging intent", async () => {
      assertByteMapsEqual(
        await regularFileMap(runtimeSource),
        await regularFileMap(referenceSource),
        "builder/workflow reference",
      );
      for (const command of [
        "cp -R src .dev-runtime/src",
        "stage-dev-runtime.mjs .dev-assets/ms.js .dev-runtime/src/index.js",
        "patch-dev-origin-manifest-session-v2.mjs .dev-assets/ms.js .dev-runtime/src/origin-manifest-v1.js",
        "wrangler deploy .dev-runtime/src/turso-index.js --config wrangler.dev.jsonc",
      ]) assert.ok(workflow.includes(command), `workflow command changed: ${command}`);
    });
  } finally {
    await rm(referenceRoot, { recursive: true, force: true });
  }

  await context.test("canonical source remains byte-identical", async () => {
    assertByteMapsEqual(await regularFileMap(canonicalSource), canonicalBefore, "canonical source");
  });

  await context.test("recovery-branch changes cannot trigger main-only workflows", async () => {
    assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
    assert.doesNotMatch(workflow, /codex\/dev-recovery-contract-v2/);
    const workflowDir = resolve(repoRoot, ".github/workflows");
    for (const entry of await readdir(workflowDir)) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
      const source = await readFile(resolve(workflowDir, entry), "utf8");
      assert.doesNotMatch(source, /codex\/dev-recovery-contract-v2/);
    }
  });
});
