import fs from "node:fs";
import { sendConnectorSync, tbrBusSourceDays } from "../src/index.js";

class KV {
  constructor() { this.m = new Map(); }
  async get(key) { return this.m.get(key) ?? null; }
  async put(key, value) { this.m.set(key, value); }
}
const make = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

const early = Date.parse("2026-09-05T18:30:00Z");
const expectedDays = ["2026-09-05", "2026-09-06"];
if (JSON.stringify(tbrBusSourceDays(early)) !== JSON.stringify(expectedDays))
  throw new Error(`early Bus source days wrong: ${JSON.stringify(tbrBusSourceDays(early))}`);

const busDays = [];
let busActive = 0, maxBusActive = 0;
const DEV_API = {
  fetch: async (request) => {
    const body = await request.json();
    if (body.shadowPart === "routes") {
      return make({ ok: true, data: { rows: [{ proofId: "ROUTE-1", attendanceType: "ปลายทาง", actualArrivalAt: "" }] } });
    }
    if (body.shadowPart !== "bus") return make({ ok: false }, 400);
    busDays.push(body.shadowDay);
    busActive += 1;
    maxBusActive = Math.max(maxBusActive, busActive);
    await new Promise((resolve) => setTimeout(resolve, 8));
    busActive -= 1;
    return make({ ok: true, data: { tbrShadowFeed: [{ proofId: `BUS-${body.shadowDay}`, scheduleTbrArrivalAt: `${body.shadowDay}T01:00:00+07:00` }] } });
  },
};

const response = await sendConnectorSync({ STATE: new KV(), DEV_API }, "NE1", "connector-token", early);
const payload = await response.json();
if (!response.ok) throw new Error("daily Bus split failed");
if (JSON.stringify(busDays) !== JSON.stringify(expectedDays)) throw new Error(`Bus day calls wrong: ${JSON.stringify(busDays)}`);
if (maxBusActive !== 1) throw new Error(`Bus day calls must be sequential; max active=${maxBusActive}`);
if (payload?.data?.tbrShadowFeed?.length !== 2) throw new Error("daily Bus feeds were not merged");
if (payload?.data?.shadowQuota?.normalTursoPointReadsPerCron !== 4) throw new Error("single-day baseline changed");
if (payload?.data?.shadowQuota?.currentSteadyStateTursoPointReadsPerCron !== 6) throw new Error("early two-day steady-state accounting must be 6 point reads");
if (payload?.data?.shadowQuota?.tursoPointReadsPerCron !== 6) throw new Error("actual early read accounting must be 6 without retries");
if (payload?.data?.shadowQuota?.tursoWritesPerCron !== 0) throw new Error("daily split must keep Turso writes at zero");
const split = fs.readFileSync(new URL("./patch-dev-tbr-shadow-split-v2.mjs", import.meta.url), "utf8");
for (const marker of ["TBR_BUS_DAILY_SPLIT_V9", "shadowDay", "readTbrShadowSnapshot(env, hub, shadowPart, shadowDay)"])
  if (!split.includes(marker)) throw new Error(`DEV split patch missing ${marker}`);
console.log("TBR_BUS_DAILY_SPLIT_V9=PASS");
console.log("TBR_BUS_SOURCE_DAYS=2");
console.log("TBR_BUS_MAX_DAY_CONCURRENCY=1");
console.log("TBR_SINGLE_DAY_POINT_READS=4");
console.log("TBR_EARLY_WINDOW_POINT_READS=6");
console.log("TBR_TURSO_WRITES=0");
