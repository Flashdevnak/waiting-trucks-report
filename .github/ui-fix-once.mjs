import fs from 'node:fs';

function replaceOnce(path, oldText, newText, label) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, got ${count}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replaceOnce(
  'ms-v4.css',
  `  .ms-page .compact-card-head .local-route-barcode:has(.local-barcode-panel:not(.hidden)) { grid-column: 1 / -1 !important; width: 100% !important; margin-top: 4px; }\n  .ms-page .compact-card-head .local-route-barcode:has(.local-barcode-panel:not(.hidden)) .local-barcode-toggle { width: min(100%, 220px); align-self: center; }\n  .ms-page .compact-card-head .local-barcode-panel { align-self: stretch; width: 100%; }`,
  `  /* Keep the toggle in its original header cell; only the opened barcode panel spans the card. */\n  .ms-page .compact-card-head:has(.expected-parcels-badge) .local-route-barcode { display: contents; }\n  .ms-page .compact-card-head:has(.expected-parcels-badge) .local-route-barcode .local-barcode-toggle {\n    grid-column: 2;\n    width: 100%;\n    margin: 2px 0 0;\n    align-self: stretch;\n  }\n  .ms-page .compact-card-head:has(.expected-parcels-badge) .local-route-barcode .local-barcode-panel {\n    grid-column: 1 / -1;\n    width: 100%;\n    margin-top: 7px;\n    align-self: stretch;\n  }\n  .ms-page .compact-card-head:not(:has(.expected-parcels-badge)) .local-route-barcode:has(.local-barcode-panel:not(.hidden)) {\n    grid-column: 1 / -1 !important;\n    width: 100% !important;\n    margin-top: 4px;\n  }\n  .ms-page .compact-card-head:not(:has(.expected-parcels-badge)) .local-route-barcode:has(.local-barcode-panel:not(.hidden)) .local-barcode-toggle {\n    width: min(100%, 220px);\n    align-self: center;\n  }`,
  'mobile barcode position',
);

replaceOnce(
  'ms-v4.css',
  `.truck-photo-empty { display: flex; min-height: 150px; align-items: center; justify-content: center; padding: 18px; text-align: center; color: #5b6064; }`,
  `.truck-photo-empty { display: flex; min-height: 150px; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 18px; text-align: center; color: #5b6064; }`,
  'HBI error panel layout',
);

replaceOnce(
  'ms.js',
  `  } catch (error) {\n    body.innerHTML = \`<div class="truck-photo-empty is-error">\${esc(error.message || "โหลดรูปท้ายรถไม่สำเร็จ")}</div>\`;\n  }\n}\n\nfunction tableRow(row) {`,
  `  } catch (error) {\n    if (error?.code === "HBI_PHOTO_SESSION_EXPIRED") {\n      body.innerHTML = \`<div class="truck-photo-empty is-error"><strong>Session รูปท้ายรถหมดอายุ</strong><span>ต้องเชื่อมต่อ HBI ใหม่ก่อนดูรูป · Route และข้อมูลเรียลไทม์ยังทำงานตามปกติ</span><button type="button" class="btn btn-accent" data-hbi-session-reconnect>เชื่อมต่อรูปท้ายรถใหม่</button></div>\`;\n      const reconnect = body.querySelector("[data-hbi-session-reconnect]");\n      if (reconnect) reconnect.onclick = () => {\n        if (dialog.open) dialog.close();\n        openMsConnection();\n        setTimeout(() => el("ms-har-hbi-photos")?.focus(), 0);\n      };\n      return;\n    }\n    body.innerHTML = \`<div class="truck-photo-empty is-error">\${esc(error.message || "โหลดรูปท้ายรถไม่สำเร็จ")}</div>\`;\n  }\n}\n\nfunction tableRow(row) {`,
  'HBI session-expired UX',
);

const testPath = 'worker/tests/hbi-truck-photos.test.mjs';
let tests = fs.readFileSync(testPath, 'utf8');
const apiAnchor = `  assert.match(front, /apiGetOnce\\("msTruckPhotos"/);\n  assert.doesNotMatch(front, /apiGet\\("msTruckPhotos"/);`;
if ((tests.split(apiAnchor).length - 1) !== 1) throw new Error('HBI frontend test anchor changed');
tests = tests.replace(
  apiAnchor,
  `${apiAnchor}\n  assert.match(front, /HBI_PHOTO_SESSION_EXPIRED/);\n  assert.match(front, /data-hbi-session-reconnect/);`,
);
const insertBefore = `test("worker keeps HBI out of live refresh and caps each cold click at one page", () => {`;
if ((tests.split(insertBefore).length - 1) !== 1) throw new Error('HBI worker test anchor changed');
const barcodeTest = `test("mobile barcode toggle stays in its original cell when panel opens", () => {\n  const style = fs.readFileSync(new URL("../../ms-v4.css", import.meta.url), "utf8");\n  assert.match(style, /compact-card-head:has\\(\\.expected-parcels-badge\\) \\.local-route-barcode \\{ display: contents; \\}/);\n  assert.match(style, /local-route-barcode \\.local-barcode-toggle \\{[\\s\\S]*?grid-column: 2;/);\n  assert.match(style, /local-route-barcode \\.local-barcode-panel \\{[\\s\\S]*?grid-column: 1 \\/ -1;/);\n});\n\n`;
tests = tests.replace(insertBefore, barcodeTest + insertBefore);
fs.writeFileSync(testPath, tests);

console.log('SOURCE_UI_FIX=APPLIED');
