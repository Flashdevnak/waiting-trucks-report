import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workerPath = path.join(root, 'worker/src/index.js');
const deployPath = path.join(root, '.github/workflows/deploy-worker-dev.yml');
const testPath = path.join(root, 'worker/tests/auth-session-resilience.test.mjs');

let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes('const SESSION_MS = 180 * 86400000;')) {
  throw new Error('Expected 180-day SESSION_MS contract is missing');
}

if (!worker.includes('AUTH_SESSION_RESILIENCE_V1')) {
  const start = worker.indexOf('async function verify(token, env) {');
  const end = worker.indexOf('\nasync function scoped(', start);
  if (start < 0 || end < 0) throw new Error('verify() patch anchors not found');

  const replacement = `// AUTH_SESSION_RESILIENCE_V1: sessions are stateless and valid for 180 days.\n// A transient DB/Turso failure must never be mislabeled as INVALID_SESSION,\n// because clients intentionally remove their persisted token on INVALID_SESSION.\nasync function verify(token, env) {\n  const [payload, signature] = String(token || \"\").split(\".\");\n  if (!payload || !signature)\n    fail(\"สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง\", \"INVALID_SESSION\", 401);\n\n  let signatureValid = false;\n  try {\n    signatureValid = await equal(signature, await hmac(payload, env.AUTH_SECRET));\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: \"auth_signature_verify_unavailable\",\n        message: error?.message || String(error),\n      }),\n    );\n    fail(\n      \"ระบบยืนยันสิทธิ์ขัดข้องชั่วคราว กรุณาลองใหม่\",\n      \"AUTH_VERIFY_UNAVAILABLE\",\n      503,\n    );\n  }\n  if (!signatureValid)\n    fail(\"สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง\", \"INVALID_SESSION\", 401);\n\n  let actor;\n  try {\n    actor = JSON.parse(new TextDecoder().decode(unb64(payload)));\n  } catch {\n    fail(\"สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง\", \"INVALID_SESSION\", 401);\n  }\n  if (!actor?.username || Date.now() > Number(actor.expiresAt))\n    fail(\"สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง\", \"INVALID_SESSION\", 401);\n\n  let user;\n  try {\n    user = await env.DB.prepare(\n      \"SELECT username,role,branches,active FROM users WHERE username=?\",\n    )\n      .bind(actor.username)\n      .first();\n  } catch (error) {\n    console.error(\n      JSON.stringify({\n        event: \"auth_verify_unavailable\",\n        username: String(actor.username || \"\").slice(0, 30),\n        message: error?.message || String(error),\n      }),\n    );\n    fail(\n      \"ระบบยืนยันสิทธิ์ขัดข้องชั่วคราว กรุณาลองใหม่\",\n      \"AUTH_VERIFY_UNAVAILABLE\",\n      503,\n    );\n  }\n\n  if (!user || user.active !== 1 || user.role !== actor.role)\n    fail(\"สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง\", \"INVALID_SESSION\", 401);\n  return {\n    username: user.username,\n    role: user.role,\n    branches: branchList(user.branches),\n  };\n}`;

  worker = worker.slice(0, start) + replacement + worker.slice(end);
  fs.writeFileSync(workerPath, worker);
}

let deploy = fs.readFileSync(deployPath, 'utf8');
const oldSecretCheck = `const missing = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'].filter((name) => !text.includes(name));`;
if (deploy.includes(oldSecretCheck)) {
  deploy = deploy.replace(
    oldSecretCheck,
    `const required = ['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','AUTH_SECRET','PASSWORD_PEPPER'];\n          const missing = required.filter((name) => !text.includes(name));`,
  );
  deploy = deploy.replace(
    'Missing DEV Worker Turso secrets: ${missing.join(\', \')}',
    'Missing required DEV Worker secrets: ${missing.join(\', \')}',
  );
  deploy = deploy.replace(
    "console.log('DEV_TURSO_SECRETS=PASS');",
    "console.log('DEV_TURSO_SECRETS=PASS');\n          console.log('DEV_AUTH_SECRETS=PASS');",
  );
  fs.writeFileSync(deployPath, deploy);
}
if (!deploy.includes("'AUTH_SECRET','PASSWORD_PEPPER'")) {
  throw new Error('DEV deploy auth-secret guard was not applied');
}

