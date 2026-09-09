import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root=new URL("../../",import.meta.url);const f=await Promise.all(["ms.js","style.css","sw.js"].map(p=>readFile(new URL(p,root),"utf8")));const front=f[0],style=f[1],sw=f[2];
test("owner V11 source integrated",()=>{const v=style.split("MS_LOWER_CANONICAL_V11")[1]||"";assert.ok(v);assert.match(v,/--ms-destination:#c88700/);assert.match(v,/--ms-origin:#6d55b4/);assert.match(v,/--ms-drop:#1978ba/);assert.doesNotMatch(v,/\.metric-card|\.ms-metrics/);assert.match(front,/function isPhoneDesktopSiteLayout/);assert.match(front,/function completedTodayOvertimeRows/)});
test("route overtime truth",()=>{assert.match(front,/const arrival = parseDate\(row\.actualArrivalAt\)/);assert.match(front,/overStandard: isDestination\(row\) && completed[\s\S]*slaMinutes > standard/);assert.match(front,/state\.status === "unload-overtime" && isCompletedTodayOvertime\(row\)/)});
test("completed-today hydration is coalesced without changing realtime cadence",()=>{assert.match(front,/pollMs:\s*4000/);assert.equal((front.match(/apiGet\("msCompletedToday"/g)||[]).length,1);assert.match(front,/completedTodayLoadPromise\?\.key === key/);assert.match(front,/completedTodayRetryAt = Date\.now\(\) \+ 60_000/);assert.match(front,/completed-today detail hydrates only when the lightweight daily total changes/)});
test("SW freshness only",()=>{assert.match(sw,/cache: "no-store"/);assert.doesNotMatch(sw,/MS_JS_HOTFIX|MS_CSS_HOTFIX|String\.raw|appendPatch|MS_OWNER_CORRECTION/) });
