import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../workflows/deploy-worker-dev.yml", import.meta.url), "utf8");
const allowedRef = "refs/heads/codex/dev-recovery-contract-v2";
const eventBlock = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("permissions:\n"));

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `${name} step missing`);
  const end = workflow.indexOf("\n      - ", start + 1);
  return { start, text: workflow.slice(start, end < 0 ? undefined : end + 1) };
}

const guard = step("Authorize DEV source ref");
const deploy = step("Deploy DEV Worker on Turso");
const guardRunMarker = "        run: |\n";
assert.ok(guard.text.includes(guardRunMarker), "DEV authorization must execute a shell guard");
const guardScript = guard.text.split(guardRunMarker)[1].split("\n")
  .filter(Boolean)
  .map((line) => {
    assert.ok(line.startsWith("          "), "guard script indentation changed");
    return line.slice(10);
  }).join("\n");

function runGuard({ event = "workflow_dispatch", ref, refName = "", sha = "a".repeat(40) }) {
  return spawnSync("bash", ["-e"], {
    input: guardScript,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      GITHUB_EVENT_NAME: event,
      GITHUB_REF: ref,
      GITHUB_REF_NAME: refName,
      GITHUB_SHA: sha,
    },
  });
}

test("only manual dispatch can start the DEV workflow", () => {
  assert.match(eventBlock, /^on:\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(eventBlock, /^  (?:push|pull_request|workflow_run|schedule):/m);
  assert.deepEqual([...eventBlock.matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]), ["workflow_dispatch"]);
});

test("the real workflow guards before checkout and gates its DEV mutation", () => {
  const stepsStart = workflow.indexOf("    steps:\n");
  assert.ok(stepsStart >= 0);
  assert.ok(workflow.slice(stepsStart + "    steps:\n".length).startsWith("      - name: Authorize DEV source ref\n"));
  assert.match(guard.text, /working-directory: \./);
  assert.doesNotMatch(guard.text, /continue-on-error:\s*true/);
  assert.ok(guard.start < workflow.indexOf("      - uses: actions/checkout@v4"));
  assert.ok(guard.start < deploy.start);
  assert.ok(workflow.includes("      - name: Verify DEV ref guard contract\n        run: node --test ../.github/dev-tools/dev-deploy-ref-guard.test.mjs"));
  assert.ok(workflow.indexOf("      - name: Verify DEV ref guard contract") < deploy.start);
  assert.ok(deploy.text.includes("        if: ${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/codex/dev-recovery-contract-v2' }}"));
  assert.match(deploy.text, /run: npx wrangler deploy \.dev-runtime\/src\/turso-index\.js --config wrangler\.dev\.jsonc/);
  assert.equal((workflow.match(/wrangler deploy /g) || []).length, 1);
  assert.doesNotMatch(workflow.slice(0, deploy.start), /\bwrangler\s+(?:deploy|secret\s+(?:put|delete))\b|cloudflare\/wrangler-action@/i);
});

for (const [name, scenario, allowed] of [
  ["incident #719 manual main", { ref: "refs/heads/main", refName: "main", sha: "3591527c1c3bc25a1731f46a82529d684e25be05" }, false],
  ["main push", { event: "push", ref: "refs/heads/main", refName: "main" }, false],
  ["ref_name cannot bypass full-ref validation", { ref: "refs/heads/main", refName: "codex/dev-recovery-contract-v2" }, false],
  ["authorized recovery dispatch", { ref: allowedRef, refName: "codex/dev-recovery-contract-v2" }, true],
  ["unexpected feature branch", { ref: "refs/heads/feature/unreviewed" }, false],
  ["tag", { ref: "refs/tags/example" }, false],
  ["PR merge ref", { ref: "refs/pull/123/merge" }, false],
  ["empty ref", { ref: "" }, false],
  ["malformed ref", { ref: "main" }, false],
  ["unknown event on authorized ref", { event: "push", ref: allowedRef }, false],
  ["future recovery SHA", { ref: allowedRef, sha: "f".repeat(40) }, true],
]) {
  test(name, () => {
    const result = runGuard(scenario);
    assert.equal(result.status === 0, allowed, result.stderr);
    if (!allowed) assert.match(result.stderr, /DEV deployment refused: unauthorized source ref/);
  });
}

test("application staging block remains byte-identical to the pre-incident-safety workflow", () => {
  const start = workflow.indexOf("      - name: Stage DEV runtime and enforce checkpoint contracts\n");
  const end = workflow.indexOf("      - name: Verify Turso and auth secrets exist on DEV Worker\n", start);
  assert.ok(start >= 0 && end > start);
  const hash = createHash("sha256").update(workflow.slice(start, end)).digest("hex");
  assert.equal(hash, "c8e7c3e05cc839c47a38192c3c2df95e3dd510fcbc44f00098aa24951fce7d3d");
});
