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

test("only lower queue completed card uses daily HUB accumulation", () => {
  assert.match(
    patched,
    /completed:\s*state\.archiveRows\.filter\(isCompletedToday\)\.length/,
  );
  assert.doesNotMatch(
    patched,
    /if \(isCompletedToday\(row\)\) counts\.completed\+\+;/,
  );
  assert.match(
    patched,
    /"metric-completed",\s*state\.archiveRows\.filter\(\(row\) => isCompletedToday\(row\)\)\.length/,
  );
  assert.match(patched, /if \(isDestination\(row\) && key === "arrived"\) counts\.waiting\+\+;/);
  assert.match(patched, /if \(isDestination\(row\) && key === "unloading"\) counts\.unloading\+\+;/);
  assert.match(patched, /if \(isOrigin\(row\) && !queue\.done\) counts\.origin\+\+;/);
  assert.match(patched, /if \(isDrop\(row\) && !queue\.done\) counts\.drop\+\+;/);
});

test("KIT TBR arrival source block is shown for origin and destination only", () => {
  assert.match(
    patched,
    /function arrivalSources\(row\) \{\s*if \(!isDestination\(row\) && !isOrigin\(row\)\) return "";/,
  );
  assert.doesNotMatch(
    patched,
    /function arrivalSources\(row\) \{\s*if \(!isDestination\(row\)\) return "";/,
  );
  assert.match(patched, /เวลาถึงจากระบบ/);
  assert.match(patched, /scheduleKitArrivalAt/);
  assert.match(patched, /scheduleTbrArrivalAt/);
  assert.match(patched, /ใช้เวลาที่มาก่อน/);
});
