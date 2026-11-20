// Test-only: real Wrangler 4.127.1 upload path against 127.0.0.1 in an
// isolated network namespace, with synthetic credentials and account ID.
// This harness NEVER constitutes a real Cloudflare deployment or I03 closure.
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const accountId = "00000000000000000000000000000000";
const token = "wtr011o-local-fake-token-NOT-REAL";
const workerName = "wtr011o-mock-only";
const hSha = "b0351e0a2d6eb1d5392fd019ba445b65ad1aca88a5b1bf8b130818f8592faae0";
const sha = b => createHash("sha256").update(b).digest("hex");
const frontend = readFileSync(".dev-assets/ms.js");
if (sha(frontend) !== hSha || frontend.length !== 461464) throw Error("H-only ms.js pin mismatch");
const files = [
  "wrangler.dev.jsonc", "package-lock.json",
  ".dev-runtime/src/turso-index.js", ".dev-assets/ms.js"
];
const before = Object.fromEntries(files.map(p => [p, sha(readFileSync(p))]));
const captured = [];
const logs = [];
let total = 0;
function envelope(result) { return JSON.stringify({ success:true, errors:[], messages:[], result }); }
const fakeAccount = { id:accountId, name:"WTR-011O-LOCAL-ONLY" };
const server = http.createServer(async (req, res) => {
  if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::1") {
    res.writeHead(403); res.end("loopback only"); return;
  }
  const parts = [];
  let len = 0;
  try {
    for await (const chunk of req) {
      len += chunk.length;
      if (len > 30000000) throw Error("request exceeds test limit");
      parts.push(chunk);
    }
  } catch(e) { res.writeHead(413); res.end("too large"); return; }
  const payload = Buffer.concat(parts);
  total += payload.length;
  if(total > 60000000) {res.writeHead(413);res.end("total too large");return;}
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  const item = {method:req.method,path:pathname,query:new URL(req.url,"http://127.0.0.1").search,
    length:payload.length,sha256:sha(payload),type:req.headers["content-type"]||"",
    containsRawHFrontend:payload.includes(frontend),
    containsWorkerName:payload.includes(Buffer.from(workerName)),
    containsFakeAccount:payload.includes(Buffer.from(accountId))};
  captured.push(item);
  console.log("LOCAL_REQUEST "+JSON.stringify(item));
  res.setHeader("content-type","application/json");
  if(pathname.includes("/user/tokens/verify")) {res.end(envelope({id:"local-token",status:"active"}));return;}
  if(pathname === "/accounts") {res.end(envelope([fakeAccount]));return;}
  if(pathname.endsWith("/workers/subdomain")) {res.end(envelope({subdomain:"local-invalid",enabled:false}));return;}
  if(pathname.endsWith("/workers/scripts") && req.method==="GET") {res.end(envelope([]));return;}
  if(pathname.endsWith("/workers/assets/upload") || pathname.includes("/assets/upload")) {
    // Deliberately reject after capturing the full exact outgoing request bytes.
    res.statusCode=418;res.end(JSON.stringify({success:false,errors:[{code:9999,message:"LOCAL MOCK CAPTURED ASSET UPLOAD; NEVER PUBLISH"}],messages:[],result:null}));return;
  }
  if((req.method==="POST" || req.method==="PUT") && pathname.includes("/workers/")) {
    // Deliberately reject AFTER capturing upload body and hash, no success claim.
    res.statusCode=418;res.end(JSON.stringify({success:false,errors:[{code:9999,message:"LOCAL MOCK CAPTURED WORKER UPLOAD; NEVER PUBLISH"}],messages:[],result:null}));return;
  }
  if(pathname.includes("/memberships")) {res.end(envelope([]));return;}
  if(pathname === "/accounts/"+accountId) {res.end(envelope(fakeAccount));return;}
  if(req.method==="GET") {res.end(envelope({id:workerName,enabled:false,subdomain:"local-invalid"}));return;}
  res.statusCode=418;res.end(JSON.stringify({success:false,errors:[{code:9998,message:"LOCAL MOCK REJECTED UNRECOGNIZED WRITE"}],messages:[],result:null}));
});
server.listen(0,"127.0.0.1");
await new Promise((r,j)=>{server.once("listening",r);server.once("error",j)});
const port=server.address().port;
console.log("LOCAL_MOCK_LISTEN=127.0.0.1:"+port);
console.log("CLOUDFLARE_ACCOUNT_ID=FAKE_ONLY");
const env={...process.env,
  CLOUDFLARE_API_BASE_URL:"http://127.0.0.1:"+port,
  CLOUDFLARE_ACCOUNT_ID:accountId,
  CLOUDFLARE_API_TOKEN:token,
  WRANGLER_SEND_METRICS:"false",
  WRANGLER_SEND_ERROR_REPORTS:"false",
  CLOUDFLARE_SEND_METRICS:"false",
  CLOUDFLARE_CF_FETCH_ENABLED:"false",
  CI:"true",
};
for(const key of ["CLOUDFLARE_API_KEY","CLOUDFLARE_EMAIL","CF_API_TOKEN","CF_API_KEY","CF_ACCOUNT_ID"]){delete env[key]}
const argv=[
  "node_modules/wrangler/bin/wrangler.js","deploy",".dev-runtime/src/turso-index.js",
  "--config","wrangler.dev.jsonc","--name",workerName
];
const p=spawn(process.execPath,argv,{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});
const timer=setTimeout(()=>p.kill("SIGKILL"),60000);
for(const [stream,label] of [[p.stdout,"stdout"],[p.stderr,"stderr"]]){
  stream.setEncoding("utf8");stream.on("data",x=>{const line=x.slice(0,1500);
    logs.push(label+" "+line);if(logs.length>200)logs.shift();});
}
const exit = await new Promise(r=>{p.once("exit",(code,signal)=>r({code,signal}));p.once("error",err=>r({error:String(err)}));});
clearTimeout(timer);
server.close();
for(const p of files) if(sha(readFileSync(p)) !== before[p]) throw Error("publisher input changed during CLI run: "+p);
const uploads=captured.filter(x=>["POST","PUT","PATCH"].includes(x.method));
console.log("WRANGLER_EXIT="+JSON.stringify(exit));
console.log("REQUEST_COUNT="+captured.length);
console.log("UPLOAD_REQUEST_COUNT="+uploads.length);
console.log("UPLOAD_REQUEST_DETAILS="+JSON.stringify(uploads));
console.log("WRANGLER_LOG_TAIL="+JSON.stringify(logs.slice(-12)));
console.log("UPLOAD_SENT_TO_REAL_CLOUDFLARE=NO_NETWORK_NAMESPACE");
console.log("H_ONLY_INPUT_HASHES_UNCHANGED=PASS");
if(exit.code===0) throw Error("mock reject should not allow a successful deploy");
if(!uploads.length) throw Error("Wrangler did not reach any upload request; I03 remains OPEN");
console.log("WRANGLER_REAL_API_REQUEST_BODY_CAPTURED=PASS");
console.log("I03_FINAL_PUBLISHER_BOUNDARY=OPEN_PENDING_BYTE_IDENTITY_AND_IMMUTABILITY");
