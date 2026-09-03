import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageFrontend, stageStyle, stageWorker } from "../../.github/dev-tools/stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const styleSource = await readFile(new URL("style.css", root), "utf8");
const workerSource = await readFile(new URL("worker/src/index.js", root), "utf8");
const staged = stageFrontend(source);
const stagedStyle = stageStyle(styleSource);
const stagedWorker = stageWorker(workerSource);

test("DEV live polling keeps archive lazy", () => {
  assert.match(staged, /pollMs:\s*4000/);
  assert.match(staged, /async function ensureArchiveLoaded/);
  assert.match(staged, /DEV: archive stays lazy; live polling must never auto-read msArchive/);
  assert.doesNotMatch(staged, /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/);
  assert.match(staged, /queueMode === "completed"/);
  assert.match(staged, /state\.archiveView/);
});

test("completed summary stays lightweight and stable", () => {
  assert.match(staged, /apiGet\("msCompletedToday", \{ branch: state\.branch \}\)/);
  assert.match(staged, /const preserveObservedCompletion =/);
  assert.match(staged, /completedRows/);
  assert.match(staged, /isCompletedToday\(row\)/);
});

test("staged worker keeps completion cache support without schema DDL", () => {
  assert.match(stagedWorker, /action === "msCompletedToday"/);
  assert.match(stagedWorker, /completedToday/);
  assert.match(stagedWorker, /completedRows/);
  assert.match(stagedWorker, /timeZone: "Asia\/Bangkok"/);
  assert.doesNotMatch(stagedWorker, /CREATE TABLE|ALTER TABLE/);
});

test("staged mobile style remains idempotent", () => {
  assert.match(stagedStyle, /DEV mobile MS card spacing/);
  assert.match(stagedStyle, /MS route cancellation controls/);
  assert.match(stagedStyle, /@media \(max-width: 420px\)/);
  assert.equal(stageStyle(stagedStyle), stagedStyle);
});
