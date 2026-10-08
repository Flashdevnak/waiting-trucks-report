import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../workflows/deploy-worker-dev.yml", import.meta.url), "utf8");
const allowedRefs = [
  "refs/heads/codex/dev-recovery-contract-v2",
  "refs/heads/codex/dev-ms-late-settle-provenance-v1",
  "refs/heads/codex/dev-lh-manifest-accepted-truth-adaptive-refresh-v1",
  "refs/heads/codex/dev-ms-turso-critical-path-phase-provenance-v1",
];
const [allowedRef, isolatedRef] = allowedRefs;
const lhRef = allowedRefs[2];
const phaseRef = allowedRefs[3];
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

const deployExpression = deploy.text.match(/if: \$\{\{ (.*?) \}\}/)?.[1];
assert.ok(deployExpression, "deploy condition missing");
// Evaluate only this closed boolean grammar; no Actions functions or loose ref matching.
assert.match(deployExpression, /^github\.event_name == 'workflow_dispatch' && \(github\.ref == 'refs\/heads\/codex\/dev-recovery-contract-v2' \|\| github\.ref == 'refs\/heads\/codex\/dev-ms-late-settle-provenance-v1' \|\| github\.ref == 'refs\/heads\/codex\/dev-lh-manifest-accepted-truth-adaptive-refresh-v1' \|\| github\.ref == 'refs\/heads\/codex\/dev-ms-turso-critical-path-phase-provenance-v1'\)$/);
const evaluateDeploy = new Function("github", `return (${deployExpression});`);
function deployAllowed({ event = "workflow_dispatch", ref, refName = "", sha = "a".repeat(40) }) {
  return evaluateDeploy({ event_name: event, ref, ref_name: refName, sha });
}

test("shell guard and deploy gate authorize exactly the same four full refs", () => {
  const refs = text => [...new Set([...text.matchAll(/refs\/heads\/codex\/[a-z0-9-]+/g)].map(match => match[0]))].sort();
  assert.deepEqual(refs(guardScript), [...allowedRefs].sort());
  assert.deepEqual(refs(deployExpression), [...allowedRefs].sort());
  assert.doesNotMatch(guardScript + deployExpression, /contains\(|startsWith\(|codex\/\*|GITHUB_REF_NAME/);
  for (const ref of allowedRefs) for (const sha of ["0".repeat(40), "f".repeat(40)]) {
    assert.equal(runGuard({ ref, sha }).status, 0);
    assert.equal(deployAllowed({ ref, sha }), true);
  }
});

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
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow.slice(0, stepsStart), /(?:contents|actions|id-token):\s*(?:write|read-all)/);
  assert.ok(guard.start < workflow.indexOf("      - uses: actions/checkout@v4"));
  assert.ok(guard.start < deploy.start);
  assert.ok(workflow.includes("      - name: Verify DEV ref guard contract\n        run: node --test ../.github/dev-tools/dev-deploy-ref-guard.test.mjs"));
  assert.ok(workflow.indexOf("      - name: Verify DEV ref guard contract") < deploy.start);
  assert.ok(deploy.text.includes("        if: ${{ github.event_name == 'workflow_dispatch' && (github.ref == 'refs/heads/codex/dev-recovery-contract-v2' || github.ref == 'refs/heads/codex/dev-ms-late-settle-provenance-v1' || github.ref == 'refs/heads/codex/dev-lh-manifest-accepted-truth-adaptive-refresh-v1' || github.ref == 'refs/heads/codex/dev-ms-turso-critical-path-phase-provenance-v1') }}"));
  assert.match(deploy.text, /run: npx wrangler deploy \.dev-runtime\/src\/turso-index\.js --config wrangler\.dev\.jsonc/);
  assert.equal((workflow.match(/wrangler deploy /g) || []).length, 1);
  assert.doesNotMatch(workflow.slice(0, deploy.start), /\bwrangler\s+(?:deploy|secret\s+(?:put|delete))\b|cloudflare\/wrangler-action@/i);
});

