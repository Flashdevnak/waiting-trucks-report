import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevConnectorAdoption } from "./patch-ms-connector-adoption.mjs";

const root = new URL("../../", import.meta.url);
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const workflow = await readFile(
  new URL(".github/workflows/deploy-worker-dev.yml", root),
  "utf8",
);
const stage = await readFile(
  new URL(".github/dev-tools/stage-dev-runtime.mjs", root),
  "utf8",
);
const worker = patchDevConnectorAdoption(workerSource);

test("connector adoption is disabled unless a cutover-only secret exists", () => {
  assert.match(worker, /CONNECTOR_BOOTSTRAP_SECRET/);
  assert.match(worker, /CONNECTOR_BOOTSTRAP_DISABLED/);
  assert.match(worker, /bootstrapConnector\(body, env\)/);
  assert.match(
    worker,
    /await equal\(\s*await sha256\(suppliedSecret\),\s*await sha256\(configuredSecret\)/,
  );
});

test("connector adoption requires an existing MS connection and never replaces an active token", () => {
  assert.match(worker, /SELECT hub FROM ms_connections WHERE hub=\?/);
  assert.match(worker, /MS_NOT_CONFIGURED/);
  assert.match(worker, /Number\(existing\?\.active\) === 1/);
  assert.match(worker, /CONNECTOR_ALREADY_ACTIVE/);
  assert.match(
    worker,
    /UPDATE ms_connector_tokens SET token_hash=\?,created_at=\?,last_used_at='',active=1 WHERE hub=\? AND active<>1/,
  );
  assert.match(worker, /INSERT OR IGNORE INTO ms_connector_tokens/);
});

test("same connector token is idempotent and adoption does not trigger an MS refresh", () => {
  assert.match(worker, /alreadyRegistered: true/);
  assert.match(worker, /adopted: true, alreadyRegistered: false/);
  const start = worker.indexOf("async function bootstrapConnector");
  const end = worker.indexOf("async function connectorSync", start);
  const block = worker.slice(start, end);
  assert.doesNotMatch(block, /refreshMsIfStale|runMsRefresh|readMsRoutes/);
});

test("DEV deploy stages connector adoption before syntax validation", () => {
  assert.match(workflow, /ms-connector-adoption\.test\.mjs/);
  assert.match(workflow, /stage-dev-runtime\.mjs \.dev-assets\/ms\.js src\/index\.js/);
  assert.match(stage, /patchDevConnectorAdoption/);
  assert.match(stage, /output = patchDevConnectorAdoption\(output\)/);
  assert.match(workflow, /node --check src\/index\.js/);
});
