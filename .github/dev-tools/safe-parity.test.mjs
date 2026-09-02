import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const page = await readFile(new URL(".github/dev-tools/safe-parity.html", root), "utf8");
const workflow = await readFile(new URL(".github/workflows/deploy-worker-dev.yml", root), "utf8");

test("Safe parity blocks every heavy or mutating MS read path", () => {
  assert.match(page, /const FORBIDDEN = new Set\(\["msRoutes","msArchive","msRange","preEntryTrips","pendingParcels"\]\)/);
  assert.match(page, /if \(FORBIDDEN\.has\(action\)\) throw new Error/);
  assert.doesNotMatch(page, /\["msRoutes",\s*\{/);
  assert.doesNotMatch(page, /\["msArchive",\s*\{/);
  assert.doesNotMatch(page, /\["msRange",\s*\{/);
  assert.doesNotMatch(page, /\["preEntryTrips",\s*\{/);
  assert.doesNotMatch(page, /\["pendingParcels",\s*\{/);
});

test("Safe parity uses separate OLD and DEV login sessions without persisting the PIN", () => {
  assert.match(page, /waiting-trucks-report\.alert-squid-6738\.chatgpt\.site\/api/);
  assert.match(page, /const DEV_API = `\$\{window\.location\.origin\}\/api`/);
  assert.match(page, /login\(OLD_API, username, pin\), login\(DEV_API, username, pin\)/);
  assert.doesNotMatch(page, /localStorage\.setItem/);
  assert.match(page, /\$\("pin"\)\.value = ""/);
});

test("Default parity contract stays lightweight and read-only after authentication", () => {
  assert.match(page, /\["list", \{\}\]/);
  assert.match(page, /\["settings", \{ branch: hub \}\]/);
  assert.match(page, /\["msConnectionStatus", \{ branch: hub \}\]/);
  assert.match(page, /include-history/);
  assert.match(page, /include-ms-history/);
});

test("DEV deployment publishes Safe Parity only in staged assets", () => {
  assert.match(workflow, /safe-parity\.test\.mjs/);
  assert.match(workflow, /\.\.\/\.github\/dev-tools\/safe-parity\.html \.dev-assets\/safe-parity\.html/);
  assert.doesNotMatch(workflow, /cp .*safe-parity\.html \.\.\//);
});
