import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stageWorker } from "./stage-dev-runtime.mjs";

const root = new URL("../../", import.meta.url);
const canonical = await readFile(new URL("worker/src/index.js", root), "utf8");
const staged = stageWorker(canonical);
const runnable = staged
  .replace(
    `import {
  OriginManifestCoordinator,
  originManifestLive,
  originManifestStatus,
  saveOriginManifestConnection,
  wrapOriginManifestAssets,
} from "./origin-manifest-v1.js";`,
    `const OriginManifestCoordinator = class {};
const originManifestLive = () => null;
const originManifestStatus = () => null;
const saveOriginManifestConnection = () => null;
const wrapOriginManifestAssets = (env) => env;`,
  )
  .replace(
    'import { canonicalMsSource, planMsChanges, resolveCompletionTruth } from "./sync-policy.js";',
    `const canonicalMsSource = (value) => JSON.stringify(value);
const planMsChanges = () => ({ changedIds: [], removedIds: [] });
const resolveCompletionTruth = () => null;`,
  );
assert.doesNotMatch(runnable, /^import\s/m, "test harness replaces staged Worker dependencies");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(runnable).toString("base64")}`;
let moduleSequence = 0;

async function freshWorker() {
  moduleSequence += 1;
  return (await import(`${moduleUrl}#${moduleSequence}`)).default;
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function signedToken(user, secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    username: user.username,
    role: user.role,
    branches: user.role === "admin" ? ["*"] : ["NE1"],
    expiresAt: Date.now() + 60_000,
    nonce: crypto.randomUUID(),
  })));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

function testEnv() {
  const users = new Map([
    ["ADMIN", { username: "ADMIN", role: "admin", branches: "*", active: 1 }],
    ["OPERATOR", { username: "OPERATOR", role: "operator", branches: "NE1", active: 1 }],
  ]);
  const metrics = { reads: 0, writes: 0, assetReads: 0 };
  return {
    metrics,
    env: {
      AUTH_SECRET: "supervisor-test-secret",
      DB: {
        prepare(sql) {
          assert.match(String(sql), /^SELECT username,role,branches,active FROM users WHERE username=\?$/);
          return {
            bind(username) {
              return {
                async first() {
                  metrics.reads += 1;
                  return users.get(String(username)) || null;
                },
              };
            },
          };
        },
      },
      ASSETS: {
        async fetch(request) {
          metrics.assetReads += 1;
          const path = new URL(request.url).pathname;
          return new Response(path === "/supervisor.html" ? "SUPERVISOR_CORE_SHELL_V1" : "MAIN_ASSET");
        },
      },
    },
  };
}

async function exchange(worker, env, token, origin = "https://dev.test") {
  return worker.fetch(new Request("https://dev.test/api/supervisor/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token }),
  }), env);
}

test("SUP-02 rejects direct Supervisor HTML and API access at the Worker", async () => {
  const worker = await freshWorker();
  const { env, metrics } = testEnv();
  const page = await worker.fetch(new Request("https://dev.test/supervisor.html"), env);
  assert.equal(page.status, 403);
  assert.match(await page.text(), /Admin access required/);
  const api = await worker.fetch(new Request("https://dev.test/api/supervisor/snapshot"), env);
  assert.equal(api.status, 403);
  assert.equal((await api.json()).code, "SUPERVISOR_AUTH_REQUIRED");
  assert.equal(metrics.assetReads, 0, "unauthorized HTML never reaches static assets");
});

test("SUP-02 exchanges an existing Admin token for a bounded hardened cookie", async () => {
  const worker = await freshWorker();
  const { env, metrics } = testEnv();
  const response = await exchange(worker, env, await signedToken({ username: "ADMIN", role: "admin" }, env.AUTH_SECRET));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.data.csrf, /^[A-Za-z0-9_-]+$/);
  assert.ok(body.data.expiresAt > Date.now());
  assert.ok(body.data.expiresAt <= Date.now() + 30 * 60 * 1000);
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, /^wtr_supervisor_session_v1=/);
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=1800"])
    assert.match(cookie, new RegExp(flag));
  assert.equal(metrics.reads, 1);
  assert.equal(metrics.writes, 0);
  assert.equal(metrics.assetReads, 0);
});

test("SUP-02 serves the shell only after authoritative Admin verification", async () => {
  const worker = await freshWorker();
  const { env, metrics } = testEnv();
  const session = await exchange(worker, env, await signedToken({ username: "ADMIN", role: "admin" }, env.AUTH_SECRET));
  const cookie = (session.headers.get("set-cookie") || "").split(";")[0];
  const page = await worker.fetch(new Request("https://dev.test/supervisor.html", { headers: { Cookie: cookie } }), env);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "SUPERVISOR_CORE_SHELL_V1");
  assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(metrics.assetReads, 1);
  assert.equal(metrics.reads, 1, "shared auth cache avoids another identical DB read");
});

test("SUP-02 rejects Operator exchange, cross-origin exchange, and missing CSRF", async () => {
  const worker = await freshWorker();
  const { env, metrics } = testEnv();
  const operator = await exchange(worker, env, await signedToken({ username: "OPERATOR", role: "operator" }, env.AUTH_SECRET));
  assert.equal(operator.status, 403);
  assert.equal((await operator.json()).code, "ADMIN_REQUIRED");
  const beforeCrossOrigin = metrics.reads;
  const crossOrigin = await exchange(worker, env, await signedToken({ username: "ADMIN", role: "admin" }, env.AUTH_SECRET), "https://evil.test");
  assert.equal(crossOrigin.status, 403);
  assert.equal(metrics.reads, beforeCrossOrigin, "origin rejection happens before auth DB work");

  const session = await exchange(worker, env, await signedToken({ username: "ADMIN", role: "admin" }, env.AUTH_SECRET));
  const cookie = (session.headers.get("set-cookie") || "").split(";")[0];
  const mutation = await worker.fetch(new Request("https://dev.test/api/supervisor/action", {
    method: "POST",
    headers: { Cookie: cookie },
  }), env);
  assert.equal(mutation.status, 403);
  assert.equal((await mutation.json()).code, "SUPERVISOR_CSRF_REQUIRED");
});

test("SUP-02 remains side-car and introduces no source, repair, or database writes", async () => {
  const start = staged.indexOf("const SUPERVISOR_COOKIE_NAME");
  const end = staged.indexOf("async function get(url, env)", start);
  const guard = staged.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(guard, /refreshMsIfStale|runMsRefresh|readMsRoutes|readBusTimeData|readPreEntry|readHbi|route_followstart|fleet_time|getList/);
  assert.doesNotMatch(guard, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|\.run\s*\(|\.batch\s*\(/i);
  assert.doesNotMatch(guard, /setInterval|setTimeout|WebSocketPair|fetch\(["']https?:/);
  assert.match(guard, /verifiedAuthUser/);

  const worker = await freshWorker();
  const { env, metrics } = testEnv();
  const main = await worker.fetch(new Request("https://dev.test/ms.html"), env);
  assert.equal(main.status, 200);
  assert.equal(await main.text(), "MAIN_ASSET");
  assert.equal(metrics.reads, 0);
  assert.equal(metrics.writes, 0);
});
