import { sendConnectorSync } from "../src/index.js";

class KV {
  constructor() { this.m = new Map(); }
  async get(key) { return this.m.get(key) ?? null; }
  async put(key, value) { this.m.set(key, value); }
}

const make = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

let busCalls = 0;
const DEV_API = {
  fetch: async (request) => {
    const body = await request.json();
    if (body.shadowPart === "routes") {
      return make({ ok: true, data: { rows: [{ proofId: "BUS-RETRY", attendanceType: "ปลายทาง", actualArrivalAt: "" }] } });
    }
    busCalls += 1;
    if (busCalls === 1) return make({ ok: false, code: "TBR_BUS_HTTP_503", message: "transient" }, 503);
    return make({ ok: true, data: { tbrShadowFeed: [{ proofId: "BUS-RETRY", scheduleTbrArrivalAt: "2026-09-05T23:00:00+07:00" }] } });
  },
};

const response = await sendConnectorSync({ STATE: new KV(), DEV_API }, "NE1", "connector-token");
const payload = await response.json();
if (!response.ok) throw new Error("transient Bus 503 still blanked the combined source");
if (busCalls !== 2) throw new Error(`Bus transient retry count mismatch: ${busCalls}`);
if (payload?.data?.rows?.length !== 1 || payload?.data?.tbrShadowFeed?.length !== 1) throw new Error("Bus retry did not preserve combined Route/TBR source");
if (payload?.data?.shadowQuota?.normalTursoPointReadsPerCron !== 4) throw new Error("steady-state Turso quota marker changed");
if (payload?.data?.shadowQuota?.tursoPointReadsPerCron !== 6) throw new Error("transient retry accounting must report 6 point reads for this failed-once case");
if (payload?.data?.shadowQuota?.tursoWritesPerCron !== 0) throw new Error("Bus retry must not add Turso writes");
console.log("TBR_BUS_503_RETRY=PASS");
console.log("TBR_BUS_RETRY_CALLS=2");
console.log("TBR_NORMAL_TURSO_POINT_READS=4");
console.log("TBR_TRANSIENT_POINT_READS=6");
console.log("TBR_TURSO_WRITES=0");
