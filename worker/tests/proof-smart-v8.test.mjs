// PROOF_PRINT_HAR_V9_DEPLOY_CHECKPOINT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const root=new URL('../../',import.meta.url);
const get=path=>readFile(new URL(path,root),'utf8');
const [core,ui,actions,plate,editor,proofUi]=await Promise.all([get('proof-v2-core.js'),get('proof-v2-ui.js'),get('proof-v2-actions.js'),get('worker/src/proof-plate-search-v5.js'),get('worker/src/proof-editor.js'),get('worker/src/proof-ui-v5.js')]);
test('Proof Smart V8 search/HAR stays quota-safe',()=>{
  assert.match(core,/pollMs:60_000/);
  assert.match(ui,/PROOF_SMART_SEARCH_V8/);
  assert.match(actions,/PROOF_EDITOR_SEARCH_CACHE_V8/);
  assert.match(actions,/กด Enter หรือปุ่ม “ค้นหา”/);
  assert.match(plate,/PROOF_PLATE_SEARCH_V8/);
  assert.match(plate,/pageSize:'50'/);
  assert.match(editor,/PROOF_DRIVER_SEARCH_V8/);
  assert.match(proofUi,/PROOF_SMART_V8/);
  assert.match(proofUi,/HAR เป็นไฟล์เดียวกัน/);
  assert.match(proofUi,/entries.*reverse/);
  assert.match(proofUi,/PROOF_PRINT_HAR_UPLOAD_V9/);
  assert.match(proofUi,/PROOF_PRINT_HAR_POLISH_V9_1/);
  assert.match(proofUi,/HAR บันทึกแล้วและ Proof Session ใช้งานได้/);
  assert.match(proofUi,/#proof-print-har-file-name/);
  assert.match(proofUi,/HAR สำหรับปริ้นบาร์โค้ดรถ/);
  assert.match(proofUi,/proof-print-har-save/);
  assert.match(proofUi,/HAR เส้นทาง MS/);
  assert.match(proofUi,/saveMsConnection/);
  assert.doesNotMatch(plate,/setInterval|scheduled|cron/i);
  assert.doesNotMatch(editor,/cancel_car/);
});