for (const [name, scenario, allowed] of [
  ["incident #719 manual main", { ref: "refs/heads/main", refName: "main", sha: "3591527c1c3bc25a1731f46a82529d684e25be05" }, false],
  ["main push", { event: "push", ref: "refs/heads/main", refName: "main" }, false],
  ["ref_name cannot bypass full-ref validation", { ref: "refs/heads/main", refName: "codex/dev-recovery-contract-v2" }, false],
  ["authorized recovery dispatch", { ref: allowedRef, refName: "codex/dev-recovery-contract-v2" }, true],
  ["authorized isolated MS dispatch", { ref: isolatedRef }, true],
  ["authorized LH manifest dispatch", { ref: lhRef }, true],
  ["authorized MS Turso phase diagnostic dispatch", { ref: phaseRef }, true],
  ["unreviewed codex branch", { ref: "refs/heads/codex/unreviewed" }, false],
  ["isolated ref_name cannot spoof main", { ref: "refs/heads/main", refName: "codex/dev-ms-late-settle-provenance-v1" }, false],
  ["isolated ref_name cannot spoof empty ref", { ref: "", refName: "codex/dev-ms-late-settle-provenance-v1" }, false],
  ["LH ref_name cannot spoof main", { ref: "refs/heads/main", refName: "codex/dev-lh-manifest-accepted-truth-adaptive-refresh-v1" }, false],
  ["LH ref_name cannot spoof empty ref", { ref: "", refName: "codex/dev-lh-manifest-accepted-truth-adaptive-refresh-v1" }, false],
  ["phase ref_name cannot spoof main", { ref: "refs/heads/main", refName: "codex/dev-ms-turso-critical-path-phase-provenance-v1" }, false],
  ["phase ref_name cannot spoof empty ref", { ref: "", refName: "codex/dev-ms-turso-critical-path-phase-provenance-v1" }, false],
  ["authorized ref prefix is rejected", { ref: isolatedRef + "-other" }, false],
  ["authorized ref trailing slash is rejected", { ref: isolatedRef + "/extra" }, false],
  ["authorized ref newline is rejected", { ref: isolatedRef + "\n" }, false],
  ["LH ref prefix is rejected", { ref: lhRef + "-other" }, false],
  ["LH ref trailing slash is rejected", { ref: lhRef + "/extra" }, false],
  ["LH ref newline is rejected", { ref: lhRef + "\n" }, false],
  ["phase ref prefix lookalike is rejected", { ref: phaseRef + "-extra" }, false],
  ["phase ref suffix lookalike is rejected", { ref: phaseRef + "-other" }, false],
  ["phase ref trailing slash is rejected", { ref: phaseRef + "/extra" }, false],
  ["phase ref newline injection is rejected", { ref: phaseRef + "\n" }, false],
  ["unexpected feature branch", { ref: "refs/heads/feature/unreviewed" }, false],
  ["tag", { ref: "refs/tags/example" }, false],
  ["PR merge ref", { ref: "refs/pull/123/merge" }, false],
  ["empty ref", { ref: "" }, false],
  ["malformed ref", { ref: "main" }, false],
  ["push on recovery", { event: "push", ref: allowedRef }, false],
  ["push on isolated MS", { event: "push", ref: isolatedRef }, false],
  ["push on LH manifest", { event: "push", ref: lhRef }, false],
  ["push on phase diagnostic", { event: "push", ref: phaseRef }, false],
  ["pull_request event rejected", { event: "pull_request", ref: phaseRef }, false],
  ["workflow_run event rejected", { event: "workflow_run", ref: phaseRef }, false],
  ["schedule event rejected", { event: "schedule", ref: phaseRef }, false],
  ["unknown event on recovery", { event: "unknown", ref: allowedRef }, false],
  ["unknown event rejected on phase diagnostic", { event: "unknown", ref: phaseRef }, false],
  ["unknown event on isolated MS", { event: "unknown", ref: isolatedRef }, false],
  ["empty event on isolated MS", { event: "", ref: isolatedRef }, false],
  ["future recovery SHA", { ref: allowedRef, sha: "f".repeat(40) }, true],
  ["future isolated MS SHA", { ref: isolatedRef, sha: "f".repeat(40) }, true],
  ["future LH manifest SHA", { ref: lhRef, sha: "f".repeat(40) }, true],
  ["future phase diagnostic SHA", { ref: phaseRef, sha: "f".repeat(40) }, true],
]) {
  test(name, () => {
    const result = runGuard(scenario);
    assert.equal(result.status === 0, allowed, result.stderr);
    if (!allowed) assert.match(result.stderr, /DEV deployment refused: unauthorized source ref/);
    assert.equal(deployAllowed(scenario), allowed, "deploy condition must match shell authorization");
  });
}

test("application staging block matches the reviewed DEV CSS asset contract", () => {
  const start = workflow.indexOf("      - name: Stage DEV runtime and enforce checkpoint contracts\n");
  const end = workflow.indexOf("      - name: Verify Turso and auth secrets exist on DEV Worker\n", start);
  assert.ok(start >= 0 && end > start);
  const hash = createHash("sha256").update(workflow.slice(start, end)).digest("hex");
  assert.equal(hash, "891bd54322f4f7adb4f13721a5a59aa5e802cc79fad2c065ea2a788f3e541e16");
});
