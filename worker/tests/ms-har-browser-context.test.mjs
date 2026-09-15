import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frontend = fs.readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("HAR upload preserves minimal browser context without uploading raw HAR", () => {
  assert.match(frontend, /MS_HAR_BROWSER_CONTEXT_V1/);
  assert.match(frontend, /browserContext/);
  for (const header of ["user-agent", "accept-language", "sec-ch-ua", "cookie"])
    assert.ok(frontend.includes(`"${header}"`), header);
  assert.match(frontend, /state\.msHarBrowserContext = \{ deviceId, value: browserContext \}/);
  assert.match(frontend, /body\.browserContext = state\.msHarBrowserContext\.value/);
  assert.match(frontend, /apiPost\("saveMsConnection"/);
});

test("DEV Worker replays allowlisted context and keeps old device-only rows compatible", () => {
  assert.match(worker, /MS_HAR_BROWSER_CONTEXT_V1/);
  assert.match(worker, /normalizeMsBrowserContext/);
  assert.match(worker, /msBrowserRequestHeaders/);
  assert.match(worker, /JSON\.stringify\(\{ v: 2, deviceId, browserContext: normalizedBrowserContext \}\)/);
  assert.match(worker, /const envelope = JSON\.parse\(deviceId\);/);
  assert.match(worker, /"X-DEVICE-ID": deviceId/);
  assert.match(worker, /deviceId: await decryptMs\(row\.device_cipher, env\)/);
  assert.match(worker, /context\["user-agent"\] \|\| "Mozilla\/5\.0"/);
});