const testSource = `import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { createHash } from \"node:crypto\";\nimport worker from \"../src/index.js\";\n\nconst DAY_MS = 86400000;\nconst SESSION_MS = 180 * DAY_MS;\nconst USERNAME = \"MULTI100\";\nconst PIN = \"246810\";\nconst PASSWORD_PEPPER = \"test-password-pepper\";\nconst AUTH_SECRET = \"test-auth-secret-that-stays-stable-across-devices\";\n\nfunction passHash(username, pin) {\n  return createHash(\"sha256\")\n    .update(\`\${username}|\${pin}|\${PASSWORD_PEPPER}\`)\n    .digest(\"hex\");\n}\n\nclass FakeDB {\n  constructor() {\n    this.failVerify = false;\n    this.user = {\n      username: USERNAME,\n      password_hash: passHash(USERNAME, PIN),\n      role: \"operator\",\n      branches: \"NE1\",\n      active: 1,\n      created_at: new Date().toISOString(),\n      updated_at: new Date().toISOString(),\n      created_by: \"TEST\",\n    };\n  }\n\n  prepare(sql) {\n    const db = this;\n    const bound = (args = []) => ({\n      async first() {\n        if (/SELECT \\* FROM users WHERE username=\\?/i.test(sql)) return { ...db.user };\n        if (/SELECT username,role,branches,active FROM users WHERE username=\\?/i.test(sql)) {\n          if (db.failVerify) throw new Error(\"simulated Turso auth lookup outage\");\n          return {\n            username: db.user.username,\n            role: db.user.role,\n            branches: db.user.branches,\n            active: db.user.active,\n          };\n        }\n        return null;\n      },\n      async all() {\n        if (/FROM active_trucks/i.test(sql)) return { results: [] };\n        return { results: [] };\n      },\n      async run() {\n        return { success: true, meta: { changes: 1 } };\n      },\n    });\n    return {\n      bind(...args) { return bound(args); },\n      first() { return bound().first(); },\n      all() { return bound().all(); },\n      run() { return bound().run(); },\n    };\n  }\n}\n\nfunction makeEnv(db) {\n  return {\n    DB: db,\n    AUTH_SECRET,\n    PASSWORD_PEPPER,\n    ASSETS: { fetch: async () => new Response(\"not used\", { status: 404 }) },\n  };\n}\n\nasync function login(env) {\n  const response = await worker.fetch(\n    new Request(\"https://test.invalid/api\", {\n      method: \"POST\",\n      headers: { \"content-type\": \"application/json\" },\n      body: JSON.stringify({ action: \"login\", username: USERNAME, pin: PIN }),\n    }),\n    env,\n  );\n  const json = await response.json();\n  assert.equal(response.status, 200, JSON.stringify(json));\n  assert.equal(json.ok, true);\n  return json.data;\n}\n\nasync function listWithToken(env, token) {\n  const url = new URL(\"https://test.invalid/api\");\n  url.searchParams.set(\"action\", \"list\");\n  url.searchParams.set(\"token\", token);\n  const response = await worker.fetch(new Request(url), env);\n  return { response, json: await response.json() };\n}\n\ntest(\"100 simultaneous device sessions remain independently valid\", async () => {\n  const db = new FakeDB();\n  const env = makeEnv(db);\n  const startedAt = Date.now();\n  const sessions = [];\n  for (let i = 0; i < 100; i++) sessions.push(await login(env));\n\n  assert.equal(new Set(sessions.map((s) => s.token)).size, 100);\n  for (const session of sessions) {\n    const ttl = Number(session.expiresAt) - startedAt;\n    assert.ok(ttl >= SESSION_MS - 5000, \`TTL too short: \${ttl}\`);\n    assert.ok(ttl <= SESSION_MS + 10000, \`TTL too long: \${ttl}\`);\n  }\n\n  const first = await listWithToken(env, sessions[0].token);\n  const last = await listWithToken(env, sessions[99].token);\n  assert.equal(first.response.status, 200, JSON.stringify(first.json));\n  assert.equal(last.response.status, 200, JSON.stringify(last.json));\n  assert.equal(first.json.ok, true);\n  assert.equal(last.json.ok, true);\n});\n\ntest(\"transient Turso auth lookup failure does not become INVALID_SESSION\", async () => {\n  const db = new FakeDB();\n  const env = makeEnv(db);\n  const session = await login(env);\n\n  db.failVerify = true;\n  const outage = await listWithToken(env, session.token);\n  assert.equal(outage.response.status, 503, JSON.stringify(outage.json));\n  assert.equal(outage.json.ok, false);\n  assert.equal(outage.json.code, \"AUTH_VERIFY_UNAVAILABLE\");\n  assert.notEqual(outage.json.code, \"INVALID_SESSION\");\n\n  db.failVerify = false;\n  const recovered = await listWithToken(env, session.token);\n  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.json));\n  assert.equal(recovered.json.ok, true);\n});\n\ntest(\"source contract remains 180 days and clients only purge on INVALID_SESSION\", () => {\n  const workerSource = fsRead(\"src/index.js\");\n  const mainSource = fsRead(\"../main.js\");\n  const msSource = fsRead(\"../ms.js\");\n  assert.match(workerSource, /const SESSION_MS = 180 \\* 86400000;/);\n  assert.match(workerSource, /AUTH_SESSION_RESILIENCE_V1/);\n  assert.match(workerSource, /AUTH_VERIFY_UNAVAILABLE/);\n  assert.match(mainSource, /if \\(j\\.code === \\"INVALID_SESSION\\"\\) invalidateSession\\(\\)/);\n  assert.match(msSource, /if \\(error\\.code === \\"INVALID_SESSION\\"\\) invalidateSession\\(\\)/);\n});\n\nfunction fsRead(relative) {\n  const url = new URL(relative, import.meta.url);\n  return requireFs().readFileSync(url, \"utf8\");\n}\nfunction requireFs() {\n  return globalThis.__authTestFs;\n}\n`;

// Keep the regression test ESM-only; inject fs through a normal import rather than require().
const finalTestSource = testSource
  .replace('import { createHash } from "node:crypto";\n', 'import { createHash } from "node:crypto";\nimport fs from "node:fs";\n')
  .replace('  return requireFs().readFileSync(url, "utf8");\n}\nfunction requireFs() {\n  return globalThis.__authTestFs;\n}\n', '  return fs.readFileSync(url, "utf8");\n}\n');
fs.writeFileSync(testPath, finalTestSource);

console.log('AUTH_SESSION_RESILIENCE_PATCH=PASS');
console.log('SESSION_DAYS=180');
console.log('CONCURRENT_DEVICE_TEST_TARGET=100');
