import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stageFrontend } from "./stage-dev-runtime.mjs";

const frontend = () => stageFrontend(readFileSync(new URL("../../ms.js", import.meta.url), "utf8"));
const stagedWorker = () => readFileSync(new URL("../../worker/.dev-runtime/src/index.js", import.meta.url), "utf8");

test("normal staged UI and Worker have no active exact-history acquisition path", () => {
  const front = frontend();
  const worker = stagedWorker();
  assert.match(front, /function pnoInboundRender\(rows\)/);
  assert.match(front, /async function pnoInboundLoad\(page\)/);
  assert.match(worker, /observePnoEvidencePage\(/);
  for (const source of [front, worker]) {
    assert.doesNotMatch(source, /pendingPnoHistory|pnoExactHistoryCheck|\/pno\/history|\/api\/route\/curl_pno/);
    assert.doesNotMatch(source, /data-pno-history|CONFIRMED_MISSED_SCAN/);
  }
  assert.doesNotMatch(front, /ตรวจประวัติ|สงสัยหลุดสแกนเข้า/);
  assert.match(front, /หลุดสแกนเข้า/);
});

test("5,000 eligible gap rows render with zero history or provider requests", () => {
  const front = frontend();
  const actionStart = front.indexOf("function pnoV18ParcelAction(");
  const actionEnd = front.indexOf("\n}\n", actionStart) + 2;
  const renderer = front.slice(actionStart, actionEnd) + "\n" + front.slice(front.indexOf("function pnoInboundRender(rows) {"),
    front.indexOf("async function pnoInboundLoad(page) {"));
  assert.doesNotMatch(renderer, /apiGet|fetch\(|curl_pno|pnoExactHistory/);
  const list = { innerHTML: "" };
  const render = new Function("el", "esc", `${renderer}; return pnoInboundRender;`)(
    () => list, (value) => String(value));
  render(Array.from({ length: 5000 }, (_, index) => ({
    pno: `TEST_${index}`, scanEvidence: { classification: "SUSPECTED_SCAN_IN_GAP",
      reason: "SCAN_IN_STATE_ABSENT_AT_REQUIRED_STAGE" },
  })));
  assert.match(list.innerHTML, /เฉพาะหน้านี้: ยืนยันว่าหลุดสแกนเข้า 5000 · ยังตรวจสแกนเข้าไม่ได้ 0/);
  assert.equal((list.innerHTML.match(/หลุดสแกนเข้า/g) || []).length, 10_002,
    "two labels per row plus the page summary and the section heading");
  assert.doesNotMatch(list.innerHTML, /ตรวจประวัติ|data-pno-history/);
});

test("modal, gap load, reload and ordinary controls cannot route to exact history", () => {
  const front = frontend();
  const worker = stagedWorker();
  const gapLoad = front.slice(front.indexOf("async function pnoInboundLoad(page) {"),
    front.indexOf("function pnoV18SetActive(type)"));
  assert.match(gapLoad, /pnoV18Fetch\("total", pnoV18State\.page\)/);
  assert.doesNotMatch(gapLoad, /pendingPnoHistory|pnoExactHistory|curl_pno/);
  for (const operation of ["modal open", "scan-gap open", "filter", "copy", "LINE copy",
    "export", "reload", "modal reopen"]) {
    assert.equal((front.match(/pendingPnoHistory/g) || []).length, 0, operation);
    assert.equal((worker.match(/\/pno\/history|curl_pno/g) || []).length, 0, operation);
  }
});
