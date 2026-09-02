import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { patchDevMsArchive } from "../scripts/patch-dev-ms-archive.mjs";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("ms.js", root), "utf8");
const patched = patchDevMsArchive(source);

test("DEV page never auto-loads the heavy archive during live polling", () => {
  assert.match(patched, /pollMs:\s*4000/);
  assert.doesNotMatch(
    patched,
    /if \(!silent && !state\.archiveLoaded\) scheduleArchiveLoad\(\)/,
  );
  assert.match(
    patched,
    /state\.queue === "all" \|\| state\.queue === "completed"/,
  );
  assert.match(
    patched,
    /if \(!\(await ensureArchiveLoaded\(true\)\)\)/,
  );
  assert.match(patched, /async function ensureArchiveLoaded/);
  assert.match(patched, /metric-archive"\)\.textContent = "กดดู"/);
});

test("only completed metric is daily; other upper metric logic stays unchanged", () => {
  assert.match(
    patched,
    /"metric-completed",\s*state\.archiveRows\.filter\(\(row\) => isCompletedToday\(row\)\)\.length/,
  );
  assert.match(patched, /destinations = state\.archiveRows\.filter\(isDestination\)/);
  assert.match(patched, /origins = state\.archiveRows\.filter\(isOrigin\)/);
  assert.match(patched, /arrivals = destinations\.map\(\(row\) => punctuality\(row\)\)/);
  assert.match(patched, /releases = origins\.map\(\(row\) => punctuality\(row\)\)/);
  assert.match(
    patched,
    /if \(isCompletedToday\(row\)\) counts\.completed\+\+;/,
  );
});
