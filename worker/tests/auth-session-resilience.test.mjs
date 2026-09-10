import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import worker, { classifyAuthReadFailure } from "../src/index.js";

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
  constructor(username = USERNAME, pin = PIN) {
    this.failVerify = false;
    this.failLogin = false;
    this.loginError = null;
    this.verifyError = null;
    this.verifyDelayMs = 0;
    this.loginReads = 0;
    this.verifyReads = 0;
    this.user = {
      username,
      password_hash: passHash(username, pin),
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
        if (/SELECT \* FROM users WHERE username=\?/i.test(sql)) {
          db.loginReads += 1;
          if (db.failLogin) throw db.loginError || new Error("simulated Turso login outage");
          return { ...db.user };
        }
        if (/SELECT username,role,branches,active FROM users WHERE username=\?/i.test(sql)) {
          db.verifyReads += 1;
          if (db.verifyDelayMs)
            await new Promise((resolve) => setTimeout(resolve, db.verifyDelayMs));
          if (db.failVerify)
            throw db.verifyError || new Error("simulated Turso auth lookup outage");
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

async function login(env, username = USERNAME, pin = PIN) {
  const response = await worker.fetch(
    new Request("https://test.invalid/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "login", username, pin }),
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

function makeSessionToken(username, role = "operator", branches = ["NE1"]) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      role,
      branches,
      expiresAt: Date.now() + SESSION_MS,
      nonce: randomUUID(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
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

  const [first, last] = await Promise.all([
    listWithToken(env, sessions[0].token),
    listWithToken(env, sessions[99].token),
  ]);
  assert.equal(first.response.status, 200, JSON.stringify(first.json));
  assert.equal(last.response.status, 200, JSON.stringify(last.json));
  assert.equal(first.json.ok, true);
  assert.equal(last.json.ok, true);
  assert.equal(db.loginReads, 100, "each password submission is validated once");
  assert.equal(
    db.verifyReads,
    0,
    "successful login should seed verification and avoid an immediate duplicate Turso read",
  );
});

test("transient Turso auth lookup failure does not become INVALID_SESSION", async () => {
  const outageUsername = "OUTAGE100";
  const outagePin = "135790";
  const db = new FakeDB(outageUsername, outagePin);
  const env = makeEnv(db);
  const token = makeSessionToken(outageUsername);

  db.failVerify = true;
  const outage = await listWithToken(env, token);
  assert.equal(outage.response.status, 503, JSON.stringify(outage.json));
  assert.equal(outage.json.ok, false);
  assert.equal(outage.json.code, "AUTH_VERIFY_UNAVAILABLE");
  assert.notEqual(outage.json.code, "INVALID_SESSION");

  db.failVerify = false;
  const recovered = await listWithToken(env, token);
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.json));
  assert.equal(recovered.json.ok, true);
});

test("concurrent initial API requests coalesce to one Turso authorization read", async () => {
  const username = "COALESCE100";
  const db = new FakeDB(username, "112233");
  db.verifyDelayMs = 20;
  const env = makeEnv(db);
  const token = makeSessionToken(username);

  const results = await Promise.all(
    Array.from({ length: 25 }, () => listWithToken(env, token)),
  );
  for (const result of results) {
    assert.equal(result.response.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.ok, true);
  }
  assert.equal(db.verifyReads, 1);
});

test("Turso provider read limit during login is not INVALID_LOGIN", async () => {
  const username = "LOGINLIMIT100";
  const db = new FakeDB(username, "445566");
  db.failLogin = true;
  db.loginError = Object.assign(new Error("SQL read operations are forbidden"), {
    code: "TURSO_HTTP_ERROR",
  });
  const env = makeEnv(db);
  const response = await worker.fetch(
    new Request("https://test.invalid/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "login", username, pin: "445566" }),
    }),
    env,
  );
  const json = await response.json();
  assert.equal(response.status, 503, JSON.stringify(json));
  assert.equal(json.code, "AUTH_PROVIDER_LIMIT");
  assert.notEqual(json.code, "INVALID_LOGIN");
  assert.notEqual(json.code, "INVALID_SESSION");
});

test("Turso provider read limit during token verification preserves the session", async () => {
  const username = "VERIFYLIMIT100";
  const db = new FakeDB(username, "778899");
  const env = makeEnv(db);
  const token = makeSessionToken(username);
  db.failVerify = true;
  db.verifyError = Object.assign(new Error("Request exceeds the usage limit"), {
    code: "TURSO_HTTP_ERROR",
  });

  const limited = await listWithToken(env, token);
  assert.equal(limited.response.status, 503, JSON.stringify(limited.json));
  assert.equal(limited.json.code, "AUTH_PROVIDER_LIMIT");
  assert.notEqual(limited.json.code, "INVALID_SESSION");

  db.failVerify = false;
  const recovered = await listWithToken(env, token);
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.json));
  assert.equal(recovered.json.ok, true);
});

test("auth read classifier distinguishes provider limits from generic outages", () => {
  assert.deepEqual(
    classifyAuthReadFailure(new Error("SQL read operations are forbidden"), "login"),
    { code: "AUTH_PROVIDER_LIMIT", status: 503 },
  );
  assert.deepEqual(classifyAuthReadFailure(new Error("network unavailable"), "login"), {
    code: "AUTH_LOGIN_UNAVAILABLE",
    status: 503,
  });
  assert.deepEqual(classifyAuthReadFailure(new Error("network unavailable"), "verify"), {
    code: "AUTH_VERIFY_UNAVAILABLE",
    status: 503,
  });
});

test("source contract remains 180 days and clients only purge on INVALID_SESSION", () => {
  const workerSource = fsRead("../src/index.js");
  const mainSource = fsRead("../../main.js");
  const msSource = fsRead("../../ms.js");
  assert.match(workerSource, /const SESSION_MS = 180 \* 86400000;/);
  assert.match(workerSource, /AUTH_SESSION_RESILIENCE_V1/);
  assert.match(workerSource, /AUTH_PROVIDER_LIMIT_V3/);
  assert.match(workerSource, /AUTH_PROVIDER_LIMIT/);
  assert.match(workerSource, /AUTH_VERIFY_UNAVAILABLE/);
  assert.match(mainSource, /if \(j\.code === \"INVALID_SESSION\"\) invalidateSession\(\)/);
  assert.match(msSource, /if \(error\.code === \"INVALID_SESSION\"\) invalidateSession\(\)/);
});

function fsRead(relative) {
  const url = new URL(relative, import.meta.url);
  return fs.readFileSync(url, "utf8");
}
