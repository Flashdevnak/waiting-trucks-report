import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import worker from "../src/index.js";

const DAY_MS = 86400000;
const SESSION_MS = 180 * DAY_MS;
const USERNAME = "MULTI100";
const PIN = "246810";
const PASSWORD_PEPPER = "test-password-pepper";
const AUTH_SECRET = "test-auth-secret-that-stays-stable-across-devices";

function passHash(username, pin) {
  return createHash("sha256")
    .update(`${username}|${pin}|${PASSWORD_PEPPER}`)
    .digest("hex");
}

class FakeDB {
  constructor() {
    this.failVerify = false;
    this.user = {
      username: USERNAME,
      password_hash: passHash(USERNAME, PIN),
      role: "operator",
      branches: "NE1",
      active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: "TEST",
    };
  }

  prepare(sql) {
    const db = this;
    const bound = (args = []) => ({
      async first() {
        if (/SELECT \* FROM users WHERE username=\?/i.test(sql)) return { ...db.user };
        if (/SELECT username,role,branches,active FROM users WHERE username=\?/i.test(sql)) {
          if (db.failVerify) throw new Error("simulated Turso auth lookup outage");
          return {
            username: db.user.username,
            role: db.user.role,
            branches: db.user.branches,
            active: db.user.active,
          };
        }
        return null;
      },
      async all() {
        if (/FROM active_trucks/i.test(sql)) return { results: [] };
        return { results: [] };
      },
      async run() {
        return { success: true, meta: { changes: 1 } };
      },
    });
    return {
      bind(...args) { return bound(args); },
      first() { return bound().first(); },
      all() { return bound().all(); },
      run() { return bound().run(); },
    };
  }
}

function makeEnv(db) {
  return {
    DB: db,
    AUTH_SECRET,
    PASSWORD_PEPPER,
    ASSETS: { fetch: async () => new Response("not used", { status: 404 }) },
  };
}

async function login(env) {
  const response = await worker.fetch(
    new Request("https://test.invalid/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "login", username: USERNAME, pin: PIN }),
    }),
    env,
  );
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(json.ok, true);
  return json.data;
}

async function listWithToken(env, token) {
  const url = new URL("https://test.invalid/api");
  url.searchParams.set("action", "list");
  url.searchParams.set("token", token);
  const response = await worker.fetch(new Request(url), env);
  return { response, json: await response.json() };
}

test("100 simultaneous device sessions remain independently valid", async () => {
  const db = new FakeDB();
  const env = makeEnv(db);
  const startedAt = Date.now();
  const sessions = [];
  for (let i = 0; i < 100; i++) sessions.push(await login(env));

  assert.equal(new Set(sessions.map((s) => s.token)).size, 100);
  for (const session of sessions) {
    const ttl = Number(session.expiresAt) - startedAt;
    assert.ok(ttl >= SESSION_MS - 5000, `TTL too short: ${ttl}`);
    assert.ok(ttl <= SESSION_MS + 10000, `TTL too long: ${ttl}`);
  }

  const first = await listWithToken(env, sessions[0].token);
  const last = await listWithToken(env, sessions[99].token);
  assert.equal(first.response.status, 200, JSON.stringify(first.json));
  assert.equal(last.response.status, 200, JSON.stringify(last.json));
  assert.equal(first.json.ok, true);
  assert.equal(last.json.ok, true);
});

test("transient Turso auth lookup failure does not become INVALID_SESSION", async () => {
  const db = new FakeDB();
  const env = makeEnv(db);
  const session = await login(env);

  db.failVerify = true;
  const outage = await listWithToken(env, session.token);
  assert.equal(outage.response.status, 503, JSON.stringify(outage.json));
  assert.equal(outage.json.ok, false);
  assert.equal(outage.json.code, "AUTH_VERIFY_UNAVAILABLE");
  assert.notEqual(outage.json.code, "INVALID_SESSION");

  db.failVerify = false;
  const recovered = await listWithToken(env, session.token);
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.json));
  assert.equal(recovered.json.ok, true);
});

test("source contract remains 180 days and clients only purge on INVALID_SESSION", () => {
  const workerSource = fsRead("../src/index.js");
  const mainSource = fsRead("../../main.js");
  const msSource = fsRead("../../ms.js");
  assert.match(workerSource, /const SESSION_MS = 180 \* 86400000;/);
  assert.match(workerSource, /AUTH_SESSION_RESILIENCE_V1/);
  assert.match(workerSource, /AUTH_VERIFY_UNAVAILABLE/);
  assert.match(mainSource, /if \(j\.code === \"INVALID_SESSION\"\) invalidateSession\(\)/);
  assert.match(msSource, /if \(error\.code === \"INVALID_SESSION\"\) invalidateSession\(\)/);
});

function fsRead(relative) {
  const url = new URL(relative, import.meta.url);
  return fs.readFileSync(url, "utf8");
}
