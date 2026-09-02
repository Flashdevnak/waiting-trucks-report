import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  frontendHasIntegratedDevRuntime,
  stageFrontend,
  stageWorker,
} from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const frontendSource = await readFile(new URL("ms.js", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const workflow = await readFile(
  new URL(".github/workflows/deploy-worker-dev.yml", root),
  "utf8",
);

test("DEV staging integrates root frontend once and is idempotent after cutover", () => {
  const first = stageFrontend(frontendSource);
  assert.equal(frontendHasIntegratedDevRuntime(first), true);
  const second = stageFrontend(first);
  assert.equal(second, first);
});

test("DEV staging still assembles all backend runtime patches from clean source", () => {
  const worker = stageWorker(workerSource);
  assert.match(worker, /export class MsRefreshCoordinator/);
  assert.match(worker, /bootstrapConnector\(body, env\)/);
  assert.match(worker, /acquireMsSyncClaim/);
  assert.match(worker, /UPSTREAM_FETCH_TIMEOUT_MS = 9000/);
  assert.match(worker, /msCompletedToday/);
});

test("DEV deploy uses the idempotent staging entrypoint", () => {
  assert.match(workflow, /stage-dev-runtime\.test\.mjs/);
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
  assert.doesNotMatch(
    workflow,
    /node scripts\/patch-dev-ms-archive\.mjs \.dev-assets\/ms\.js src\/index\.js/,
  );
});
