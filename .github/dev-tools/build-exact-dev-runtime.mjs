import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(modulePath), "../..");

const workflowAssets = [
  "waiting.html",
  "admin.html",
  "admin.js",
  "admin.css",
  "supervisor.html",
  "supervisor.js",
  "supervisor-context.js",
  "supervisor-i18n.js",
  "supervisor-modules.js",
  "supervisor-view.js",
  "supervisor.css",
  "ms-report.html",
  "ms-report.js",
  "ms.html",
  "ms.js",
  "proof.html",
  "proof.js",
  "style.css",
  "ms-v4.css",
  "sw.js",
  "favicon.svg",
  "proof-v2-core.js",
  "proof-v2-ui.js",
  "proof-v2-actions.js",
];

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function posixRelative(root, target) {
  return relative(root, target).split(sep).join("/");
}

async function regularFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(root, target));
    else if (entry.isFile()) files.push({ path: posixRelative(root, target), target });
  }
  return files.sort((left, right) => lexicalCompare(left.path, right.path));
}

export async function hashRuntimeTree(runtimeRoot = resolve(defaultRepoRoot, "worker/.dev-runtime")) {
  const sourceRoot = resolve(runtimeRoot, "src");
  const files = await regularFiles(sourceRoot);
  const treeHash = createHash("sha256");
  const hashedFiles = [];
  for (const file of files) {
    const bytes = await readFile(file.target);
    const hash = sha256(bytes);
    hashedFiles.push({ path: file.path, sha256: hash, size: bytes.length });
    treeHash.update(file.path, "utf8");
    treeHash.update("\0", "utf8");
    treeHash.update(hash, "ascii");
    treeHash.update("\n", "utf8");
  }
  const hashFor = (path) => {
    const match = hashedFiles.find((file) => file.path === path);
    if (!match) throw new Error(`Generated DEV runtime is missing ${path}`);
    return match.sha256;
  };
  return {
    entrypointSha256: hashFor("turso-index.js"),
    stagedIndexSha256: hashFor("index.js"),
    runtimeTreeSha256: treeHash.digest("hex"),
    runtimeFileCount: hashedFiles.length,
    files: hashedFiles,
  };
}

async function copyWorkflowAssets(repoRoot, assetRoot) {
  await mkdir(assetRoot, { recursive: true });
  for (const name of workflowAssets) {
    await copyFile(resolve(repoRoot, name), resolve(assetRoot, name));
  }
  await copyFile(
    resolve(repoRoot, ".github/dev-tools/safe-parity.html"),
    resolve(assetRoot, "safe-parity.html"),
  );
}

function runNode(script, args, repoRoot) {
  execFileSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function buildExactDevRuntime({ repoRoot = defaultRepoRoot } = {}) {
  const exactRepoRoot = resolve(repoRoot);
  const workerRoot = resolve(exactRepoRoot, "worker");
  const canonicalSource = resolve(workerRoot, "src");
  const runtimeRoot = resolve(workerRoot, ".dev-runtime");
  const expectedRuntimeRoot = resolve(exactRepoRoot, "worker/.dev-runtime");
  if (runtimeRoot !== expectedRuntimeRoot || runtimeRoot === workerRoot || runtimeRoot === exactRepoRoot) {
    throw new Error("Refusing to clean an unexpected DEV runtime path");
  }

  const runtimeSource = resolve(runtimeRoot, "src");
  const assetRoot = resolve(runtimeRoot, ".stage-assets");
  const stagedFrontend = resolve(assetRoot, "ms.js");
  const stagedIndex = resolve(runtimeSource, "index.js");
  const stagedOriginManifest = resolve(runtimeSource, "origin-manifest-v1.js");
  const stageScript = resolve(exactRepoRoot, ".github/dev-tools/stage-dev-runtime.mjs");
  const originScript = resolve(exactRepoRoot, ".github/dev-tools/patch-dev-origin-manifest-session-v2.mjs");

  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeRoot, { recursive: true });
  await cp(canonicalSource, runtimeSource, { recursive: true, force: false, errorOnExist: true });
  await copyWorkflowAssets(exactRepoRoot, assetRoot);
  try {
    runNode(stageScript, [stagedFrontend, stagedIndex], exactRepoRoot);
    runNode(originScript, [stagedFrontend, stagedOriginManifest], exactRepoRoot);
  } finally {
    await rm(assetRoot, { recursive: true, force: true });
  }
  return hashRuntimeTree(runtimeRoot);
}

function printReport(report) {
  console.log("ENTRYPOINT=worker/.dev-runtime/src/turso-index.js");
  console.log(`ENTRYPOINT_SHA256=${report.entrypointSha256}`);
  console.log(`STAGED_INDEX_SHA256=${report.stagedIndexSha256}`);
  console.log(`RUNTIME_TREE_SHA256=${report.runtimeTreeSha256}`);
  console.log(`RUNTIME_FILE_COUNT=${report.runtimeFileCount}`);
}

const invoked = process.argv[1] && resolve(process.argv[1]) === modulePath;
if (invoked) printReport(await buildExactDevRuntime());
