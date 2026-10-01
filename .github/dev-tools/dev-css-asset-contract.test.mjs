import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../../ms.html", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../workflows/deploy-worker-dev.yml", import.meta.url), "utf8");
const expectedAsset = "ms-v4.css?v=20261001-01";

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `${name} step missing`);
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end < 0 ? undefined : end + 1);
}

test("staged and smoke DEV CSS contracts require the exact current MS asset", () => {
  assert.ok(html.includes(`href="${expectedAsset}"`));
  const stage = step("Stage DEV runtime and enforce checkpoint contracts");
  const smoke = step("Smoke DEV public pages and MS UI v4");
  assert.ok(stage.includes(`msHtml.includes('${expectedAsset}')`));
  assert.ok(smoke.includes(`const msV4Style='${expectedAsset}';`));
  assert.ok(smoke.includes('ms.includes(`href="${msV4Style}"`)'));
  assert.equal((workflow.match(/ms-v4\.css\?v=20260910-01/g) || []).length, 0);
  assert.equal((workflow.match(/ms-v4\.css\?v=20261001-01/g) || []).length, 2);
  assert.ok(stage.includes("style.css?v=20260905-dev-shell-v3"));
  assert.ok(smoke.includes("const style='style.css?v=20260905-dev-shell-v3';"));
});
