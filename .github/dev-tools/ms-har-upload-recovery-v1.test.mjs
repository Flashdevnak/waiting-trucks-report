import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { stageFrontend, stageWorker } from "./stage-dev-runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("HAR upload validation is truthful and local mistakes do not create incidents", async () => {
  const source = await readFile(join(root, "ms.js"), "utf8");
  const staged = stageFrontend(source);

  assert.match(staged, /LOCAL_NO_FILE/);
  assert.match(staged, /กรุณาเลือกไฟล์ HAR ก่อนกดบันทึก/);
  assert.match(staged, /LOCAL_FILE_TOO_LARGE/);
  assert.match(staged, /ไฟล์ HAR มีขนาดเกิน/);
  assert.match(staged, /apiError\.code = String\(json\.code \|\| "MS_CONNECTION_ERROR"\)/);
  assert.match(staged, /event === "error" && \(!rawCode \|\| rawCode\.startsWith\("LOCAL_"\)\)/);
  assert.match(staged, /ไฟล์ HAR อ่านได้ แต่ Session ในไฟล์ถูก MS ปฏิเสธ \(401\)/);
  assert.match(staged, /Session ใหม่เชื่อมต่อสำเร็จ/);
});

test("fresh valid Route HAR clears stale 401 cooldown and coordinator credential cache immediately", async () => {
  const source = await readFile(join(root, "worker", "src", "index.js"), "utf8");
  const staged = stageWorker(source);

  assert.match(staged, /MS_REPAIR_POLICY_VERSION = 6/);
  assert.match(staged, /https:\/\/ms-refresh\.internal\/credential-adopted/);
  assert.match(staged, /async resetAfterCredentialAdoption/);
  assert.match(staged, /this\.lastResult = null/);
  assert.match(staged, /this\.recentUntil = 0/);
  assert.match(staged, /this\.lastSourceAt = 0/);
  assert.match(staged, /nextRetryAt: 0/);
  assert.match(staged, /await notifyMsCredentialAdopted\(env, hub\)/);

  const adoptionStart = staged.indexOf('if (url.pathname === "/credential-adopted")');
  const adoptionEnd = staged.indexOf('if (url.pathname === "/repair-health")', adoptionStart);
  assert.ok(adoptionStart >= 0 && adoptionEnd > adoptionStart, "credential adoption route must be staged");
  const adoptionBody = staged.slice(adoptionStart, adoptionEnd);
  assert.match(adoptionBody, /msCredentialCache\.delete\(branch\)/);

  const resetStart = staged.indexOf("async resetAfterCredentialAdoption");
  const resetEnd = staged.indexOf("async fetch(request)", resetStart);
  assert.ok(resetStart >= 0 && resetEnd > resetStart, "credential reset method must be staged");
  const resetBody = staged.slice(resetStart, resetEnd);
  assert.doesNotMatch(resetBody, /runMsRefresh|refreshMsIfStale|\.refresh\(/);
});
