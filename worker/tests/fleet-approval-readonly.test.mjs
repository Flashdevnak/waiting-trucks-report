// Offline only: node --test tests/fleet-approval-readonly.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  fleetReadEnabled,
  buildFleetProviderBody,
  validateFleetPageQuery,
  normalizeFleetProviderResponse,
  readFleetApprovalPage,
} from "../src/fleet-approval-readonly.js";

const q = (source, status) => ({source,start:"2026-10-06",end:"2026-10-12",page:1,status});
test("default off; exact explicit switch only", () => {
  assert.equal(fleetReadEnabled({}), false);
  assert.equal(fleetReadEnabled({FLEET_APPROVAL_READ_ENABLED:"true"}), false);
  assert.equal(fleetReadEnabled({FLEET_APPROVAL_READ_ENABLED:"1"}), true);
});
test("HAR audit and monitor request fields stay distinct", () => {
  const a=buildFleetProviderBody(q("audit","1"));
  assert.deepEqual(a.status,[1]); assert.equal(a.page_size,20);
  assert.equal(a.apply_start_date,"2026-10-06 00:00:00");
  assert.equal(a.apply_end_date,"2026-10-12 23:59:59");
  assert.equal("states" in a,false);
  const m=buildFleetProviderBody(q("monitor","9"));
  assert.deepEqual(m.states,[9]); assert.equal(m.page_num,1);
  assert.equal("status" in m,false);
});
test("reject unknown endpoint, invalid dates, pages, and unsupported codes before fetch", () => {
  for (const bad of [
    q("other","1"),{...q("audit","1"),start:"2026-02-30"},
    {...q("audit","1"),end:"2026-12-01"},
    {...q("monitor","9"),page:0},
    {...q("audit","8")},{...q("monitor","2")},
  ]) {
    assert.throws(()=>validateFleetPageQuery(bad));
  }
});
test("monitor status nine is not an approval event", () => {
  const response=normalizeFleetProviderResponse({
    code:1,data:{items:[{
      serial_no:"VA2026101123590000138",audit_id:3311689,
      start_store_name:"02 NE1_HUB-นครราชสีมา",end_store_name:"11 NE4_HUB-อุบลราชธานี",
      status:9,status_text:"ระหว่างแข่งขันรับงาน",type:0,type_text:"LH",
      submitter_id:"PRIVATE",sessionId:"PRIVATE"
    }],pagination:{total_count:1}}
  },"monitor",1);
  assert.equal(response.items[0].workCode,"9");
  assert.equal(response.items[0].approvalCode,"");
  assert.equal(response.items[0].routeTypeText,"LH");
  assert.equal(response.sourceScope,"MS_SESSION_VISIBLE_ONLY");
  assert.equal(response.completeness,"PAGE_ONLY");
  assert.equal(response.approvalTimeline,"NOT_CAPTURED");
  assert.equal(JSON.stringify(response).includes("PRIVATE"),false);
});
test("audit status two is not an operation event", () => {
  const response=normalizeFleetProviderResponse({
    code:1,data:{items:[{serial_no:"VA-1",status:2,status_text:"อนุมัติ"}],pagination:{total_count:1}}
  },"audit",1);
  assert.equal(response.items[0].approvalCode,"2");
  assert.equal(response.items[0].workCode,"");
});
test("one explicit call makes exactly one allowlisted MS POST with bounded query", async () => {
  let calls=0;
  const mock=async (url,init)=>{
    calls++;
    assert.equal(url,"https://ms-api.flashexpress.com/gw/nws/staff/ms/fleet/line/approve/monitor/list/find");
    assert.equal(init.method,"POST");
    assert.equal(JSON.parse(init.body).page_size,20);
    return {ok:true,status:200,json:async()=>({code:1,data:{items:[],pagination:{total_count:0}}})};
  };
  const result=await readFleetApprovalPage(q("monitor","9"),
    {sessionId:"test-secret",deviceId:"test-device"},
    ()=>({"X-FLE-SESSION-ID":"test-secret","X-DEVICE-ID":"test-device"}),mock);
  assert.equal(calls,1);
  assert.equal(result.total,0);
  assert.equal(JSON.stringify(result).includes("test-secret"),false);
});
test("403 is failure and never retries", async () => {
  let calls=0;
  await assert.rejects(()=>readFleetApprovalPage(q("audit","1"),
    {sessionId:"s",deviceId:"d"},()=>({}),async()=>{calls++;return{ok:false,status:403};}),
    {code:"FLEET_MS_ACCESS_DENIED"});
  assert.equal(calls,1);
});
test("empty or oversized result fails closed", () => {
  assert.throws(()=>normalizeFleetProviderResponse({code:1,data:{}},"audit",1));
  assert.throws(()=>normalizeFleetProviderResponse({code:1,data:{items:Array.from({length:21},()=>({}))}},"audit",1));
});
