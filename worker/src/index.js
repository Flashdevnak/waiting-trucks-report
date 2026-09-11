import {
  OriginManifestCoordinator,
  originManifestLive,
  originManifestStatus,
  saveOriginManifestConnection,
  wrapOriginManifestAssets,
} from "./origin-manifest-v1.js";
import { canonicalMsSource, planMsChanges, resolveCompletionTruth } from "./sync-policy.js";

const SESSION_MS = 180 * 86400000;
const MS_SYNC_TTL = 3000;
const MS_LIVE_CACHE_VERSION = "completion-v2";
const completionRepairChecked = new Set();
const CONNECTION_HEARTBEAT_MS = 15 * 60 * 1000;
const CONNECTOR_HEARTBEAT_MS = 60 * 60 * 1000;
const UPSTREAM_FETCH_TIMEOUT_MS = 9000;
const recentMsSync = new Map();
const activeMsSync = new Map();
// HBI_PHOTO_ON_DEMAND_V1: never joined to the 4-second live refresh.
const HBI_PHOTO_CACHE_MS = 12 * 60 * 60 * 1000;
const HBI_EMPTY_CACHE_MS = 30 * 60 * 1000;
const HBI_PHOTO_CACHE_MAX = 400;
const hbiPhotoCache = new Map();
const activeHbiPhotoReads = new Map();
// AUTH_VERIFY_READ_CACHE_V2: remove repeated identical user reads from 4-second polling.
const AUTH_VERIFY_CACHE_MS = 60 * 1000;
const authVerifyCache = new Map();
const authVerifyActive = new Map();
const authVerifyGeneration = new Map();
function cachedAuthUser(username, now = Date.now()) {
  const key = String(username || "").toUpperCase();
  const cached = authVerifyCache.get(key);
  if (!cached || cached.until <= now) {
    if (cached) authVerifyCache.delete(key);
    return null;
  }
  return cached.user;
}
function rememberAuthUser(user, now = Date.now()) {
  if (!user?.username) return;
  authVerifyCache.set(String(user.username).toUpperCase(), {
    until: now + AUTH_VERIFY_CACHE_MS,
    user: { ...user },
  });
}
function invalidateAuthUser(username) {
  const key = String(username || "").toUpperCase();
  authVerifyCache.delete(key);
  authVerifyGeneration.set(key, (authVerifyGeneration.get(key) || 0) + 1);
}
// AUTH_PROVIDER_LIMIT_V3: a Turso quota/provider refusal is an availability
// failure, never proof that a password or a still-valid token is invalid.
export function classifyAuthReadFailure(error, phase = "verify") {
  const value = [
    error?.code,
    error?.message,
    error?.cause?.code,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    /sql\s+read\s+operations?\s+are\s+forbidden|read\s+operations?\s+(?:are\s+)?forbidden|request\s+exceeds\s+the\s+limit|rate.?limit|too\s+many\s+requests|quota\s+(?:has\s+been\s+)?exceeded|usage\s+limit/i.test(
      value,
    )
  )
    return { code: "AUTH_PROVIDER_LIMIT", status: 503 };
  return {
    code:
      phase === "login" ? "AUTH_LOGIN_UNAVAILABLE" : "AUTH_VERIFY_UNAVAILABLE",
    status: 503,
  };
}
function failAuthRead(error, phase, username) {
  const failure = classifyAuthReadFailure(error, phase);
  console.error(
    JSON.stringify({
      event: `auth_${phase}_read_failed`,
      code: failure.code,
      username: String(username || "").slice(0, 30),
      message: error?.message || String(error),
    }),
  );
  fail(
    failure.code === "AUTH_PROVIDER_LIMIT"
      ? "ผู้ให้บริการฐานข้อมูลจำกัดการอ่านชั่วคราว กรุณาลองใหม่"
      : "ระบบยืนยันสิทธิ์ขัดข้องชั่วคราว กรุณาลองใหม่",
    failure.code,
    failure.status,
  );
}
async function verifiedAuthUser(username, env) {
  const key = String(username || "").toUpperCase();
  const cached = cachedAuthUser(key);
  if (cached) return cached;
  if (authVerifyActive.has(key)) return authVerifyActive.get(key);
  const generation = authVerifyGeneration.get(key) || 0;
  const task = env.DB.prepare(
    "SELECT username,role,branches,active FROM users WHERE username=?",
  )
    .bind(key)
    .first()
    .then((user) => {
      // A concurrent save/deactivate invalidates this generation so an old
      // result cannot repopulate the authorization cache after the write.
      if (user && (authVerifyGeneration.get(key) || 0) === generation)
        rememberAuthUser(user);
      return user;
    })
    .finally(() => authVerifyActive.delete(key));
  authVerifyActive.set(key, task);
  return task;
}
const PAUSES = [
  ["pause-1", "ช่วงไม่มีกะ 1", 0, 1],
  ["pause-2", "ช่วงไม่มีกะ 2", 7, 8],
  ["pause-3", "ช่วงไม่มีกะ 3", 10, 15],
  ["pause-4", "ช่วงไม่มีกะ 4", 18, 19],
];
const LIMITS = ["4W", "4WJ", "6W", "10W", "14W", "18W", "22W"];
const CENTRAL_LIMITS = {
  BPL: [15, 25, 60, 60, 130, 180, 180],
  BAG4: [20, 30, 60, 60, 130, 180, 180],
  EA2: [20, 30, 60, 60, 130, 180, 180],
  NE1: [20, 30, 45, 45, 120, 180, 180],
  BAG2: [20, 30, 45, 45, 120, 180, 180],
  NO3: [20, 30, 75, 75, 160, 180, 180],
  NO5: [20, 30, 60, 60, 130, 180, 180],
  NE4: [20, 30, 75, 75, 160, 180, 180],
  NO4: [20, 30, 75, 75, 160, 180, 180],
  CENTRAL: [20, 30, 60, 60, 120, 180, 180],
  SO5: [20, 30, 60, 60, 130, 180, 180],
  EA1: [20, 30, 60, 60, 120, 180, 180],
  KKC: [15, 25, 60, 60, 130, 180, 180],
  PDT: [15, 25, 60, 60, 130, 180, 180],
  SO2: [20, 30, 50, 50, 120, 180, 180],
  YAS: [15, 25, 90, 90, 190, 180, 180],
  NO2: [20, 30, 75, 75, 160, 180, 180],
  PHS: [15, 25, 90, 90, 190, 180, 180],
  BAG: [20, 30, 45, 45, 120, 180, 180],
  NAS: [15, 25, 60, 60, 130, 180, 180],
  NE2: [20, 30, 60, 60, 120, 180, 180],
  NE6: [20, 30, 75, 75, 160, 180, 180],
  BAG3: [20, 30, 45, 45, 120, 180, 180],
  AYU: [15, 25, 60, 60, 130, 180, 180],
  WNO: [15, 25, 60, 60, 130, 180, 180],
  LAS: [20, 30, 60, 60, 120, 180, 180],
  URT: [15, 25, 60, 60, 130, 180, 180],
  NE3: [20, 30, 50, 50, 120, 180, 180],
  SO3: [20, 30, 60, 60, 130, 180, 180],
  NE7: [20, 30, 75, 75, 160, 180, 180],
  SCB: [20, 30, 45, 45, 120, 180, 180],
  NAK: [15, 25, 60, 60, 130, 180, 180],
  SO4: [20, 30, 60, 60, 130, 180, 180],
  NO1: [20, 30, 50, 50, 120, 180, 180],
  SO1: [20, 30, 60, 60, 130, 180, 180],
  NE5: [20, 30, 75, 75, 160, 180, 180],
};

export default {
  async fetch(request, env) {
    try {
      // MS_ORIGIN_LH_MANIFEST_V1: wrap DEV assets only; no Production path is changed.
      env = wrapOriginManifestAssets(env);
      const url = new URL(request.url);
      // MS_REALTIME_WS_V1: upgrade before the normal JSON GET wrapper.
      if (request.method === "GET" && url.searchParams.get("action") === "msStream" && String(request.headers.get("Upgrade") || "").toLowerCase() === "websocket")
        return msRealtimeStream(request, url, env);
      // DEV_ROOT_ENTRY_V1: DEV-only staged entry route; canonical worker source is unchanged.
      if (url.pathname === "/") return Response.redirect(new URL("/ms.html", request.url), 302);
      if (!url.pathname.startsWith("/api")) return env.ASSETS.fetch(request);
      if (request.method === "OPTIONS")
        return new Response(null, { headers: cors() });
      if (request.method === "GET") return json(await get(url, env));
      if (request.method === "POST")
        return json(await post(await request.json(), env));
      return json(
        {
          ok: false,
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed",
        },
        405,
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "api_error",
          code: e.code || "SERVER_ERROR",
          message: e.message,
        }),
      );
      return json(
        {
          ok: false,
          code: e.code || "SERVER_ERROR",
          message: e.message || "ระบบขัดข้อง",
        },
        e.status || 400,
      );
    }
  },
};

async function get(url, env) {
  const action = url.searchParams.get("action") || "list";
  if (action === "health")
    return ok({
      service: "waiting-trucks-cloudflare",
      time: new Date().toISOString(),
    });
  const actor = await verify(url.searchParams.get("token"), env);
  if (action === "msOriginManifestStatus")
    return ok(await originManifestStatus(
      env,
      actor,
      pickBranch(actor, url.searchParams.get("branch")),
    ));
  if (action === "msOriginManifestLive")
    return ok(await originManifestLive(
      env,
      actor,
      pickBranch(actor, url.searchParams.get("branch")),
      url.searchParams.get("days"),
    ));
  if (action === "list") return ok(await scoped(env, "active_trucks", actor));
  if (action === "history")
    return ok(
      await scoped(env, "truck_history", actor, "action_at DESC", 1000),
    );
  if (action === "users") {
    mustAdmin(actor);
    return ok(await users(env));
  }
  if (action === "settings")
    return ok(
      await readSettings(
        env,
        pickBranch(actor, url.searchParams.get("branch")),
      ),
    );
  if (action === "msRoutes") {
    const branch = pickBranch(actor, url.searchParams.get("branch")),
      live = await refreshMsIfStale(env, actor, branch);
    const rows = Array.isArray(live.rows)
      ? live.rows
      : await applyRouteCancellationsToRows(
          env,
          branch,
          (
            await env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?")
              .bind(branch)
              .all()
          ).results.map(output),
        );
    const settings = await readSettings(env, branch);
    const latest = live.syncedAt
      ? null
      : await env.DB.prepare(
          "SELECT MAX(timestamp) AS synced_at FROM audit_log WHERE action='SYNC_MS_ROUTES' AND record_id=?",
        )
          .bind(branch)
          .first();
    return ok({
      rows,
      branch,
      branches:
        actor.role === "admin"
          ? [...new Set([branch, ...(await knownMsBranches(env))])]
          : actor.branches.filter((x) => x !== "*"),
      standards: settings.msVehicleLimits,
      lastSync: live.syncedAt || latest?.synced_at || "",
      msStatus: live.status,
      syncError: live.error || "",
      completedToday: Number(live.completedToday) || 0,
    });
  }
  if (action === "msArchiveTotal") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await msArchiveTotal(env, actor, branch));
  }
  if (action === "msDailyArchive") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(
      await msDailyArchive(
        env,
        actor,
        branch,
        url.searchParams.get("start"),
        url.searchParams.get("end"),
      ),
    );
  }
  if (action === "msHistory")
    return ok(
      await msHistory(
        env,
        actor,
        pickBranch(actor, url.searchParams.get("branch")),
        Number(url.searchParams.get("offset")) || 0,
      ),
    );
  if (action === "msArchive")
    return ok(
      await msArchive(
        env,
        actor,
        pickBranch(actor, url.searchParams.get("branch")),
      ),
    );
  if (action === "msCompletedToday") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await readMsCompletedToday(env, actor, branch));
  }
  if (action === "msCancelledToday") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await readMsCancelledToday(env, actor, branch));
  }
  if (action === "msRange")
    return ok(
      await msRange(
        env,
        actor,
        pickBranch(actor, url.searchParams.get("branch")),
        url.searchParams.get("start"),
        url.searchParams.get("end"),
      ),
    );
  if (action === "msConnections") {
    mustAdmin(actor);
    return ok(await listMsConnections(env));
  }
  if (action === "msConnectionStatus") {
    const hub = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await msConnectionStatus(env, actor, hub));
  }
  if (action === "msTruckPhotos") {
    const hub = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await msTruckPhotos(env, actor, hub, url.searchParams.get("proofId")));
  }
  if (action === "pendingParcels") {
    const hub = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await pendingParcels(
      env,
      actor,
      hub,
      url.searchParams.get("proofId"),
      url.searchParams.get("day"),
      url.searchParams.get("type"),
    ));
  }
  if (action === "preEntryTrips") {
    const hub = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await preEntryTrips(env, actor, hub, url.searchParams.get("day")));
  }
  if (action === "msPairingStatus") {
    mustAdmin(actor);
    return ok(await msPairingStatus(url.searchParams.get("pairing"), actor, env));
  }
  fail("ไม่รู้จักคำสั่งที่ส่งมา", "UNKNOWN_ACTION");
}

async function post(body, env) {
  const action = String(body.action || "");
  if (action === "login") return ok(await login(body, env));
  if (action === "completeMsPairing") return ok(await completeMsPairing(body, env));
  if (action === "connectorSync") return ok(await connectorSync(body, env));
  if (action === "bootstrapConnector")
    return ok(await bootstrapConnector(body, env));
  const actor = await verify(body.token, env);
  if (action === "cancelMsRoute")
    return ok(await cancelMsRoute(body, actor, env));
  if (action === "import") return ok(await importRows(body, actor, env));
  if (action === "saveMsOriginManifestConnection")
    return ok(await saveOriginManifestConnection(
      env,
      actor,
      pickBranch(actor, body.hub),
      body.credentials,
    ));
  if (action === "start") return ok(await work(body.id, actor, env, true));
  if (action === "cancelStart")
    return ok(await work(body.id, actor, env, false));
  if (action === "complete")
    return ok(await archive(body.id, "COMPLETED", body.note, actor, env));
  if (action === "remove")
    return ok(await archive(body.id, "REMOVED", body.note, actor, env));
  if (action === "restoreHistory")
    return ok(await restore(body.id, body.actionAt, actor, env));
  if (action === "clearQueue")
    return ok(await clearQueue(body.note, actor, env));
  if (action === "saveSettings") {
    mustAdmin(actor);
    return ok(await saveSettings(body, actor, env));
  }
  if (action === "saveUser") {
    mustAdmin(actor);
    return ok(await saveUser(body.user || {}, actor, env));
  }
  if (action === "setUserActive") {
    mustAdmin(actor);
    return ok(await setActive(body, actor, env));
  }
  if (action === "changePassword")
    return ok(await changePassword(body, actor, env));
  if (action === "syncMsRoutes") return ok(await syncMs(body, actor, env));
  if (action === "saveMsConnection") {
    const saved = await saveMsConnection(body, actor, env);
    const live = await refreshMsIfStale(env, actor, saved.hub, true);
    return ok({ ...saved, live });
  }
  if (action === "saveMsPreEntryConnection") {
    const saved = await saveMsPreEntryConnection(body, actor, env);
    const live = await refreshMsIfStale(env, actor, saved.hub, true);
    return ok({ ...saved, live });
  }
  if (action === "saveMsBusConnection") {
    const saved = await saveMsBusConnection(body, actor, env);
    const live = await refreshMsIfStale(env, actor, saved.hub, true);
    return ok({ ...saved, live });
  }
  if (action === "saveMsHbiConnection") return ok(await saveMsHbiConnection(body, actor, env));
  if (action === "createMsPairing") {
    return ok(await createMsPairing(body, actor, env));
  }
  fail("ไม่รู้จักคำสั่งที่ส่งมา", "UNKNOWN_ACTION");
}

async function login(body, env) {
  const username = text(body.username, 30).toUpperCase();
  let user;
  try {
    user = await env.DB.prepare("SELECT * FROM users WHERE username=?")
      .bind(username)
      .first();
  } catch (error) {
    failAuthRead(error, "login", username);
  }
  if (
    !user &&
    username === "ADMIN" &&
    env.INITIAL_ADMIN_PASSWORD &&
    String(body.pin) === env.INITIAL_ADMIN_PASSWORD
  ) {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        "ADMIN",
        await passHash("ADMIN", body.pin, env),
        "admin",
        "*",
        1,
        now,
        now,
        "BOOTSTRAP",
      )
      .run();
    try {
      user = await env.DB.prepare(
        "SELECT * FROM users WHERE username='ADMIN'",
      ).first();
    } catch (error) {
      failAuthRead(error, "login", username);
    }
  }
  if (
    !user ||
    user.active !== 1 ||
    !(await passMatch(username, body.pin, user.password_hash, env))
  )
    fail("Username หรือรหัสจัดการไม่ถูกต้อง", "INVALID_LOGIN", 401);
  const expiresAt = Date.now() + SESSION_MS;
  const payload = b64(
    new TextEncoder().encode(
      JSON.stringify({
        username,
        role: user.role,
        branches: branchList(user.branches),
        expiresAt,
        nonce: crypto.randomUUID(),
      }),
    ),
  );
  const token = `${payload}.${await hmac(payload, env.AUTH_SECRET)}`;
  // Seed the short authorization cache from the login row. The first Live,
  // KIT and TBR requests must not repeat the same Turso user read.
  rememberAuthUser(user);
  await audit(
    env,
    "LOGIN",
    "",
    `ถึง ${new Date(expiresAt).toISOString()}`,
    username,
  );
  return {
    username,
    role: user.role,
    branches: branchList(user.branches),
    token,
    expiresAt,
  };
}

// AUTH_SESSION_RESILIENCE_V1: sessions are stateless and valid for 180 days.
// A transient DB/Turso failure must never be mislabeled as INVALID_SESSION,
// because clients intentionally remove their persisted token on INVALID_SESSION.
async function verify(token, env) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature)
    fail("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "INVALID_SESSION", 401);

  let signatureValid = false;
  try {
    signatureValid = await equal(signature, await hmac(payload, env.AUTH_SECRET));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "auth_signature_verify_unavailable",
        message: error?.message || String(error),
      }),
    );
    fail(
      "ระบบยืนยันสิทธิ์ขัดข้องชั่วคราว กรุณาลองใหม่",
      "AUTH_VERIFY_UNAVAILABLE",
      503,
    );
  }
  if (!signatureValid)
    fail("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "INVALID_SESSION", 401);

  let actor;
  try {
    actor = JSON.parse(new TextDecoder().decode(unb64(payload)));
  } catch {
    fail("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "INVALID_SESSION", 401);
  }
  if (!actor?.username || Date.now() > Number(actor.expiresAt))
    fail("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "INVALID_SESSION", 401);

  let user;
  try {
    user = await verifiedAuthUser(actor.username, env);
  } catch (error) {
    failAuthRead(error, "verify", actor.username);
  }

  if (!user || user.active !== 1 || user.role !== actor.role)
    fail("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "INVALID_SESSION", 401);
  return {
    username: user.username,
    role: user.role,
    branches: branchList(user.branches),
  };
}
async function scoped(env, table, actor, order = "", limit = 0) {
  const allowed =
    actor.role === "admin" || actor.branches.includes("*")
      ? null
      : actor.branches;
  if (allowed && !allowed.length) return [];
  const where = allowed
    ? ` WHERE hub IN (${allowed.map(() => "?").join(",")})`
    : "";
  const q = env.DB.prepare(
    `SELECT * FROM ${table}${where}${order ? ` ORDER BY ${order}` : ""}${limit ? ` LIMIT ${limit}` : ""}`,
  ).bind(...(allowed || []));
  return (await q.all()).results.map(output);
}

async function importRows(body, actor, env) {
  if (!Array.isArray(body.rows) || body.rows.length > 3000)
    fail("ข้อมูลนำเข้าไม่ถูกต้องหรือมากเกินไป");
  const defaultHub =
      actor.role !== "admin" && actor.branches.length === 1
        ? actor.branches[0]
        : "",
    incoming = new Map();
  for (const r of body.rows) {
    const hub = text(r.hub || defaultHub, 80).toUpperCase();
    if (!hub || !access(hub, actor))
      fail(
        `ไม่มีสิทธิ์นำเข้าข้อมูลของสาขา ${hub || "ที่ไม่ระบุ"}`,
        "FORBIDDEN",
        403,
      );
    if (!r.previousStation || !r.arrivalAt) continue;
    const id =
      text(r.id, 100) ||
      (await sha([r.barcode, r.routeName, r.arrivalAt, hub].join("|")));
    incoming.set(id, { id, hub, r });
  }
  const hubs = [...new Set([...incoming.values()].map((x) => x.hub))];
  const old = hubs.length
    ? await env.DB.prepare(
        `SELECT id,work_status,started_at,started_by FROM active_trucks WHERE hub IN (${hubs.map(() => "?").join(",")})`,
      )
        .bind(...hubs)
        .all()
    : { results: [] };
  const oldMap = new Map(old.results.map((x) => [x.id, x])),
    statements = hubs.map((h) =>
      env.DB.prepare("DELETE FROM active_trucks WHERE hub=?").bind(h),
    );
  for (const { id, hub, r } of incoming.values()) {
    const prior = oldMap.get(id);
    statements.push(
      env.DB.prepare(
        "INSERT INTO active_trucks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        text(r.barcode, 100),
        text(r.previousStation, 200),
        text(r.routeName, 300),
        text(r.driverName, 160),
        phone(r.driverPhone),
        text(r.vehicleType, 80),
        text(r.plate, 100),
        Number(r.parcels) || 0,
        date(r.arrivalAt),
        hub,
        text(r.supplier, 240),
        new Date().toISOString(),
        text(body.fileName, 200),
        prior?.work_status || "",
        prior?.started_at || "",
        prior?.started_by || "",
      ),
    );
  }
  await batches(env, statements);
  await audit(
    env,
    "IMPORT",
    "",
    `${text(body.fileName, 200)}: ${incoming.size}`,
    actor.username,
  );
  return {
    imported: incoming.size,
    total: incoming.size,
    removed: Math.max(0, old.results.length - incoming.size),
    skipped: 0,
    branches: hubs,
  };
}

async function truck(id, actor, env) {
  const row = await env.DB.prepare("SELECT * FROM active_trucks WHERE id=?")
    .bind(String(id || ""))
    .first();
  if (!row) fail("ไม่พบรถรายการนี้ กรุณารีเฟรชหน้าเว็บ", "NOT_FOUND", 404);
  if (!access(row.hub, actor))
    fail("ไม่มีสิทธิ์จัดการข้อมูลของสาขานี้", "FORBIDDEN", 403);
  return row;
}

async function work(id, actor, env, start) {
  await truck(id, actor, env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE active_trucks SET work_status=?,started_at=?,started_by=? WHERE id=?",
  )
    .bind(
      start ? "UNLOADING" : "",
      start ? now : "",
      start ? actor.username : "",
      String(id),
    )
    .run();
  await audit(
    env,
    start ? "START" : "CANCEL_START",
    String(id),
    "",
    actor.username,
  );
  return output(
    await env.DB.prepare("SELECT * FROM active_trucks WHERE id=?")
      .bind(String(id))
      .first(),
  );
}

async function archive(id, status, note, actor, env) {
  const r = await truck(id, actor, env),
    actionAt = new Date().toISOString();
  await env.DB.batch([
    historyInsert(env, r, status, actionAt, note, actor.username),
    env.DB.prepare("DELETE FROM active_trucks WHERE id=?").bind(r.id),
  ]);
  await audit(env, status, r.id, text(note, 500), actor.username);
  return { id: r.id, status, actionAt };
}

function historyInsert(env, r, status, at, note, operator) {
  return env.DB.prepare(
    "INSERT INTO truck_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    crypto.randomUUID(),
    r.id,
    r.barcode,
    r.previous_station,
    r.route_name,
    r.driver_name,
    r.driver_phone,
    r.vehicle_type,
    r.plate,
    r.parcels,
    r.arrival_at,
    r.hub,
    r.supplier,
    r.imported_at,
    r.source_file,
    r.work_status,
    r.started_at,
    r.started_by,
    status,
    at,
    text(note, 500),
    operator,
  );
}

async function restore(id, actionAt, actor, env) {
  const r = await env.DB.prepare(
    "SELECT * FROM truck_history WHERE id=? AND action_at=? AND status='COMPLETED'",
  )
    .bind(String(id), String(actionAt))
    .first();
  if (!r || !access(r.hub, actor))
    fail("ไม่พบประวัติที่กู้คืนได้", "NOT_FOUND", 404);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR REPLACE INTO active_trucks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      r.id,
      r.barcode,
      r.previous_station,
      r.route_name,
      r.driver_name,
      r.driver_phone,
      r.vehicle_type,
      r.plate,
      r.parcels,
      r.arrival_at,
      r.hub,
      r.supplier,
      r.imported_at,
      r.source_file,
      "",
      "",
      "",
    ),
    env.DB.prepare("DELETE FROM truck_history WHERE history_id=?").bind(
      r.history_id,
    ),
  ]);
  await audit(env, "RESTORE", r.id, "", actor.username);
  return { restored: true };
}

async function clearQueue(note, actor, env) {
  const rows = await scoped(env, "active_trucks", actor),
    at = new Date().toISOString(),
    statements = [];
  for (const item of rows) {
    const r = await env.DB.prepare("SELECT * FROM active_trucks WHERE id=?")
      .bind(item.id)
      .first();
    statements.push(
      historyInsert(env, r, "CLEARED", at, note, actor.username),
      env.DB.prepare("DELETE FROM active_trucks WHERE id=?").bind(r.id),
    );
  }
  await batches(env, statements);
  await audit(env, "CLEAR_QUEUE", "", `${rows.length} rows`, actor.username);
  return { cleared: rows.length };
}

// HUB_SETTINGS_CACHE_V1: settings do not change at realtime cadence.
// Cache/coalesce per HUB for 60 seconds and invalidate immediately on save.
const HUB_SETTINGS_CACHE_MS = 60 * 1000;
const hubSettingsCache = new Map();
const hubSettingsActive = new Map();
function invalidateHubSettings(branch) {
  hubSettingsCache.delete(String(branch || "").toUpperCase());
}

async function readSettings(env, branch) {
  const key = String(branch || "").toUpperCase();
  const now = Date.now();
  const cached = hubSettingsCache.get(key);
  if (cached?.until > now) return cached.value;
  if (cached) hubSettingsCache.delete(key);
  if (hubSettingsActive.has(key)) return hubSettingsActive.get(key);
  const task = (async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT * FROM hub_settings WHERE branch=? AND enabled=1 ORDER BY category,setting_key",
      )
        .bind(key)
        .all()
    ).results;
    const central = CENTRAL_LIMITS[key] || [],
      queue = rows.filter((x) => x.category === "vehicle"),
      ms = rows.filter((x) => x.category === "ms_vehicle"),
      pauses = rows.filter((x) => x.category === "pause");
    return {
      branch: key,
      pauseWindows: pauses.length
        ? pauses.map((x) => ({
            key: x.setting_key,
            label: x.label,
            startHour: x.start_hour,
            endHour: x.end_hour,
          }))
        : rows.length
          ? []
          : PAUSES.map((x) => ({
              key: x[0], label: x[1], startHour: x[2], endHour: x[3],
            })),
      vehicleLimits: queue.length
        ? queue.map((x) => ({ type: x.setting_key, minutes: x.minutes }))
        : LIMITS.map((type) => ({ type, minutes: 120 })),
      msVehicleLimits: ms.length
        ? ms.map((x) => ({ type: x.setting_key, minutes: x.minutes }))
        : LIMITS.map((type, i) => ({ type, minutes: central[i] || 120 })),
    };
  })()
    .then((value) => {
      hubSettingsCache.set(key, { until: Date.now() + HUB_SETTINGS_CACHE_MS, value });
      return value;
    })
    .finally(() => hubSettingsActive.delete(key));
  hubSettingsActive.set(key, task);
  return task;
}

async function saveSettings(body, actor, env) {
  const branch = pickBranch(actor, body.branch),
    pauses = body.settings?.pauseWindows || [],
    limits = body.settings?.vehicleLimits || [],
    msLimits = body.settings?.msVehicleLimits || [];
  if (!limits.length || !msLimits.length)
    fail("ต้องมีประเภทรถอย่างน้อย 1 ประเภท");
  const now = new Date().toISOString(),
    s = [
      env.DB.prepare(
        "DELETE FROM hub_settings WHERE branch=? AND category IN ('pause','vehicle','ms_vehicle')",
      ).bind(branch),
    ];
  pauses.forEach((x, i) =>
    s.push(
      env.DB.prepare(
        "INSERT INTO hub_settings VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        branch,
        "pause",
        `pause-${i + 1}`,
        text(x.label, 100) || `ช่วงไม่มีกะ ${i + 1}`,
        Number(x.startHour),
        Number(x.endHour),
        null,
        1,
        now,
        actor.username,
      ),
    ),
  );
  limits.forEach((x) =>
    s.push(
      env.DB.prepare(
        "INSERT INTO hub_settings VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        branch,
        "vehicle",
        text(x.type, 20).toUpperCase(),
        "",
        null,
        null,
        Number(x.minutes) || 120,
        1,
        now,
        actor.username,
      ),
    ),
  );
  msLimits.forEach((x) =>
    s.push(
      env.DB.prepare(
        "INSERT INTO hub_settings VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        branch,
        "ms_vehicle",
        text(x.type, 20).toUpperCase(),
        "",
        null,
        null,
        Number(x.minutes) || 120,
        1,
        now,
        actor.username,
      ),
    ),
  );
  await env.DB.batch(s);
  invalidateHubSettings(branch);
  return readSettings(env, branch);
}

async function users(env) {
  return (
    await env.DB.prepare(
      "SELECT username,role,branches,active,created_at,updated_at,updated_by FROM users ORDER BY username",
    ).all()
  ).results.map((x) => ({
    username: x.username,
    role: x.role,
    branches: branchList(x.branches),
    active: x.active === 1,
    createdAt: x.created_at,
    updatedAt: x.updated_at,
    updatedBy: x.updated_by,
  }));
}

async function saveUser(input, actor, env) {
  const username = text(input.username, 30).toUpperCase(),
    role = String(input.role || "operator").toLowerCase(),
    bs = (input.branches || [])
      .map((x) => text(x, 80).toUpperCase())
      .filter(Boolean),
    password = String(input.password || "");
  if (!/^[A-Z0-9_-]{2,30}$/.test(username)) fail("Username ไม่ถูกต้อง");
  if (!["operator", "admin"].includes(role) || (role !== "admin" && !bs.length))
    fail("สิทธิ์หรือสาขาไม่ถูกต้อง");
  const old = await env.DB.prepare("SELECT * FROM users WHERE username=?")
    .bind(username)
    .first();
  if ((!old && !password) || (password && password.length < 6))
    fail("รหัสผ่านต้องมีอย่างน้อย 6 ตัว");
  const now = new Date().toISOString(),
    hash = password
      ? await passHash(username, password, env)
      : old.password_hash;
  invalidateAuthUser(username);
  await env.DB.prepare(
    "INSERT INTO users VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,branches=excluded.branches,active=excluded.active,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
  )
    .bind(
      username,
      hash,
      role,
      role === "admin" ? "*" : bs.join(","),
      input.active === false ? 0 : 1,
      old?.created_at || now,
      now,
      actor.username,
    )
    .run();
  await audit(
    env,
    "SAVE_USER",
    username,
    `${role}/${bs.join(",")}`,
    actor.username,
  );
  return users(env);
}

async function setActive(body, actor, env) {
  invalidateAuthUser(text(body.username, 30).toUpperCase());
  await env.DB.prepare(
    "UPDATE users SET active=?,updated_at=?,updated_by=? WHERE username=?",
  )
    .bind(
      body.active ? 1 : 0,
      new Date().toISOString(),
      actor.username,
      text(body.username, 30).toUpperCase(),
    )
    .run();
  return users(env);
}
async function changePassword(body, actor, env) {
  const u = await env.DB.prepare(
    "SELECT password_hash FROM users WHERE username=?",
  )
    .bind(actor.username)
    .first();
  if (
    !(await passMatch(
      actor.username,
      body.currentPassword,
      u.password_hash,
      env,
    ))
  )
    fail("รหัสผ่านปัจจุบันไม่ถูกต้อง");
  if (String(body.newPassword || "").length < 6)
    fail("รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัว");
  await env.DB.prepare(
    "UPDATE users SET password_hash=?,updated_at=?,updated_by=? WHERE username=?",
  )
    .bind(
      await passHash(actor.username, body.newPassword, env),
      new Date().toISOString(),
      actor.username,
      actor.username,
    )
    .run();
  return { changed: true };
}

async function confirmActionPin(actor, pin, env) {
  const user = await env.DB.prepare(
    "SELECT password_hash,active FROM users WHERE username=?",
  )
    .bind(actor.username)
    .first();
  if (!user || Number(user.active) !== 1 || !(await passMatch(actor.username, pin, user.password_hash, env)))
    fail("รหัสจัดการไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่", "INVALID_CONFIRMATION_PIN", 401);
}

function routeCancellationMeta(row) {
  return { queueCancelledAt: row.cancelled_at || "", queueCancelledBy: row.cancelled_by || "", queueCancelReason: row.reason || "ยกเลิกเส้นทาง" };
}

async function activeRouteCancellations(env, hub) {
  return (await env.DB.prepare("SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1").bind(hub).all()).results;
}

async function applyRouteCancellationsToRows(env, hub, rows) {
  const cancellations = await activeRouteCancellations(env, hub);
  if (!cancellations.length) return rows || [];
  const byId = new Map(cancellations.map((row) => [String(row.route_id), row]));
  return (rows || []).map((row) => {
    const cancellation = byId.get(String(row.id || row.routeId || ""));
    if (!cancellation || (cancellation.proof_id && row.proofId && String(cancellation.proof_id) !== String(row.proofId))) return row;
    return { ...row, ...routeCancellationMeta(cancellation) };
  });
}

async function markCancelledInLiveCache(env, hub, routeId, proofId, meta) {
  const cache = await env.DB.prepare("SELECT rows_json FROM ms_live_cache WHERE hub=?").bind(hub).first();
  if (!cache) return false;
  let parsed;
  try { parsed = JSON.parse(cache.rows_json || "[]"); } catch { return false; }
  const legacy = Array.isArray(parsed);
  const rows = legacy ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];
  let changed = false;
  const nextRows = rows.map((row) => {
    const idMatch = String(row.id || row.routeId || "") === String(routeId);
    const proofMatch = !proofId || !row.proofId || String(row.proofId) === String(proofId);
    if (!idMatch || !proofMatch) return row;
    changed = true;
    return { ...row, ...meta };
  });
  const completedRows = legacy ? [] : (Array.isArray(parsed.completedRows) ? parsed.completedRows : []).filter((row) => String(row.id || row.routeId || "") !== String(routeId));
  const completedChanged = !legacy && completedRows.length !== (Array.isArray(parsed.completedRows) ? parsed.completedRows.length : 0);
  if (!changed && !completedChanged) return false;
  const payload = legacy ? nextRows : { ...parsed, rows: nextRows, completedRows };
  await env.DB.prepare("UPDATE ms_live_cache SET rows_json=? WHERE hub=?").bind(JSON.stringify(payload), hub).run();
  return true;
}

async function cancelMsRoute(body, actor, env) {
  const hub = pickBranch(actor, body.branch);
  const routeId = text(body.routeId, 200);
  if (!routeId) fail("ไม่พบรหัสเส้นทาง", "INVALID_ROUTE", 400);
  await confirmActionPin(actor, body.pin, env);
  const route = await env.DB.prepare("SELECT id,proof_id,route_name,attendance_type,actual_arrival_at,actual_departure_at,unloading_state,schedule_kit_arrival_at,schedule_tbr_arrival_at FROM ms_routes WHERE hub=? AND id=?").bind(hub, routeId).first();
  if (!route) fail("ไม่พบเส้นทางนี้ใน HUB ปัจจุบัน", "ROUTE_NOT_FOUND", 404);
  const attendance = normalizeMsAttendance(route.attendance_type);
  if (attendance === "ปลายทาง")
    fail("งานปลายทางไม่สามารถยกเลิกรถจากคิวด้วยมือได้", "DESTINATION_CANCEL_NOT_ALLOWED", 409);
  const done = attendance === "ปลายทาง" ? Number(route.unloading_state) === 2 : attendance === "จุดดรอป" ? Number(route.unloading_state) === 2 && Boolean(route.actual_departure_at) : Boolean(route.actual_departure_at);
  if (done) fail("เส้นทางนี้ดำเนินการเสร็จแล้ว จึงไม่สามารถยกเลิกจากคิวได้", "ROUTE_ALREADY_DONE", 409);
  const effectiveArrival = earliestDate(route.actual_arrival_at, route.schedule_kit_arrival_at, route.schedule_tbr_arrival_at);
  if (!route.actual_arrival_at || !effectiveArrival || Date.now() - Date.parse(effectiveArrival) > 12 * 60 * 60 * 1000) fail("เส้นทางนี้ไม่ได้อยู่ในคิวปัจจุบันแล้ว", "ROUTE_NOT_ACTIVE", 409);
  const existing = await env.DB.prepare("SELECT proof_id,cancelled_at,cancelled_by,reason,active FROM ms_route_cancellations WHERE hub=? AND route_id=?").bind(hub, routeId).first();
  if (Number(existing?.active) === 1 && (!existing.proof_id || String(existing.proof_id) === String(route.proof_id || ""))) {
    const meta = routeCancellationMeta(existing);
    await markCancelledInLiveCache(env, hub, routeId, route.proof_id || "", meta);
    return { hub, routeId, proofId: route.proof_id || "", routeName: route.route_name || "", cancelledAt: meta.queueCancelledAt, cancelledBy: meta.queueCancelledBy, reason: meta.queueCancelReason, alreadyCancelled: true };
  }
  const now = new Date().toISOString();
  const reason = "ยกเลิกเส้นทาง";
  await env.DB.prepare("INSERT INTO ms_route_cancellations(hub,route_id,proof_id,route_name,cancelled_at,cancelled_by,reason,active) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(hub,route_id) DO UPDATE SET proof_id=excluded.proof_id,route_name=excluded.route_name,cancelled_at=excluded.cancelled_at,cancelled_by=excluded.cancelled_by,reason=excluded.reason,active=1").bind(hub, routeId, route.proof_id || "", route.route_name || "", now, actor.username, reason).run();
  const meta = { queueCancelledAt: now, queueCancelledBy: actor.username, queueCancelReason: reason };
  await markCancelledInLiveCache(env, hub, routeId, route.proof_id || "", meta);
  await audit(env, "CANCEL_MS_ROUTE", routeId, JSON.stringify({ hub, proofId: route.proof_id || "", routeName: route.route_name || "", reason }), actor.username);
  return { hub, routeId, proofId: route.proof_id || "", routeName: route.route_name || "", cancelledAt: now, cancelledBy: actor.username, reason, alreadyCancelled: false };
}

// MS_QUOTA_SAFE_LIVE_V1: live source changes diff against the existing live-cache snapshot.
// A full ms_routes read remains only as a cold-cache / explicit-sync fallback.
async function syncMs(body, actor, env) {
  if (!Array.isArray(body.rows) || body.rows.length > 2000)
    fail("ข้อมูล MS ไม่ถูกต้องหรือเกิน 2,000 รายการ");
  const branch = text(
    body.branch || (actor.role === "admin" ? "" : actor.branches[0]),
    80,
  ).toUpperCase();
  if (!branch || !access(branch, actor))
    fail("ไม่มีสิทธิ์ซิงก์ HUB นี้", "FORBIDDEN", 403);
  await ensureMsCompletionRepair(env, branch);
  const cacheBaseline = Array.isArray(body.baselineRows)
    ? body.baselineRows
    : null;
  const [oldRowsResult, cancellationResult] = await Promise.all([
    cacheBaseline
      ? Promise.resolve({ results: [] })
      : env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?").bind(branch).all(),
    env.DB.prepare(
      "SELECT route_id,proof_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",
    )
      .bind(branch)
      .all(),
  ]);
  const oldRows = cacheBaseline || oldRowsResult.results.map(output);
  const cancellationById = new Map(
    cancellationResult.results.map((row) => [String(row.route_id), row]),
  );
  const oldById = new Map(oldRows.map((row) => [row.id, row]));
  const now = new Date().toISOString(),
    seen = new Set(),
    prepared = [];
  for (const r of body.rows) {
    // A vehicle, plate and driver can repeat every day. Keep every trip by its
    // dispatch barcode and attendance side; use the MS row id only when a trip
    // has not been assigned a barcode yet.
    const natural = normalizeProofId(r.proofId)
      ? [normalizeProofId(r.proofId), text(r.attendanceType, 100), date(r.estimatedArrivalAt || r.estimatedDepartureAt)].join("|")
      : text(r.id, 160);
    if (!natural) continue;
    const id = await sha(`${branch}|${natural}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const old = oldById.get(id),
      unloadingState =
        r.unloadingState !== null &&
        r.unloadingState !== undefined &&
        r.unloadingState !== "" &&
        Number.isFinite(Number(r.unloadingState))
          ? Number(r.unloadingState)
          : null,
      completionTruth = resolveCompletionTruth(
        old,
        unloadingState,
        r.scheduleUnloadingCompletedAt,
        now,
      ),
      unloadingCompletedAt = completionTruth.at;
    const values = [
      id,
      branch,
      text(r.proofId, 100),
      text(r.routeName, 300),
      text(r.region, 60),
      text(r.routeAttribute, 100),
      text(r.routeType, 100),
      text(r.attendanceType, 100),
      date(r.estimatedArrivalAt),
      date(r.actualArrivalAt),
      date(r.estimatedDepartureAt),
      date(r.actualDepartureAt),
      text(r.supplier, 240),
      text(r.vehicleType, 80),
      text(r.plate, 100),
      text(r.driverName, 160),
      phone(r.driverPhone),
      text(r.trackingStatus, 120),
      text(r.vehicleStatus, 120),
      text(r.loadStatus, 120),
      unloadingState,
      unloadingCompletedAt,
      date(r.sourceUpdatedAt),
      numberOrNull(r.expectedParcels),
      numberOrNull(r.enteredParcels),
      numberOrNull(r.pendingParcels),
      date(r.scheduleKitArrivalAt),
      date(r.scheduleTbrArrivalAt),
      numberOrNull(r.arrivedParcels),
      numberOrNull(r.arrivedBags),
      now,
      actor.username,
    ];
    const snapshot = {
      id,
      hub: branch,
      proofId: values[2],
      routeName: values[3],
      region: values[4],
      routeAttribute: values[5],
      routeType: values[6],
      attendanceType: values[7],
      estimatedArrivalAt: values[8],
      actualArrivalAt: values[9],
      estimatedDepartureAt: values[10],
      actualDepartureAt: values[11],
      supplier: values[12],
      vehicleType: values[13],
      plate: values[14],
      driverName: values[15],
      driverPhone: values[16],
      trackingStatus: values[17],
      vehicleStatus: values[18],
      loadStatus: values[19],
      unloadingState: values[20],
      unloadingCompletedAt: values[21],
      completionSource: completionTruth.source,
      scheduleUnloadingStartedAt: date(r.scheduleUnloadingStartedAt),
      scheduleUnloadingCompletedAt: date(r.scheduleUnloadingCompletedAt),
      sourceUpdatedAt: values[22],
      expectedParcels: values[23],
      enteredParcels: values[24],
      pendingParcels: values[25],
      scheduleKitArrivalAt: values[26],
      scheduleTbrArrivalAt: values[27],
      arrivedParcels: values[28],
      arrivedBags: values[29],
    };
    const cancellation = cancellationById.get(String(id));
    if (
      cancellation &&
      (!cancellation.proof_id || !snapshot.proofId || String(cancellation.proof_id) === String(snapshot.proofId))
    ) {
      snapshot.queueCancelledAt = cancellation.cancelled_at || "";
      snapshot.queueCancelledBy = cancellation.cancelled_by || "";
      snapshot.queueCancelReason = cancellation.reason || "ยกเลิกเส้นทาง";
    }
    prepared.push({ id, values, snapshot });
  }
  const plan = planMsChanges(
      oldRows,
      prepared.map((item) => item.snapshot),
      Boolean(body.preserveMissing),
    ),
    changedIds = new Set(plan.changedIds),
    removedIds = new Set(plan.removedIds),
    statements = [];
  for (const item of prepared) {
    const old = oldById.get(item.id);
    if (changedIds.has(item.id)) {
      if (!old)
        statements.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO ms_route_registry(hub,route_id,first_seen_at) VALUES(?,?,?)",
          ).bind(branch, item.id, now),
        );
      statements.push(
        env.DB.prepare(
          "INSERT OR REPLACE INTO ms_routes(id,hub,proof_id,route_name,region,route_attribute,route_type,attendance_type,estimated_arrival_at,actual_arrival_at,estimated_departure_at,actual_departure_at,supplier,vehicle_type,plate,driver_name,driver_phone,tracking_status,vehicle_status,load_status,unloading_state,unloading_completed_at,source_updated_at,expected_parcels,entered_parcels,pending_parcels,schedule_kit_arrival_at,schedule_tbr_arrival_at,arrived_parcels,arrived_bags,synced_at,synced_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(...item.values),
      );
      statements.push(
        env.DB.prepare(
          "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          item.id,
          branch,
          old ? "UPDATED" : "FIRST_SEEN",
          now,
          JSON.stringify({
            ...item.snapshot,
            completionObservedLive: Boolean(item.snapshot?.unloadingCompletedAt),
          }),
          actor.username,
        ),
      );
    }
  }
  for (const old of oldRows)
    if (removedIds.has(old.id))
      statements.push(
        env.DB.prepare(
          "INSERT INTO ms_route_history VALUES(?,?,?,?,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          old.id,
          branch,
          "REMOVED",
          now,
          JSON.stringify(old),
          actor.username,
        ),
        env.DB.prepare("DELETE FROM ms_routes WHERE id=?").bind(old.id),
      );
  if (statements.length) await batches(env, statements);
  const businessChanges = plan.changedIds.length + plan.removedIds.length;
  if (businessChanges) {
    try {
      await audit(
        env,
        "SYNC_MS_ROUTES",
        branch,
        `${seen.size} current / ${businessChanges} business changes`,
        actor.username,
      );
    } catch (error) {
      console.error(JSON.stringify({ event: "ms_sync_audit_error", branch, message: error.message }));
    }
  }
  const responseRows = prepared.map((item) => {
    const old = oldById.get(item.id);
    const previous = old || null;
    const changed = changedIds.has(item.id);
    return {
      ...item.snapshot,
      completionObservedLive: Boolean(item.snapshot?.unloadingCompletedAt),
      syncedAt: changed ? now : previous?.syncedAt || now,
      syncedBy: changed ? actor.username : previous?.syncedBy || actor.username,
    };
  });
  return {
    branch,
    synced: seen.size,
    syncedAt: now,
    changes: businessChanges,
    rows: responseRows,
  };
}

async function msRealtimeStream(request, url, env) {
  const actor = await verify(url.searchParams.get("token"), env);
  const branch = pickBranch(actor, url.searchParams.get("branch"));
  if (!env.MS_REFRESH_COORDINATOR) fail("Realtime coordinator ไม่พร้อมใช้งาน", "MS_STREAM_UNAVAILABLE", 503);
  const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);
  const stub = env.MS_REFRESH_COORDINATOR.get(id);
  const target = new URL("https://ms-refresh.internal/stream");
  target.searchParams.set("branch", branch);
  return stub.fetch(new Request(target, request));
}

async function refreshMsIfStale(env, actor, branch, force = false) {
  if (!access(branch, actor)) return { status: "forbidden" };
  const nowMs = Date.now(), recent = recentMsSync.get(branch);
  if (!force && recent?.until > nowMs) return recent.result;
  if (activeMsSync.has(branch)) return activeMsSync.get(branch);

  if (env.MS_REFRESH_COORDINATOR) {
    const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);
    const stub = env.MS_REFRESH_COORDINATOR.get(id);
    const url = new URL("https://ms-refresh.internal/refresh");
    url.searchParams.set("branch", branch);
    if (force) url.searchParams.set("force", "1");
    const response = await stub.fetch(new Request(url));
    if (!response.ok) {
      const error = new Error("ตัวประสานการอัปเดต MS ตอบกลับผิดพลาด");
      error.code = "MS_COORDINATOR_ERROR";
      throw error;
    }
    const result = await response.json();
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  }

  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));
  activeMsSync.set(branch, task);
  return task;
}

export class MsRefreshCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.active = null;
    this.lastResult = null;
    this.recentUntil = 0;
    this.lastSourceAt = 0;
    this.routeRateLimitedUntil = 0;
    this.routeRateLimitStrikes = 0;
    this.originManifest = new OriginManifestCoordinator(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get(MS_ROUTE_QUOTA_GUARD_KEY);
      if (saved && typeof saved === "object") {
        this.routeRateLimitedUntil = Number(saved.until || 0);
        this.routeRateLimitStrikes = Number(saved.strikes || 0);
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/quota-reset") {
      this.routeRateLimitedUntil = 0;
      this.routeRateLimitStrikes = 0;
      await this.ctx.storage.delete(MS_ROUTE_QUOTA_GUARD_KEY);
      return Response.json({ ok: true, reset: true });
    }
    if (url.pathname.startsWith("/origin-manifest/"))
      return this.originManifest.fetch(request);
    const branch = String(url.searchParams.get("branch") || "").trim().toUpperCase();
    if (url.pathname === "/stream") return this.openStream(request, branch);
    const force = url.searchParams.get("force") === "1";
    const cron = url.searchParams.get("cron") === "1";
    if (!branch)
      return Response.json(
        { status: "error", error: "missing branch" },
        { status: 400 },
      );
    return Response.json(await this.refresh(branch, force, cron));
  }

  async openStream(request, branch) {
    if (!branch) return new Response("missing branch", { status: 400 });
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket")
      return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const leader = this.ctx.getWebSockets().length === 0;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ branch, leader });
    server.send(JSON.stringify({ type: "role", leader }));
    this.ctx.waitUntil(this.pushSnapshot(server, branch).catch((error) => {
      try {
        server.send(JSON.stringify({
          type: "error",
          code: error?.code || "MS_STREAM_ERROR",
          message: error?.message || "Realtime stream ขัดข้อง",
        }));
      } catch {}
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async streamPayload(branch) {
    const live = await this.refresh(branch, false, false);
    const settings = await readSettings(this.env, branch);
    return {
      type: "snapshot",
      rows: Array.isArray(live?.rows) ? live.rows : null,
      completedToday: Number(live?.completedToday) || 0,
      standards: settings.msVehicleLimits,
      lastSync: live?.syncedAt || "",
      msStatus: live?.status || "",
      syncError: live?.error || "",
      pollMs: 4000,
    };
  }

  async pushSnapshot(ws, branch) {
    ws.send(JSON.stringify(await this.streamPayload(branch)));
  }

  async broadcastSnapshot(branch) {
    const payload = JSON.stringify(await this.streamPayload(branch));
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment?.() || {};
      if (String(attachment.branch || "").toUpperCase() !== branch) continue;
      try { socket.send(payload); } catch {}
    }
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.deserializeAttachment?.() || {};
    const branch = String(attachment.branch || "").trim().toUpperCase();
    if (!branch) {
      try { ws.close(1008, "missing branch"); } catch {}
      return;
    }
    let payload = {};
    try { payload = JSON.parse(String(message || "{}")); } catch {}
    try {
      const actor = await verify(payload?.token, this.env);
      if (!access(branch, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);
      if (payload?.type === "auth") {
        ws.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }
      if (payload?.type !== "refresh") return;
      await this.broadcastSnapshot(branch);
    } catch (error) {
      const code = error?.code || "MS_STREAM_ERROR";
      try {
        ws.send(JSON.stringify({
          type: code === "INVALID_SESSION" || code === "FORBIDDEN" ? "auth_error" : "error",
          code,
          message: error?.message || "Realtime stream ขัดข้อง",
        }));
      } catch {}
      if (code === "INVALID_SESSION" || code === "FORBIDDEN")
        try { ws.close(1008, "auth"); } catch {}
    }
  }

  webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment?.() || {};
    const wasLeader = attachment.leader === true;
    try { ws.close(code, reason); } catch {}
    if (!wasLeader) return;
    const next = this.ctx.getWebSockets().find((socket) => socket !== ws);
    if (!next) return;
    const nextAttachment = next.deserializeAttachment?.() || {};
    nextAttachment.leader = true;
    next.serializeAttachment(nextAttachment);
    try { next.send(JSON.stringify({ type: "role", leader: true })); } catch {}
  }

  webSocketError(ws) {
    try { ws.close(1011, "stream error"); } catch {}
  }

  async refresh(branch, force = false, cron = false) {
    const nowMs = Date.now();
    if (!force && this.routeRateLimitedUntil > nowMs) {
      const retryAt = new Date(this.routeRateLimitedUntil).toISOString();
      if (this.lastResult?.rows)
        return {
          ...this.lastResult,
          status: "degraded",
          errorCode: "MS_ROUTE_RATE_LIMIT",
          quotaGuard: "cooldown",
          retryAt,
        };
      return {
        status: "degraded",
        errorCode: "MS_ROUTE_RATE_LIMIT",
        error: "MS จำกัดคำขอชั่วคราว ระบบหยุดยิงต้นทางและรอรอบปลอดภัย",
        changes: 0,
        rows: [],
        quotaGuard: "cooldown",
        retryAt,
      };
    }
    if (
      cron &&
      this.lastResult &&
      nowMs - this.lastSourceAt < MS_CRON_ACTIVE_SKIP_MS
    )
      return { ...this.lastResult, cronSkipped: true };
    if (!force && this.lastResult && this.recentUntil > nowMs)
      return this.lastResult;

    if (this.active) {
      if (!force && this.lastResult) return this.lastResult;
      try {
        await this.active;
      } catch {}
      if (!force && this.lastResult && this.recentUntil > Date.now())
        return this.lastResult;
    }

    const task = runMsRefresh(this.env, branch)
      .then(async (result) => {
        if (result?.errorCode === "MS_ROUTE_RATE_LIMIT") {
          this.routeRateLimitStrikes = Math.min(8, this.routeRateLimitStrikes + 1);
          const cooldownMs = Math.min(
            MS_ROUTE_RATE_LIMIT_MAX_COOLDOWN_MS,
            MS_ROUTE_RATE_LIMIT_BASE_COOLDOWN_MS * (2 ** Math.max(0, this.routeRateLimitStrikes - 1)),
          );
          this.routeRateLimitedUntil = Date.now() + cooldownMs;
          await this.ctx.storage.put(MS_ROUTE_QUOTA_GUARD_KEY, {
            strikes: this.routeRateLimitStrikes,
            until: this.routeRateLimitedUntil,
          });
        } else if (result?.status === "synced" && (this.routeRateLimitStrikes || this.routeRateLimitedUntil)) {
          this.routeRateLimitStrikes = 0;
          this.routeRateLimitedUntil = 0;
          await this.ctx.storage.delete(MS_ROUTE_QUOTA_GUARD_KEY);
        }
        this.lastResult = result;
        this.lastSourceAt = Date.now();
        this.recentUntil = Date.now() + MS_SYNC_TTL;
        return result;
      })
      .finally(() => {
        if (this.active === task) this.active = null;
      });
    this.active = task;
    return task;
  }
}

// MS_CRON_LIVE_REFRESH_V1: the existing one-minute Worker cron keeps the main MS
// route source alive even when every browser is closed. It reuses the same
// per-HUB Durable Object, so an actively polling browser suppresses the cron
// read for 45 seconds instead of causing a duplicate upstream MS request.
const MS_CRON_ACTIVE_SKIP_MS = 45 * 1000;
const MS_ROUTE_QUOTA_GUARD_KEY = "route-quota-guard-v12";

export async function runMsScheduledRefresh(env) {
  let rows = [];
  try {
    rows = (
      await env.DB.prepare("SELECT hub FROM ms_connections ORDER BY hub").all()
    ).results || [];
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ms_cron_connection_list_error",
        message: error.message || String(error),
      }),
    );
    return;
  }

  const actor = { username: "MS_CRON", role: "admin", branches: ["*"] };
  for (const row of rows.slice(0, 20)) {
    const branch = text(row?.hub, 80).toUpperCase();
    if (!branch) continue;
    try {
      if (env.MS_REFRESH_COORDINATOR) {
        const id = env.MS_REFRESH_COORDINATOR.idFromName(branch);
        const stub = env.MS_REFRESH_COORDINATOR.get(id);
        const url = new URL("https://ms-refresh.internal/refresh");
        url.searchParams.set("branch", branch);
        url.searchParams.set("cron", "1");
        const response = await stub.fetch(new Request(url));
        if (!response.ok) {
          const error = new Error("ตัวประสาน Cron MS ตอบกลับผิดพลาด");
          error.code = "MS_CRON_COORDINATOR_ERROR";
          throw error;
        }
      } else {
        await refreshMsIfStale(env, actor, branch);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ms_cron_sync_error",
          hub: branch,
          code: error.code || "MS_CRON_SYNC_FAILED",
          message: error.message || String(error),
        }),
      );
    }
  }
}

// MS_COMPLETION_BURST_TRUTH_V3: legacy mass catch-up observations are not authoritative unload-finish times.
function hasLegacyCompletionBurstRows(rows) {
  const groups = new Map();
  const legacyBefore = Date.parse("2026-09-08T12:39:00.000Z");
  for (const row of Array.isArray(rows) ? rows : []) {
    const completion = String(row?.unloadingCompletedAt ?? row?.unloading_completed_at ?? "");
    const completionMs = Date.parse(completion);
    const arrivalMs = Date.parse(String(row?.actualArrivalAt ?? row?.actual_arrival_at ?? ""));
    const id = String(row?.id ?? row?.route_id ?? row?.proofId ?? "");
    if (!id || !Number.isFinite(completionMs) || !Number.isFinite(arrivalMs)) continue;
    if (completionMs >= legacyBefore) continue;
    const group = groups.get(completion) || { ids: new Set(), minArrival: Infinity, maxArrival: -Infinity };
    group.ids.add(id);
    group.minArrival = Math.min(group.minArrival, arrivalMs);
    group.maxArrival = Math.max(group.maxArrival, arrivalMs);
    groups.set(completion, group);
  }
  return [...groups.values()].some((group) =>
    group.ids.size >= 8 && group.maxArrival - group.minArrival >= 60 * 60 * 1000
  );
}

async function runMsRefresh(env, branch) {
  const credentials = await msCredentials(env, branch);
  if (!credentials)
    return {
      status: "not_configured",
      error: `HUB ${branch} ยังไม่ได้อัปเดตเซสชัน MS`,
    };
  try {
    const rows = await readMsRoutes(credentials);
    const [parcelCounts, busData] = await Promise.all([
      readPreEntryCounts(env, branch),
      readBusTimeData(env, branch),
    ]);
    const tbrShadowFeed = msTbrShadowFeed(busData);
    const previousEnrichment =
      parcelCounts.sourceFailed || busData.sourceFailed
        ? await readMsLiveCache(env, branch)
        : null;
    const previousById = new Map(
      (previousEnrichment?.rows || []).map((row) => [row.id, row]),
    );
    const mappedRows = rows.map((row) => {
      const mapped = enrichMsRow(mapMsRow(row), parcelCounts, busData);
      const previous = previousById.get(mapped.id);
      if (previous && parcelCounts.sourceFailed) {
        mapped.expectedParcels = previous.expectedParcels;
        mapped.enteredParcels = previous.enteredParcels;
        mapped.pendingParcels = previous.pendingParcels;
      }
      if (previous && busData.sourceFailed) {
        mapped.scheduleKitArrivalAt = previous.scheduleKitArrivalAt;
        mapped.scheduleTbrArrivalAt = previous.scheduleTbrArrivalAt;
        mapped.arrivedParcels = previous.arrivedParcels;
        mapped.arrivedBags = previous.arrivedBags;
      }
      return mapped;
    });
    const sourceHash = MS_LIVE_CACHE_VERSION + ":" + await sha(canonicalMsSource(mappedRows));
    let cache = await readMsLiveCache(env, branch, sourceHash);
    let sync;
    let syncClaim = null;
    let publishSource = false;

    if (cache?.sourceMatch) {
      sync = {
        syncedAt: new Date().toISOString(),
        changes: 0,
        rows: cache.rows,
      };
    } else {
      const claim = await acquireMsSyncClaim(env, branch, sourceHash);
      if (claim.acquired) {
        syncClaim = claim;
        const currentCache = await readMsLiveCache(env, branch, sourceHash);
        if (currentCache?.sourceMatch) {
          cache = currentCache;
          sync = {
            syncedAt: new Date().toISOString(),
            changes: 0,
            rows: currentCache.rows,
          };
          await finishMsSyncClaim(env, branch, claim, true);
          syncClaim = null;
        } else {
          cache = currentCache || cache;
          try {
            const baselineCache = currentCache || cache;
            sync = await syncMs(
              {
                branch,
                rows: mappedRows,
                baselineRows:
                  String(baselineCache?.sourceHash || "").startsWith("completion-v2:")
                    ? baselineCache?.rows || null
                    : null,
              },
              { username: "MS_AUTO", role: "admin", branches: ["*"] },
              env,
            );
            publishSource = true;
          } catch (error) {
            await finishMsSyncClaim(env, branch, claim, false);
            syncClaim = null;
            throw error;
          }
        }
      } else {
        const settled = await waitForMsSourceCache(env, branch, sourceHash);
        if (settled?.sourceMatch) {
          cache = settled;
          sync = {
            syncedAt: new Date().toISOString(),
            changes: 0,
            rows: settled.rows,
          };
        } else {
          sync = {
            syncedAt: new Date().toISOString(),
            changes: 0,
            rows: cache?.rows || [],
          };
        }
      }
    }
    const completedDay = thaiDay();
    const completionCacheReady =
      cache?.format === 6 &&
      cache.completedDay === completedDay &&
      cache.completedRows.every(
        (row) => typeof row?.completionObservedLive === "boolean",
      );
    const priorCompleted = completionCacheReady
      ? cache.completedRows
      : await bootstrapCompletedToday(env, branch, completedDay);
    const completedRows = mergeCompletedToday(priorCompleted, sync.rows, completedDay);
    let cacheWrite = null;
    if (
      publishSource ||
      (cache?.sourceMatch &&
        (cache?.format !== 6 ||
          cache?.completedDay !== completedDay ||
          !completionCacheReady))
    )
      cacheWrite = await safeStatusWrite(
        writeMsLiveCache(
          env,
          branch,
          sourceHash,
          sync.rows,
          sync.syncedAt,
          completedDay,
          completedRows,
        ),
        "ms_live_cache_write_error",
        branch,
      );
    if (syncClaim) {
      await finishMsSyncClaim(env, branch, syncClaim, Boolean(cacheWrite));
      syncClaim = null;
    }
    await safeStatusWrite(
      markConnectionSuccess(env, "ms_connections", branch, sync.syncedAt),
      "ms_connection_success_write_error",
      branch,
    );
    const result = {
      status: "synced",
      syncedAt: sync.syncedAt,
      changes: sync.changes,
      rows: sync.rows,
      completedToday: completedRows.length,
      tbrShadowFeed,
    };
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  } catch (error) {
    const transient =
      error?.code === "UPSTREAM_TIMEOUT" ||
      error?.code === "MS_HTTP_ERROR" ||
      error?.code === "MS_ROUTE_SOURCE_ERROR" ||
      error?.code === "MS_ROUTE_RATE_LIMIT" ||
      error instanceof TypeError;
    if (transient) {
      const fallback = await readMsLiveCache(env, branch);
      if (fallback?.rows) {
        console.warn(
          JSON.stringify({
            event: "ms_sync_degraded",
            branch,
            code: error.code || "MS_NETWORK_ERROR",
            message: error.message,
          }),
        );
        const result = {
          status: "degraded",
          errorCode: error?.code || "MS_NETWORK_ERROR",
          changes: 0,
          rows: fallback.rows,
          completedToday:
            fallback.completedDay === thaiDay()
              ? fallback.completedRows.length
              : 0,
          error:
            "MS ตอบช้าชั่วคราว ระบบแสดงข้อมูลล่าสุดและจะลองใหม่อัตโนมัติ",
        };
        recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
        return result;
      }
    }
    await safeStatusWrite(
      markConnectionError(env, "ms_connections", branch, error.message),
      "ms_connection_error_write_error",
      branch,
    );
    console.error(
      JSON.stringify({
        event: "ms_sync_error",
        code: error.code || "MS_SYNC_FAILED",
        message: error.message,
      }),
    );
    const result = {
      status: "error",
      errorCode: error?.code || "MS_SYNC_FAILED",
      error: error.message || "เชื่อมต่อ MS ไม่สำเร็จ",
    };
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  }
}

// MS_COMPLETION_TIME_TRUTH_V2: completion time is authoritative only when this system observed 0/1 -> 2.
async function verifiedCompletionRouteIds(env, hub) {
  // MS_SCHEDULE_COMPLETION_TRUTH_V4: Route owns status; safely matched Schedule E
  // remains trusted completion timing evidence without restoring correlated scans.
  const result = await env.DB.prepare(
    `WITH ordered AS (
       SELECT route_id,snapshot_at,rowid,event_type,synced_by,payload_json,
              CAST(json_extract(payload_json,'$.unloadingState') AS INTEGER) AS current_state,
              LAG(CAST(json_extract(payload_json,'$.unloadingState') AS INTEGER))
                OVER (PARTITION BY route_id ORDER BY snapshot_at,rowid) AS previous_state,
              COALESCE(json_extract(payload_json,'$.unloadingCompletedAt'),'') AS completion_at,
              COALESCE(json_extract(payload_json,'$.completionSource'),'') AS completion_source,
              COALESCE(json_extract(payload_json,'$.actualArrivalAt'),'') AS actual_arrival
         FROM ms_route_history
        WHERE hub=? AND json_valid(payload_json)=1
     ),
     transitions AS (
       SELECT route_id,completion_at
         FROM ordered
        WHERE current_state=2
          AND completion_at<>''
          AND (
            completion_source='SCHEDULE'
            OR (
              previous_state IN (0,1)
              AND COALESCE(event_type,'UPDATED')<>'FIRST_SEEN'
              AND COALESCE(synced_by,'')<>'MS_RANGE'
            )
          )
     ),
     legacy_bursts AS (
       SELECT completion_at
         FROM ordered
        WHERE completion_at<>''
          AND completion_at<'2026-09-08T12:39:00.000Z'
        GROUP BY completion_at
       HAVING COUNT(DISTINCT route_id)>=8
          AND (julianday(MAX(actual_arrival))-julianday(MIN(actual_arrival))) * 86400000 >= 3600000
     )
     SELECT DISTINCT route_id
       FROM transitions
      WHERE completion_at NOT IN (SELECT completion_at FROM legacy_bursts)`,
  ).bind(hub).all();
  return new Set((result.results || []).map((row) => String(row.route_id || '')).filter(Boolean));
}

async function ensureMsCompletionRepair(env, hub) {
  if (completionRepairChecked.has(hub)) return;
  const cache = await env.DB.prepare(
    "SELECT source_hash FROM ms_live_cache WHERE hub=?",
  ).bind(hub).first();
  if (!String(cache?.source_hash || "").startsWith(MS_LIVE_CACHE_VERSION + ":")) {
    const verified = await verifiedCompletionRouteIds(env, hub);
    const polluted = (
      await env.DB.prepare(
        "SELECT id FROM ms_routes WHERE hub=? AND unloading_state=2 AND COALESCE(unloading_completed_at,'')<>''",
      ).bind(hub).all()
    ).results
      .map((row) => String(row.id || ""))
      .filter((id) => id && !verified.has(id));
    if (polluted.length) {
      const statements = polluted.map((id) =>
        env.DB.prepare(
          "UPDATE ms_routes SET unloading_completed_at='' WHERE hub=? AND id=?",
        ).bind(hub, id),
      );
      await batches(env, statements);
    }
  }
  completionRepairChecked.add(hub);
}

async function readMsLiveCache(env, hub, sourceHash = "") {
  try {
    const row = await env.DB.prepare(
      "SELECT source_hash,rows_json FROM ms_live_cache WHERE hub=?",
    )
      .bind(hub)
      .first();
    if (!row) return null;
    const parsed = JSON.parse(row.rows_json || "[]");
    const legacy = Array.isArray(parsed);
    const rows = legacy ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null;
    if (!rows) return null;
    return {
      sourceHash: String(row.source_hash || ""),
      format: legacy ? 1 : Number(parsed.version) || 0,
      sourceMatch: Boolean(sourceHash) && row.source_hash === sourceHash,
      rows,
      completedDay: legacy ? "" : String(parsed.completedDay || ""),
      completedRows: legacy || !Array.isArray(parsed.completedRows) ? [] : parsed.completedRows,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ms_live_cache_read_error",
        hub,
        message: error.message,
      }),
    );
    return null;
  }
}

async function writeMsLiveCache(
  env,
  hub,
  sourceHash,
  rows,
  syncedAt,
  completedDay = "",
  completedRows = [],
) {
  const payload = {
    version: 6,
    rows: rows || [],
    completedDay,
    completedRows: completedRows || [],
  };
  return env.DB.prepare(
    "INSERT INTO ms_live_cache(hub,source_hash,rows_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,rows_json=excluded.rows_json,synced_at=excluded.synced_at WHERE ms_live_cache.source_hash<>excluded.source_hash OR ms_live_cache.rows_json<>excluded.rows_json",
  )
    .bind(hub, sourceHash, JSON.stringify(payload), syncedAt || new Date().toISOString())
    .run();
}

function thaiDayForValue(value) {
  const dateValue = new Date(value || "");
  if (Number.isNaN(dateValue.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dateValue);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

// MS_COMPLETED_ROUTE_DAY_TRUTH_V1: completed membership comes only from accepted
// Destination/Drop Route state 2 truth. Completion timestamps remain timing
// evidence for SLA and never decide whether a completed route is counted.
function msCompletedRowBusinessDay(row) {
  const attendance = normalizeMsAttendance(row?.attendanceType);
  const value = attendance === "ต้นทาง"
    ? row?.estimatedDepartureAt || row?.actualDepartureAt || row?.estimatedArrivalAt
    : row?.estimatedArrivalAt || row?.actualArrivalAt || row?.estimatedDepartureAt;
  return thaiDayForValue(value);
}

function isCompletedForThaiDay(row, day) {
  const attendance = normalizeMsAttendance(row?.attendanceType);
  return (
    !row?.queueCancelledAt &&
    (attendance === "ปลายทาง" || attendance === "จุดดรอป") &&
    Number(row?.unloadingState) === 2 &&
    msCompletedRowBusinessDay(row) === day
  );
}

function mergeCompletedToday(previousRows, liveRows, day) {
  const latest = new Map();
  for (const row of previousRows || []) {
    const id = row?.id || row?.routeId || row?.proofId;
    if (id && isCompletedForThaiDay(row, day)) latest.set(id, row);
  }
  for (const row of liveRows || []) {
    const id = row?.id || row?.routeId || row?.proofId;
    if (id && isCompletedForThaiDay(row, day)) latest.set(id, row);
  }
  return [...latest.values()];
}

async function bootstrapCompletedToday(env, hub, day) {
  const start = new Date(`${day}T00:00:00+07:00`).toISOString();
  const history = (
    await env.DB.prepare(
      "SELECT route_id,payload_json,event_type AS action,synced_by FROM ms_route_history WHERE hub=? AND snapshot_at>=? ORDER BY snapshot_at ASC",
    )
      .bind(hub, start)
      .all()
  ).results;
  const completed = new Map();
  for (const item of history) {
    if (item.synced_by === "MS_RANGE") continue;
    try {
      const row = JSON.parse(item.payload_json || "{}");
      row.id = row.id || item.route_id;
      // MS_DAILY_COMPLETION_LEGACY_SCHEDULE_RECOVERY_V2: old history/cache rows can predate completionSource.
      // When Route says completed and the already-matched Schedule payload has a valid E,
      // recover the trusted completion at read time instead of requiring a later live transition.
      const trustedScheduleCompletedAt =
        Number(row.unloadingState) === 2 &&
        Number.isFinite(
          Date.parse(String(row.scheduleUnloadingCompletedAt || "")),
        )
          ? String(row.scheduleUnloadingCompletedAt)
          : "";
      if (trustedScheduleCompletedAt) {
        row.unloadingCompletedAt = trustedScheduleCompletedAt;
        row.completionSource = "SCHEDULE";
      }
      if (typeof row.completionObservedLive !== "boolean")
        row.completionObservedLive =
          Boolean(row.unloadingCompletedAt) &&
          item.action !== "FIRST_SEEN" && item.synced_by !== "MS_RANGE";
      if (row.id && isCompletedForThaiDay(row, day)) completed.set(row.id, row);
    } catch {}
  }
  return [...completed.values()];
}

async function readMsCompletedToday(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const day = thaiDay();
  const cache = await readMsLiveCache(env, hub);
  const completionCacheReady =
    cache?.format === 6 &&
    cache.completedDay === day &&
    cache.completedRows.every(
      (row) => typeof row?.completionObservedLive === "boolean",
    );
  const previous = completionCacheReady
    ? cache.completedRows
    : await bootstrapCompletedToday(env, hub, day);
  const rows = mergeCompletedToday(previous, cache?.rows || [], day);
  return { hub, day, total: rows.length, rows };
}

const MS_SYNC_CLAIM_LEASE_MS = 15000;

async function acquireMsSyncClaim(env, hub, sourceHash) {
  const now = new Date();
  const claimedAt = now.toISOString();
  const leaseUntil = new Date(now.getTime() + MS_SYNC_CLAIM_LEASE_MS).toISOString();
  const token = crypto.randomUUID();
  const result = await env.DB.prepare(
    "INSERT INTO ms_sync_claims(hub,source_hash,claim_token,state,lease_until,claimed_at,finished_at) VALUES(?,?,?,'ACTIVE',?,?,'') ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,claim_token=excluded.claim_token,state='ACTIVE',lease_until=excluded.lease_until,claimed_at=excluded.claimed_at,finished_at='' WHERE (ms_sync_claims.state='DONE' AND ms_sync_claims.source_hash<>excluded.source_hash) OR ms_sync_claims.state='FAILED' OR (ms_sync_claims.state='ACTIVE' AND ms_sync_claims.lease_until<?)",
  )
    .bind(hub, sourceHash, token, leaseUntil, claimedAt, claimedAt)
    .run();
  return {
    acquired: Number(result?.meta?.changes || 0) > 0,
    token,
    sourceHash,
  };
}

async function finishMsSyncClaim(env, hub, claim, success) {
  if (!claim?.token) return null;
  return safeStatusWrite(
    env.DB.prepare(
      "UPDATE ms_sync_claims SET state=?,lease_until='',finished_at=? WHERE hub=? AND claim_token=?",
    )
      .bind(
        success ? "DONE" : "FAILED",
        new Date().toISOString(),
        hub,
        claim.token,
      )
      .run(),
    "ms_sync_claim_finish_error",
    hub,
  );
}

async function waitForMsSourceCache(env, hub, sourceHash) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cache = await readMsLiveCache(env, hub, sourceHash);
    if (cache?.sourceMatch) return cache;
  }
  return null;
}

async function readMsCancelledToday(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const day = thaiDay();
  const start = new Date(`${day}T00:00:00+07:00`).toISOString();
  const end = new Date(Date.parse(start) + 86400000).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM ms_route_cancellations WHERE hub=? AND cancelled_at>=? AND cancelled_at<?",
  )
    .bind(hub, start, end)
    .first();
  return { hub, day, total: Number(row?.total) || 0 };
}

// MS_LOWER_DAILY_COUNTS_MIDNIGHT_V2: staged worker exposes lower daily facts and resets them at Bangkok midnight.
// completion cache only trusts observed live unloading transitions
async function markConnectionSuccess(env, table, hub, now = new Date().toISOString()) {
  if (!["ms_connections", "ms_preentry_connections", "ms_bus_connections"].includes(table))
    throw new Error("Unsupported connection table");
  const cutoff = new Date(Date.parse(now) - CONNECTION_HEARTBEAT_MS).toISOString();
  return env.DB.prepare(
    `UPDATE ${table} SET last_success_at=?,last_error='' WHERE hub=? AND (COALESCE(last_error,'')<>'' OR last_success_at IS NULL OR last_success_at='' OR last_success_at<?)`,
  ).bind(now, hub, cutoff).run();
}

async function markConnectionError(env, table, hub, message) {
  if (!["ms_connections", "ms_preentry_connections", "ms_bus_connections"].includes(table))
    throw new Error("Unsupported connection table");
  const value = text(message, 500);
  return env.DB.prepare(
    `UPDATE ${table} SET last_error=? WHERE hub=? AND COALESCE(last_error,'')<>?`,
  ).bind(value, hub, value).run();
}

async function safeStatusWrite(promise, event, hub) {
  try { return await promise; }
  catch (error) {
    console.error(JSON.stringify({ event, hub, message: error.message }));
    return null;
  }
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = UPSTREAM_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `ระบบต้นทางตอบช้าเกิน ${Math.ceil(timeoutMs / 1000)} วินาที`,
      );
      timeoutError.code = "UPSTREAM_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// MS_UPSTREAM_ACCOUNT_GUARD_V12: Route keeps the 4-second truth while duplicate/burst requests are blocked.
const MS_ROUTE_PAGE_CONCURRENCY = 1;
const MS_ROUTE_PAGE_BATCH_DELAY_MS = 120;
const MS_ROUTE_RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60 * 1000;
const MS_ROUTE_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60 * 1000;

export function classifyMsRouteFailure(message, httpStatus = 0) {
  const value = String(message || "").trim();
  if (Number(httpStatus) === 429 || /request\s+exceeds\s+the\s+limit|rate.?limit|too many requests|exceed(?:ed|s)?\s+(?:the\s+)?limit/i.test(value))
    return { code: "MS_ROUTE_RATE_LIMIT", status: 429 };
  if ([401, 403].includes(Number(httpStatus)) || /session|token|auth|login|expired|unauthor/i.test(value))
    return { code: "MS_SESSION_EXPIRED", status: 502 };
  return { code: "MS_ROUTE_SOURCE_ERROR", status: 502 };
}

async function readMsRoutes(credentials, wantedStart, wantedEnd) {
  const nowThai = Date.now() + 7 * 3600000;
  const start = Number.isFinite(wantedStart)
    ? wantedStart
    : Math.floor(nowThai / 86400000) * 86400000 - 7 * 3600000 - 86400000;
  // Live Route window includes previous day, today and tomorrow so trips
  // planned across Bangkok midnight are already visible before 00:00.
  const end = Number.isFinite(wantedEnd) ? wantedEnd : start + 3 * 86400000 - 1000;
  const first = await readMsPage(credentials, 1, start, end),
    rows = [...first.items];
  const pages = Math.min(
    20,
    Math.ceil((Number(first.total) || rows.length) / 100),
  );
  if (pages > 1) {
    const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);
    for (let offset = 0; offset < remainingPages.length; offset += MS_ROUTE_PAGE_CONCURRENCY) {
      const pageBatch = remainingPages.slice(offset, offset + MS_ROUTE_PAGE_CONCURRENCY);
      const results = await Promise.all(pageBatch.map((page) =>
        readMsPage(credentials, page, start, end)));
      for (const result of results) rows.push(...result.items);
      if (offset + MS_ROUTE_PAGE_CONCURRENCY < remainingPages.length)
        await new Promise((resolve) => setTimeout(resolve, MS_ROUTE_PAGE_BATCH_DELAY_MS));
    }
  }
  return rows;
}

async function msRange(env, actor, hub, startValue, endValue) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const start = thaiDateBoundary(startValue, false),
    end = thaiDateBoundary(endValue, true);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    fail("กรุณาเลือกช่วงวันที่ให้ถูกต้อง", "INVALID_DATE_RANGE");
  if (end - start > 31 * 86400000)
    fail("เลือกย้อนหลังได้ครั้งละไม่เกิน 31 วัน", "DATE_RANGE_TOO_LARGE");
  const credentials = await msCredentials(env, hub);
  if (!credentials)
    fail(`HUB ${hub} ยังไม่ได้อัปเดตเซสชัน MS`, "MS_NOT_CONFIGURED");
  const rows = await readMsRoutes(credentials, start, end);
  const days = dateRangeDays(startValue, endValue);
  const parcelCounts = await readPreEntryCounts(env, hub, days);
  const busData = await readBusTimeData(env, hub, days);
  await syncMs(
    { branch: hub, rows: rows.map((row) => enrichMsRow(mapMsRow(row), parcelCounts, busData)), preserveMissing: true },
    { username: "MS_RANGE", role: "admin", branches: ["*"] },
    env,
  );
  return { branch: hub, total: rows.length, start: startValue, end: endValue };
}

function dateRangeDays(startValue, endValue) {
  const days = [], start = Date.parse(`${startValue}T00:00:00Z`), end = Date.parse(`${endValue}T00:00:00Z`);
  for (let value = start; Number.isFinite(value) && value <= end && days.length < 32; value += 86400000)
    days.push(new Date(value).toISOString().slice(0, 10));
  return days;
}

export function enrichMsRow(mapped, parcelCounts, busData) {
  // Cross-source matching is deliberately barcode-only. Never use plate,
  // driver or route name because regular vehicles repeat those values daily.
  const parcels = findEnrichment(parcelCounts, mapped);
  const bus = findBusEnrichment(busData, mapped);
  if (bus) {
    mapped.scheduleKitArrivalAt = bus.scheduleKitArrivalAt;
    mapped.scheduleTbrArrivalAt = bus.scheduleTbrArrivalAt;
    mapped.arrivedParcels = bus.arrivedParcels;
    mapped.arrivedBags = bus.arrivedBags;
    mapped.scheduleUnloadingStartedAt = bus.scheduleUnloadingStartedAt || "";
    mapped.scheduleUnloadingCompletedAt = bus.scheduleUnloadingCompletedAt || "";
  }
  if (mapped.attendanceType === "ปลายทาง" && parcels) Object.assign(mapped, parcels);
  return mapped;
}

function thaiDateBoundary(value, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return NaN;
  const time = Date.parse(`${value}T00:00:00+07:00`);
  return endOfDay ? time + 86400000 - 1000 : time;
}

async function readMsPage(credentials, page, start, end) {
  const url = new URL(
    "https://ms-api.flashexpress.com/gw/nws/staff/ms/store/line/task",
  );
  const query = {
    currentStore: "",
    startTime: String(Math.floor(start / 1000)),
    endTime: String(Math.floor(end / 1000)),
    originStore: "",
    passStore: "",
    targetStore: "",
    pageSize: "100",
    pageNum: String(page),
    sortingNo: "",
    fleetId: "",
    plateNumber: "",
    lineType: "",
    _t: String(Date.now()),
  };
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "th",
      "Cache-Control": "no-cache",
      Origin: "https://ms.flashexpress.com",
      Referer: "https://ms.flashexpress.com/",
      "User-Agent": "Mozilla/5.0",
      "X-DEVICE-ID": credentials.deviceId,
      "X-FH-MS-EQUIPMENT-TYPE": "5",
      "X-FLE-SESSION-ID": credentials.sessionId,
    },
  });
  if (!response.ok) {
    const message = `MS ตอบกลับ ${response.status}`;
    const failure = classifyMsRouteFailure(message, response.status);
    fail(message, failure.code, failure.status);
  }
  const json = await response.json();
  if (json.code !== 1) {
    const message = json.message || json.msg || "MS ตอบกลับผิดพลาด";
    const failure = classifyMsRouteFailure(message);
    fail(message, failure.code, failure.status);
  }
  return {
    items: Array.isArray(json.data?.items) ? json.data.items : [],
    total: Number(json.data?.pagination?.total_count) || 0,
  };
}

async function saveMsConnection(body, actor, env) {
  const hub = text(body.hub, 80).toUpperCase(),
    sessionId = text(body.sessionId, 2000),
    deviceId = text(body.deviceId, 500);
  if (!hub || !sessionId || !deviceId)
    fail("ไฟล์ HAR ไม่มีข้อมูลเซสชัน MS ที่ต้องใช้", "INVALID_HAR");
  if (!access(hub, actor))
    fail("บัญชีนี้ไม่มีสิทธิ์เชื่อมต่อ HUB ที่เลือก", "FORBIDDEN", 403);
  return persistMsConnection(hub, sessionId, deviceId, actor.username, env);
}

async function saveMsPreEntryConnection(body, actor, env) {
  const hub = text(body.hub, 80).toUpperCase();
  if (!hub || !access(hub, actor))
    fail("บัญชีนี้ไม่มีสิทธิ์เชื่อมต่อ HUB ที่เลือก", "FORBIDDEN", 403);
  const credentials = {};
  for (const key of ["lang", "auth", "fbid", "time", "_from", "nonce", "referer", "iv", "next_store_id"])
    credentials[key] = text(body.credentials?.[key], 2000);
  if (!credentials.auth || !credentials.fbid || !credentials.nonce || !credentials.iv)
    fail("ไฟล์ HAR ไม่มีข้อมูลเชื่อมต่อพัสดุที่คาดว่าจะเข้าคลัง", "INVALID_HAR");
  const test = await readPreEntryPage(credentials, 1, thaiDay());
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ms_preentry_connections(hub,credentials_cipher,updated_at,updated_by,last_success_at,last_error) VALUES(?,?,?,?,?,?) ON CONFLICT(hub) DO UPDATE SET credentials_cipher=excluded.credentials_cipher,updated_at=excluded.updated_at,updated_by=excluded.updated_by,last_success_at=excluded.last_success_at,last_error=''",
  ).bind(hub, await encryptMs(JSON.stringify(credentials), env), now, actor.username, now, "").run();
  await audit(env, "SAVE_MS_PREENTRY_CONNECTION", hub, `ทดสอบสำเร็จ ${test.total} รายการ`, actor.username);
  return { hub, total: test.total, updatedAt: now, source: "preEntry" };
}

function thaiDay() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function thaiDayOffset(offset) {
  const bangkokNow = Date.now() + 7 * 3600000 + Number(offset || 0) * 86400000;
  return new Date(bangkokNow).toISOString().slice(0, 10);
}

function liveSourceDays() {
  // Keep the previous operating day after midnight. Night routes often finish
  // after 00:00 and both supporting MS pages otherwise hide them too early.
  return [thaiDayOffset(-1), thaiDayOffset(0)];
}

// MS_TBR_SHADOW_FEED_V1: expose only barcode + KIT/TBR timestamps from the BusTime
// payload already fetched for enrichment. This helper never reads or writes DB.
function msTbrShadowFeed(busData) {
  if (!(busData instanceof Map) || busData.sourceFailed) return [];
  const seen = new Set();
  const feed = [];
  for (const item of busData.values()) {
    const proofId = normalizeProofId(item?.proofId);
    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);
    if (!proofId || !tbrAt || seen.has(proofId)) continue;
    seen.add(proofId);
    feed.push({
      proofId: text(item?.proofId, 100),
      scheduleTbrArrivalAt: tbrAt,
      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),
    });
  }
  return feed;
}

function tbrInboundAttendance(value) {
  const normalized = normalizeMsAttendance(value);
  return normalized === "ปลายทาง" || normalized === "จุดดรอป";
}

async function readTbrShadowBusData(env, hub, wantedDays = liveSourceDays()) {
  // Read-only BusTime source for TBR Shadow. No connection heartbeat writes.
  const row = await env.DB.prepare(
    "SELECT credentials_cipher FROM ms_bus_connections WHERE hub=?",
  ).bind(hub).first();
  if (!row) return new Map();
  const credentials = JSON.parse(await decryptMs(row.credentials_cipher, env));
  const rows = [];
  for (const day of wantedDays) {
    const first = await readBusPage(credentials, 1, day);
    rows.push(...first.items);
    const pages = Math.min(20, Math.ceil((first.total || first.items.length) / 100));
    if (pages > 1) {
      const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);
      for (let offset = 0; offset < remainingPages.length; offset += BUS_TIME_PAGE_CONCURRENCY) {
        const pageBatch = remainingPages.slice(offset, offset + BUS_TIME_PAGE_CONCURRENCY);
        const results = await Promise.all(pageBatch.map((page) => readBusPage(credentials, page, day)));
        results.forEach((result) => rows.push(...result.items));
        if (offset + BUS_TIME_PAGE_CONCURRENCY < remainingPages.length)
          await new Promise((resolve) => setTimeout(resolve, BUS_TIME_PAGE_BATCH_DELAY_MS));
      }
    }
  }
  const result = new Map();
  for (const item of rows) {
    const targetStore = String(nestedValue(item.next_store_info, 0) || "").toUpperCase();
    if (targetStore && !targetStore.includes(String(hub).toUpperCase())) continue;
    const proofId = nestedValue(item.proof_id, 0);
    const key = normalizeProofId(proofId);
    if (!key) continue;
    const kit = msDate(nestedValue(item.kit_arrive_time, 0));
    const tbr = msDate(nestedValue(item.fleet_sign_info, 0));
    const current = result.get(`P:${key}`) || {};
    const candidate = {
      proofId: text(proofId, 100),
      routeName: text(nestedValue(item.line_info, 0), 300),
      scheduleKitArrivalAt: earliestDate(current.scheduleKitArrivalAt, kit),
      scheduleTbrArrivalAt: earliestDate(current.scheduleTbrArrivalAt, tbr),
      arrivedParcels: Math.max(Number(current.arrivedParcels) || 0, Number(nestedValue(item.parcel_count, 0)) || 0),
      arrivedBags: Math.max(Number(current.arrivedBags) || 0, Number(nestedValue(item.pack_count, 0)) || 0),
    };
    setEnrichmentAliases(result, candidate, proofId);
  }
  return result;
}

// TBR_SHADOW_SPLIT_V2: split Route and BusTime into separate Worker invocations.
// TBR_ROUTE_OPERATING_WINDOW_V3 / TBR_ROUTE_CHUNK_RETRY_V4 / TBR_ROUTE_ADAPTIVE_RETRY_V5
// are retained as compatibility helpers for existing deploy gates only. V12 no
// longer invokes these helpers from TBR Shadow; both Shadow parts reuse the
// accepted main live cache, so TBR Intelligence adds zero MS upstream polling.
function tbrShadowRouteRanges(now = Date.now()) {
  const nowThai = now + 7 * 60 * 60 * 1000;
  const todayStartBangkok = Math.floor(nowThai / 86400000) * 86400000 - 7 * 60 * 60 * 1000;
  return [
    { label: "yesterday", start: todayStartBangkok - 86400000, end: todayStartBangkok - 1000 },
    { label: "today", start: todayStartBangkok, end: todayStartBangkok + 86400000 - 1000 },
  ];
}

async function readTbrRouteRangeAttempt(credentials, range) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await readMsRoutes(credentials, range.start, range.end); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError || new Error("Route " + range.label + " failed");
}

async function readTbrRouteRangeAdaptive(credentials, range, depth = 0) {
  try { return await readTbrRouteRangeAttempt(credentials, range); }
  catch (error) {
    const span = Number(range.end) - Number(range.start) + 1;
    if (depth >= 2 || span <= 6 * 60 * 60 * 1000) {
      error.message = "[" + range.label + " depth=" + depth + "] " + (error.message || "Route source failed");
      throw error;
    }
    const middle = Number(range.start) + Math.floor(span / 2);
    const left = { label: range.label + "-A", start: Number(range.start), end: middle - 1 };
    const right = { label: range.label + "-B", start: middle, end: Number(range.end) };
    const [leftRows, rightRows] = await Promise.all([
      readTbrRouteRangeAdaptive(credentials, left, depth + 1),
      readTbrRouteRangeAdaptive(credentials, right, depth + 1),
    ]);
    return [...leftRows, ...rightRows];
  }
}

async function readTbrRouteRangeWithRetry(credentials, range) {
  return readTbrRouteRangeAdaptive(credentials, range);
}

function tbrShadowBusDays(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  return hour < 12 ? [thaiDayOffset(-1), thaiDayOffset(0)] : [thaiDayOffset(0)];
}

function tbrShadowPartQuota(part) {
  return {
    mode: "SHADOW_READONLY_SPLIT_V2_CACHE_V12",
    part,
    tursoPointReadsThisCall: 2,
    tursoPointReadsPerCron: 4,
    tursoWritesPerCron: 0,
    routeTableReads: 0,
    routeTableWrites: 0,
    historyReads: 0,
    historyWrites: 0,
    liveCacheReads: 1,
    liveCacheWrites: 0,
    preEntryCalls: 0,
    extraMsPolling: 0,
  };
}

// TBR_LIVE_CACHE_ENVELOPE_V13: accept both legacy array cache and current V2 envelope.
async function readTbrShadowLiveCache(env, hub, sourceLabel) {
  const cached = await env.DB.prepare(
    "SELECT rows_json,synced_at FROM ms_live_cache WHERE hub=?",
  ).bind(hub).first();
  if (!cached)
    fail("ยังไม่มี live cache สำหรับ " + sourceLabel, "TBR_CACHE_EMPTY", 503);
  let parsed, rows;
  try {
    parsed = JSON.parse(cached.rows_json || "[]");
    rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.rows)
        ? parsed.rows
        : null;
  } catch {
    fail("live cache สำหรับ " + sourceLabel + " อ่านไม่ได้", "TBR_CACHE_INVALID", 503);
  }
  if (!rows)
    fail("live cache สำหรับ " + sourceLabel + " ไม่ถูกต้อง", "TBR_CACHE_INVALID", 503);
  return {
    rows,
    syncedAt: text(cached.synced_at, 100),
    cacheFormat: Array.isArray(parsed) ? 1 : Number(parsed?.version) || 0,
  };
}

// TBR_ROUTE_REUSE_LIVE_CACHE_V12: Route Shadow consumes the same accepted main Route
// snapshot already refreshed by the 4-second shared coordinator. No second MS
// Route request stream is allowed from the one-minute Browser/TBR cron.
async function readTbrShadowRouteFromLiveCache(env, hub) {
  const cached = await readTbrShadowLiveCache(env, hub, "Route");
  if (cached.rows.length === 0) {
    const existing = await env.DB.prepare(
      "SELECT id FROM ms_routes WHERE hub=? LIMIT 1",
    ).bind(hub).first();
    if (existing)
      fail("live cache Route เป็น 0 ทั้งที่ยังมี Route truth อยู่", "TBR_ROUTE_CACHE_INCONSISTENT", 503);
  }
  const rows = cached.rows
    .filter((row) => tbrInboundAttendance(row?.attendanceType))
    .map((row) => ({
      proofId: text(row?.proofId, 100),
      attendanceType: normalizeMsAttendance(row?.attendanceType),
      actualArrivalAt: date(row?.actualArrivalAt),
    }))
    .filter((row) => normalizeProofId(row.proofId));
  return { rows, syncedAt: cached.syncedAt };
}

// TBR_BUS_REUSE_LIVE_CACHE_V10: TBR Bus shadow reuses the accepted main live cache instead
// of issuing a second Fleet Time Management request stream.
async function readTbrShadowBusFromLiveCache(env, hub) {
  const cached = await readTbrShadowLiveCache(env, hub, "TBR / BusTime");
  const seen = new Set();
  const feed = [];
  for (const item of cached.rows) {
    if (!tbrInboundAttendance(item?.attendanceType)) continue;
    const proofId = normalizeProofId(item?.proofId);
    const tbrAt = text(item?.scheduleTbrArrivalAt, 100);
    if (!proofId || !tbrAt || seen.has(proofId)) continue;
    seen.add(proofId);
    feed.push({
      proofId: text(item?.proofId, 100),
      scheduleTbrArrivalAt: tbrAt,
      scheduleKitArrivalAt: text(item?.scheduleKitArrivalAt, 100),
    });
  }
  return { feed, syncedAt: cached.syncedAt };
}

// TBR_BUS_DAILY_SPLIT_V9: shadowDay remains a compatibility field only.
async function readTbrShadowSnapshot(env, hub, part, shadowDay) {
  if (part === "routes") {
    let cachedRoute;
    try { cachedRoute = await readTbrShadowRouteFromLiveCache(env, hub); }
    catch (error) {
      const code = String(error?.code || "ROUTE_CACHE_FAILED");
      fail(error?.message || "อ่าน Route จาก live cache ไม่สำเร็จ",
        code.startsWith("TBR_ROUTE_") ? code : `TBR_ROUTE_${code}`, 503);
    }
    return {
      status: "shadow_readonly_routes_cache",
      syncedAt: cachedRoute.syncedAt || new Date().toISOString(),
      changes: 0,
      rows: cachedRoute.rows,
      tbrShadowFeed: [],
      shadowQuota: tbrShadowPartQuota("routes"),
    };
  }

  if (part === "bus") {
    let cachedBus;
    try { cachedBus = await readTbrShadowBusFromLiveCache(env, hub); }
    catch (error) {
      const code = String(error?.code || "BUS_CACHE_FAILED");
      fail(error?.message || "อ่าน TBR / BusTime จาก live cache ไม่สำเร็จ",
        code.startsWith("TBR_BUS_") ? code : `TBR_BUS_${code}`, 503);
    }
    return {
      status: "shadow_readonly_bus_cache",
      syncedAt: cachedBus.syncedAt || new Date().toISOString(),
      changes: 0,
      rows: [],
      tbrShadowFeed: cachedBus.feed,
      shadowDay: String(shadowDay || ""),
      shadowQuota: tbrShadowPartQuota("bus"),
    };
  }

  fail("TBR Shadow ต้องระบุ source part", "TBR_SHADOW_PART_REQUIRED", 400);
}

async function preEntryCredentials(env, hub) {
  const row = await env.DB.prepare(
    "SELECT credentials_cipher FROM ms_preentry_connections WHERE hub=?",
  ).bind(hub).first();
  if (!row) return null;
  try { return JSON.parse(await decryptMs(row.credentials_cipher, env)); }
  catch { return null; }
}

// PREENTRY_RATE_GUARD_V12 / OPTIONAL_SOURCE_RATE_GUARD_V12: one shared real read/minute; hard backoff on provider limit.
const PREENTRY_SOURCE_TTL_MS = 60 * 1000;
const PREENTRY_PAGE_CONCURRENCY = 1;
const PREENTRY_PAGE_BATCH_DELAY_MS = 120;
const preEntrySourceCache = new Map();
const preEntrySourceActive = new Map();
const preEntryRateGuard = new Map();

function preEntrySourceKey(hub, wantedDays) {
  return String(hub || "").toUpperCase() + "|" + (Array.isArray(wantedDays) ? wantedDays.join(",") : "");
}

async function readPreEntryCounts(env, hub, wantedDays = liveSourceDays()) {
  const key = preEntrySourceKey(hub, wantedDays);
  const now = Date.now();
  const cached = preEntrySourceCache.get(key);
  const guard = preEntryRateGuard.get(key);
  if (guard?.until > now) {
    if (cached?.data) {
      cached.data.sourceStale = true;
      cached.data.retryAt = new Date(guard.until).toISOString();
      return cached.data;
    }
    const failed = new Map();
    failed.sourceFailed = true;
    failed.sourceCode = "PREENTRY_RATE_LIMIT";
    failed.retryAt = new Date(guard.until).toISOString();
    return failed;
  }
  if (cached && cached.until > now) return cached.data;
  if (preEntrySourceActive.has(key)) return preEntrySourceActive.get(key);
  const task = readPreEntryCountsFresh(env, hub, wantedDays)
    .then((data) => {
      if (data instanceof Map && data.sourceFailed !== true) {
        data.sourceStale = false;
        preEntryRateGuard.delete(key);
        preEntrySourceCache.set(key, { until: Date.now() + PREENTRY_SOURCE_TTL_MS, data });
        return data;
      }
      if (data?.sourceCode === "PREENTRY_RATE_LIMIT") {
        const previous = preEntryRateGuard.get(key);
        const strikes = Math.min(8, Number(previous?.strikes || 0) + 1);
        const until = Date.now() + optionalRateCooldownMs(strikes);
        preEntryRateGuard.set(key, { strikes, until });
        if (cached?.data) {
          cached.data.sourceStale = true;
          cached.data.retryAt = new Date(until).toISOString();
          return cached.data;
        }
      }
      return data;
    })
    .finally(() => preEntrySourceActive.delete(key));
  preEntrySourceActive.set(key, task);
  return task;
}

async function readPreEntryCountsFresh(env, hub, wantedDays = liveSourceDays()) {
  const credentials = await preEntryCredentials(env, hub);
  if (!credentials) return new Map();
  try {
    const rows = [];
    for (const day of wantedDays) {
      const first = await readPreEntryPage(credentials, 1, day);
      rows.push(...first.items);
      const pages = Math.min(20, Math.ceil((first.total || first.items.length) / 100));
      if (pages > 1) {
        const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);
        for (let offset = 0; offset < remainingPages.length; offset += PREENTRY_PAGE_CONCURRENCY) {
          const pageBatch = remainingPages.slice(offset, offset + PREENTRY_PAGE_CONCURRENCY);
          const results = await Promise.all(pageBatch.map((page) => readPreEntryPage(credentials, page, day)));
          results.forEach((result) => rows.push(...result.items));
          if (offset + PREENTRY_PAGE_CONCURRENCY < remainingPages.length)
            await new Promise((resolve) => setTimeout(resolve, PREENTRY_PAGE_BATCH_DELAY_MS));
        }
      }
    }
    await safeStatusWrite(
      markConnectionSuccess(env, "ms_preentry_connections", hub),
      "ms_preentry_success_write_error",
      hub,
    );
    const counts = new Map();
    for (const row of rows) {
      const key = normalizeProofId(row.proof_id);
      if (!key) continue;
      const value = {
        proofId: text(row.proof_id, 100),
        routeName: text(row.line_name, 300),
        expectedParcels: numberOrNull(row.total_num),
        enteredParcels: numberOrNull(row.already_num),
        pendingParcels: numberOrNull(row.no_entry_num),
      };
      setEnrichmentAliases(counts, value, row.proof_id, row.line_name, row.plate_number);
    }
    return counts;
  } catch (error) {
    await safeStatusWrite(
      markConnectionError(env, "ms_preentry_connections", hub, error.message),
      "ms_preentry_error_write_error",
      hub,
    );
    console.error(JSON.stringify({ event: "ms_preentry_sync_error", hub, message: error.message }));
    const failed = new Map();
    failed.sourceFailed = true;
    failed.sourceCode = error?.code || "PREENTRY_SOURCE_ERROR";
    return failed;
  }
}

export function classifyPreEntryFailure(message, httpStatus = 0) {
  const value = String(message || "").trim();
  if (Number(httpStatus) === 429 || /request\s+exceeds\s+the\s+limit|rate.?limit|too many requests|exceed(?:ed|s)?\s+(?:the\s+)?limit/i.test(value))
    return { code: "PREENTRY_RATE_LIMIT", status: 429 };
  if (/session|token|auth|login|expired|unauthor/i.test(value))
    return { code: "PREENTRY_SESSION_EXPIRED", status: 502 };
  return { code: "PREENTRY_SOURCE_ERROR", status: 502 };
}

async function readPreEntryPage(credentials, page, day) {
  const url = new URL("https://fbi.flashexpress.com/api/route/route_followstart");
  for (const key of ["lang", "auth", "fbid", "time", "_from", "nonce", "referer", "iv"])
    if (credentials[key]) url.searchParams.set(key, credentials[key]);
  for (const [key, value] of Object.entries({
    stat_time: day, last_stop: "", next_store_id: credentials.next_store_id || "",
    page: String(page), page_size: "100", export: "0",
  })) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url, { headers: {
    Accept: "application/json, text/plain, */*",
    Referer: "https://fbi.flashexpress.com/fbi-ui/",
    "User-Agent": "Mozilla/5.0", "BI-PLATFORM": "pc",
  }});
  if (!response.ok) {
    const message = `ข้อมูลพัสดุตอบกลับ ${response.status}`;
    const failure = classifyPreEntryFailure(message, response.status);
    fail(message, failure.code, failure.status);
  }
  const json = await response.json();
  if (Number(json.code) !== 1) {
    const message = json.message || json.msg || "ข้อมูลพัสดุตอบกลับผิดพลาด";
    const failure = classifyPreEntryFailure(message);
    fail(message, failure.code, failure.status);
  }
  return {
    items: Array.isArray(json.data?.DataList) ? json.data.DataList : [],
    total: Number(json.data?.Total) || 0,
  };
}

function normalizeProofId(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}
function setEnrichmentAliases(map, value, proofId) {
  const key = normalizeProofId(proofId);
  if (key) map.set(`P:${key}`, value);
}
function findEnrichment(map, row) {
  const proofId = normalizeProofId(row.proofId);
  return proofId ? map.get(`P:${proofId}`) : undefined;
}
function findBusEnrichment(map, row) {
  const proofId = normalizeProofId(row.proofId);
  if (!proofId) return undefined;
  const attendance = normalizeMsAttendance(row.attendanceType);
  return map.get(`P:${proofId}|A:${attendance}`) || map.get(`P:${proofId}`);
}

export function parseScheduleUnloadingEnd(field) {
  if (!Array.isArray(field)) return "";
  const raw = String(field[1]?.value || "").trim();
  const match = raw.match(/^E:\s*(.+)$/i);
  if (!match || !match[1] || match[1] === "-") return "";
  return msDate(match[1].trim());
}

export function parseScheduleUnloadingStart(field) {
  if (!Array.isArray(field)) return "";
  const raw = String(field[0]?.value || "").trim();
  const match = raw.match(/^S:\s*(.+)$/i);
  if (!match || !match[1] || match[1] === "-") return "";
  return msDate(match[1].trim());
}

export function scheduleStoreMatchesHub(storeValue, hub) {
  const store = String(storeValue || "").toUpperCase();
  const branch = String(hub || "").trim().toUpperCase();
  if (!store || !branch) return false;
  const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(store);
}
function numberOrNull(value) {
  return value === "" || value === null || value === undefined || !Number.isFinite(Number(value))
    ? null : Number(value);
}

async function saveMsBusConnection(body, actor, env) {
  const hub = text(body.hub, 80).toUpperCase();
  if (!hub || !access(hub, actor))
    fail("บัญชีนี้ไม่มีสิทธิ์เชื่อมต่อ HUB ที่เลือก", "FORBIDDEN", 403);
  const credentials = {};
  for (const key of ["auth", "lang", "fbid", "time", "_from"])
    credentials[key] = text(body.credentials?.[key], 2000);
  if (!credentials.auth || !credentials.fbid || !credentials.time)
    fail("ไฟล์ HAR ไม่มีข้อมูลเชื่อมต่อการจัดการตารางเวลา", "INVALID_HAR");
  const test = await readBusPage(credentials, 1, thaiDay());
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ms_bus_connections(hub,credentials_cipher,updated_at,updated_by,last_success_at,last_error) VALUES(?,?,?,?,?,?) ON CONFLICT(hub) DO UPDATE SET credentials_cipher=excluded.credentials_cipher,updated_at=excluded.updated_at,updated_by=excluded.updated_by,last_success_at=excluded.last_success_at,last_error=''",
  ).bind(hub, await encryptMs(JSON.stringify(credentials), env), now, actor.username, now, "").run();
  await audit(env, "SAVE_MS_BUS_CONNECTION", hub, `ทดสอบสำเร็จ ${test.total} รายการ`, actor.username);
  return { hub, total: test.total, updatedAt: now, source: "busTimeManagement" };
}


// HBI_PHOTO_ON_DEMAND_V1
// No cron, no live-refresh hook, no pagination, no automatic retry,
// no photo persistence, and no status heartbeat writes.
function isMissingTableError(error, table) {
  return new RegExp(`no such table:\\s*${table}`, "i").test(String(error?.message || error || ""));
}

async function saveMsHbiConnection(body, actor, env) {
  const hub = text(body.hub, 80).toUpperCase();
  if (!hub || !access(hub, actor))
    fail("บัญชีนี้ไม่มีสิทธิ์เชื่อมต่อ HUB ที่เลือก", "FORBIDDEN", 403);
  const credentials = {};
  for (const key of ["auth", "lang", "fbid", "time", "webSign", "_from"])
    credentials[key] = text(body.credentials?.[key], 2500);
  if (!credentials.auth || !credentials.fbid || !credentials.time || String(credentials.webSign).toLowerCase() !== "hbi")
    fail("ไฟล์ HAR ไม่มีข้อมูล Session HBI รูปท้ายรถที่ต้องใช้", "INVALID_HAR");
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ms_hbi_connections(hub,credentials_cipher,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET credentials_cipher=excluded.credentials_cipher,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
  ).bind(hub, await encryptMs(JSON.stringify(credentials), env), now, actor.username).run();
  for (const key of [...hbiPhotoCache.keys()]) if (key.startsWith(`${hub}|`)) hbiPhotoCache.delete(key);
  await audit(env, "SAVE_MS_HBI_CONNECTION", hub, "บันทึก Session รูปท้ายรถแบบ on-demand; upstream calls=0", actor.username);
  return { hub, updatedAt: now, source: "hbiPhotos", upstreamCalls: 0 };
}

async function hbiConnectionStatus(env, hub) {
  try {
    return await env.DB.prepare(
      "SELECT updated_at,updated_by FROM ms_hbi_connections WHERE hub=?",
    ).bind(hub).first();
  } catch (error) {
    if (isMissingTableError(error, "ms_hbi_connections")) return null;
    throw error;
  }
}

export function hbiPhotoDateWindow(value, now = new Date()) {
  const parsed = value ? new Date(value) : now;
  const base = isNaN(parsed) ? now : parsed;
  const bangkokDay = new Date(base.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const midnight = Date.parse(`${bangkokDay}T00:00:00Z`);
  return {
    begin: new Date(midnight - 86400000).toISOString().slice(0, 10),
    end: new Date(midnight + 86400000).toISOString().slice(0, 10),
  };
}

export function normalizeHbiPhotoUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.hostname.toLowerCase() !== "fle-asset-internal.oss-ap-southeast-1.aliyuncs.com") return "";
    if (!url.pathname.startsWith("/fleetOutbound/")) return "";
    if (!/^https?:$/.test(url.protocol)) return "";
    url.protocol = "https:";
    url.hash = "";
    url.search = "?x-oss-process=image/resize,w_200/quality,q_80";
    return url.toString();
  } catch { return ""; }
}

function rememberHbiPhoto(key, value) {
  if (hbiPhotoCache.has(key)) hbiPhotoCache.delete(key);
  while (hbiPhotoCache.size >= HBI_PHOTO_CACHE_MAX) hbiPhotoCache.delete(hbiPhotoCache.keys().next().value);
  hbiPhotoCache.set(key, {
    until: Date.now() + (value.photos?.length ? HBI_PHOTO_CACHE_MS : HBI_EMPTY_CACHE_MS),
    value,
  });
}

async function msTruckPhotos(env, actor, hub, wantedProofId) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);
  const proofId = normalizeProofId(wantedProofId);
  if (!proofId) fail("รถเที่ยวนี้ยังไม่มีบาร์โค้ด จึงเปิดรูปท้ายรถไม่ได้", "MISSING_PROOF_ID");
  const cacheKey = `${hub}|${proofId}`;
  const cached = hbiPhotoCache.get(cacheKey);
  if (cached?.until > Date.now()) return { ...cached.value, upstreamCalls: 0, cache: "memory" };
  if (cached) hbiPhotoCache.delete(cacheKey);
  if (activeHbiPhotoReads.has(cacheKey)) return activeHbiPhotoReads.get(cacheKey);
  const task = (async () => {
    // HBI_PHOTO_DEDICATED_SESSION_V3: fleet/loadInfoList uses only the dedicated
    // Fleet Load Info HAR session. LH Manifest is a different HBI session and is never
    // substituted here. This path is click-only and adds no polling or writes.
    let route;
    try {
      route = await env.DB.prepare(
        "SELECT r.proof_id,r.attendance_type,r.estimated_arrival_at,h.credentials_cipher FROM ms_routes r LEFT JOIN ms_hbi_connections h ON h.hub=r.hub WHERE r.hub=? AND r.proof_id=? ORDER BY r.synced_at DESC LIMIT 1",
      ).bind(hub, proofId).first();
    } catch (error) {
      if (!isMissingTableError(error, "ms_hbi_connections")) throw error;
      route = await env.DB.prepare(
        "SELECT proof_id,attendance_type,estimated_arrival_at,NULL AS credentials_cipher FROM ms_routes WHERE hub=? AND proof_id=? ORDER BY synced_at DESC LIMIT 1",
      ).bind(hub, proofId).first();
    }
    if (!route?.proof_id)
      fail(`ไม่พบเที่ยวรถ ${proofId} ใน HUB ${hub}`, "HBI_PHOTOS_ROUTE_NOT_FOUND", 404);
    if (normalizeMsAttendance(route.attendance_type) !== "ปลายทาง")
      fail("รูปท้ายรถเปิดได้เฉพาะงานเข้าปลายทาง", "HBI_PHOTOS_DESTINATION_ONLY", 403);

    let credentials = null;
    if (route.credentials_cipher) {
      try {
        credentials = JSON.parse(await decryptMs(route.credentials_cipher, env));
      } catch (error) {
        console.warn(JSON.stringify({ event: "hbi_photo_dedicated_session_error", hub, message: error?.message || String(error) }));
      }
    }
    if (!credentials)
      fail(`HUB ${hub} ยังไม่ได้อัปโหลด HAR รูปท้ายรถ (HBI) · เปิด Fleet Load Info แล้วบันทึกที่แหล่ง 4`, "HBI_PHOTOS_NOT_CONFIGURED", 409);

    const value = await readHbiTruckPhotos(credentials, proofId, route.estimated_arrival_at);
    rememberHbiPhoto(cacheKey, value);
    return { ...value, upstreamCalls: 1, cache: "miss", credentialSource: "HBI_HAR" };
  })().finally(() => activeHbiPhotoReads.delete(cacheKey));
  activeHbiPhotoReads.set(cacheKey, task);
  return task;
}

async function readHbiTruckPhotos(credentials, proofId, estimatedArrivalAt) {
  const url = new URL("https://hbi-common.flashexpress.com/api/fleet/loadInfoList");
  for (const key of ["auth", "lang", "fbid", "time", "webSign", "_from"]) {
    // Replay the dedicated Fleet Load Info HAR session tuple exactly. HBI's page
    // keeps auth/fbid/time/webSign stable for the session; synthesizing a new `time`
    // breaks that signed session and returns `need login`.
    const value = credentials?.[key];
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const window = hbiPhotoDateWindow(estimatedArrivalAt);
  const filters = {
    page: "1", page_size: "100", total: "0", sorting_no: "", region: "", piece: "", category: "",
    select_type: "", origin_id: "", target_id: "", plate_type: "", proof_id: proofId,
    transport_mode_category: "", transport_detail_category: "", begin_date: window.begin, end_date: window.end,
  };
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": credentials?.lang || "th",
    "BI-PLATFORM": "",
    // HBI_WUJIE_AUTH_HEADER_V1: CBI sends authorization=<location auth>.
    // HAR exports may redact this GET header even though its preflight exposes it.
    Authorization: credentials?.auth || "",
    Origin: "https://cbi-fbi.flashexpress.com",
    Referer: "https://cbi-fbi.flashexpress.com/",
    "User-Agent": "Mozilla/5.0",
  }});
  if (response.status === 429)
    fail("HBI จำกัดคำขอชั่วคราว กรุณารอสักครู่แล้วกดดูใหม่", "HBI_PHOTO_RATE_LIMIT", 429);
  if (!response.ok) fail(`HBI รูปท้ายรถตอบกลับ ${response.status}`, "HBI_PHOTO_HTTP_ERROR", 502);
  const json = await response.json();
  if (Number(json.code) !== 1)
    fail(json.msg || json.message || "Session HBI รูปท้ายรถหมดอายุ", "HBI_PHOTO_SESSION_EXPIRED", 502);
  const rows = Array.isArray(json.data?.dataList) ? json.data.dataList : [];
  const photos = [];
  const seen = new Set();
  for (const row of rows) {
    if (normalizeProofId(row.proof_id) !== proofId) continue;
    const raw = Array.isArray(row.route_out_pic) ? row.route_out_pic : row.route_out_pic ? [row.route_out_pic] : [];
    for (const item of raw) {
      const photo = normalizeHbiPhotoUrl(item);
      if (photo && !seen.has(photo)) { seen.add(photo); photos.push(photo); }
    }
  }
  return { proofId, photos, total: photos.length };
}

// BUS_TIME_RATE_GUARD_V10 / OPTIONAL_SOURCE_RATE_GUARD_V12: Fleet Time is enrichment, not the 4-second Route truth.
const BUS_TIME_SOURCE_TTL_MS = 60 * 1000;
const BUS_TIME_PAGE_CONCURRENCY = 1;
const BUS_TIME_PAGE_BATCH_DELAY_MS = 120;
const OPTIONAL_RATE_LIMIT_BASE_COOLDOWN_MS = 5 * 60 * 1000;
const OPTIONAL_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 60 * 1000;
const busTimeSourceCache = new Map();
const busTimeSourceActive = new Map();
const busTimeRateGuard = new Map();

function optionalRateCooldownMs(strikes) {
  return Math.min(OPTIONAL_RATE_LIMIT_MAX_COOLDOWN_MS, OPTIONAL_RATE_LIMIT_BASE_COOLDOWN_MS * (2 ** Math.max(0, Number(strikes || 1) - 1)));
}

function busTimeSourceKey(hub, wantedDays) {
  return String(hub || "").toUpperCase() + "|" + (Array.isArray(wantedDays) ? wantedDays.join(",") : "");
}

async function readBusTimeData(env, hub, wantedDays = liveSourceDays()) {
  const key = busTimeSourceKey(hub, wantedDays);
  const now = Date.now();
  const cached = busTimeSourceCache.get(key);
  const guard = busTimeRateGuard.get(key);
  if (guard?.until > now) {
    if (cached?.data) {
      cached.data.sourceStale = true;
      cached.data.retryAt = new Date(guard.until).toISOString();
      return cached.data;
    }
    const failed = new Map();
    failed.sourceFailed = true;
    failed.sourceCode = "BUS_TIME_RATE_LIMIT";
    failed.retryAt = new Date(guard.until).toISOString();
    return failed;
  }
  if (cached && cached.until > now) return cached.data;
  if (busTimeSourceActive.has(key)) return busTimeSourceActive.get(key);
  const task = readBusTimeDataFresh(env, hub, wantedDays)
    .then((data) => {
      if (data instanceof Map && data.sourceFailed !== true) {
        data.sourceStale = false;
        busTimeRateGuard.delete(key);
        busTimeSourceCache.set(key, { until: Date.now() + BUS_TIME_SOURCE_TTL_MS, data });
        return data;
      }
      if (data?.sourceCode === "BUS_TIME_RATE_LIMIT") {
        const previous = busTimeRateGuard.get(key);
        const strikes = Math.min(8, Number(previous?.strikes || 0) + 1);
        const until = Date.now() + optionalRateCooldownMs(strikes);
        busTimeRateGuard.set(key, { strikes, until });
        if (cached?.data) {
          cached.data.sourceStale = true;
          cached.data.retryAt = new Date(until).toISOString();
          return cached.data;
        }
      }
      return data;
    })
    .finally(() => busTimeSourceActive.delete(key));
  busTimeSourceActive.set(key, task);
  return task;
}

async function readBusTimeDataFresh(env, hub, wantedDays = liveSourceDays()) {
  const row = await env.DB.prepare(
    "SELECT credentials_cipher FROM ms_bus_connections WHERE hub=?",
  ).bind(hub).first();
  if (!row) return new Map();
  try {
    const credentials = JSON.parse(await decryptMs(row.credentials_cipher, env));
    const rows = [];
    for (const day of wantedDays) {
      const first = await readBusPage(credentials, 1, day);
      rows.push(...first.items);
      const pages = Math.min(20, Math.ceil((first.total || first.items.length) / 100));
      if (pages > 1) {
        const remainingPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);
        for (let offset = 0; offset < remainingPages.length; offset += BUS_TIME_PAGE_CONCURRENCY) {
          const pageBatch = remainingPages.slice(offset, offset + BUS_TIME_PAGE_CONCURRENCY);
          const results = await Promise.all(pageBatch.map((page) => readBusPage(credentials, page, day)));
          results.forEach((result) => rows.push(...result.items));
          if (offset + BUS_TIME_PAGE_CONCURRENCY < remainingPages.length)
            await new Promise((resolve) => setTimeout(resolve, BUS_TIME_PAGE_BATCH_DELAY_MS));
        }
      }
    }
    await safeStatusWrite(
      markConnectionSuccess(env, "ms_bus_connections", hub),
      "ms_bus_success_write_error",
      hub,
    );
    const result = new Map();
    for (const item of rows) {
      const targetStore = String(nestedValue(item.next_store_info, 0) || "");
      if (!scheduleStoreMatchesHub(targetStore, hub)) continue;
      const proofId = nestedValue(item.proof_id, 0);
      const key = normalizeProofId(proofId);
      const routeName = nestedValue(item.line_info, 0);
      if (!key) continue;
      const attendance = normalizeMsAttendance(nestedValue(item.next_store_info, 1));
      if (!attendance) continue;
      const kit = msDate(nestedValue(item.kit_arrive_time, 0));
      const tbr = msDate(nestedValue(item.fleet_sign_info, 0));
      const mapKey = `P:${key}|A:${attendance}`;
      const current = result.get(mapKey) || {};
      const unloadingStart = parseScheduleUnloadingStart(item.fleet_unloading_time);
      const unloadingEnd = parseScheduleUnloadingEnd(item.fleet_unloading_time);
      const conflictingStart = Boolean(current.scheduleUnloadingStartedAt) &&
        Boolean(unloadingStart) && current.scheduleUnloadingStartedAt !== unloadingStart;
      const conflictingEnd = Boolean(current.scheduleUnloadingCompletedAt) &&
        Boolean(unloadingEnd) && current.scheduleUnloadingCompletedAt !== unloadingEnd;
      const ambiguous = Boolean(current.scheduleCompletionAmbiguous) ||
        conflictingStart || conflictingEnd;
      const candidate = {
        proofId: text(proofId, 100),
        routeName: text(routeName, 300),
        scheduleKitArrivalAt: earliestDate(current.scheduleKitArrivalAt, kit),
        scheduleTbrArrivalAt: earliestDate(current.scheduleTbrArrivalAt, tbr),
        arrivedParcels: Math.max(Number(current.arrivedParcels) || 0, Number(nestedValue(item.parcel_count, 0)) || 0),
        arrivedBags: Math.max(Number(current.arrivedBags) || 0, Number(nestedValue(item.pack_count, 0)) || 0),
        scheduleUnloadingStartedAt:
          ambiguous ? "" : unloadingStart || current.scheduleUnloadingStartedAt || "",
        scheduleUnloadingCompletedAt:
          ambiguous
            ? ""
            : unloadingEnd || current.scheduleUnloadingCompletedAt || "",
        scheduleCompletionAmbiguous: ambiguous,
      };
      result.set(mapKey, candidate);
    }
    return result;
  } catch (error) {
    await safeStatusWrite(
      markConnectionError(env, "ms_bus_connections", hub, error.message),
      "ms_bus_error_write_error",
      hub,
    );
    console.error(JSON.stringify({ event: "ms_bus_sync_error", hub, message: error.message }));
    const failed = new Map();
    failed.sourceFailed = true;
    failed.sourceCode = error?.code || "BUS_TIME_SOURCE_ERROR";
    return failed;
  }
}

async function preEntryTrips(env, actor, hub, wantedDay) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(wantedDay || "")) ? String(wantedDay) : thaiDay();
  const credentials = await preEntryCredentials(env, hub);
  if (!credentials) fail(`HUB ${hub} ยังไม่ได้เชื่อมข้อมูลพัสดุเข้าคลัง`, "PREENTRY_NOT_CONFIGURED");
  const first = await readPreEntryPage(credentials, 1, day), rows = [...first.items];
  const pages = Math.min(20, Math.ceil((first.total || rows.length) / 100));
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => readPreEntryPage(credentials, index + 2, day)));
    rest.forEach((page) => rows.push(...page.items));
  }
  // Driver, phone and supplier are not present in the pre-entry response.
  // Enrich strictly by dispatch barcode; never match by plate or driver name.
  const routeRows = (
    await env.DB.prepare(
      "SELECT proof_id,driver_name,driver_phone,supplier,synced_at FROM ms_routes WHERE hub=? AND proof_id<>'' ORDER BY synced_at DESC",
    ).bind(hub).all()
  ).results;
  const partiesByProof = new Map();
  for (const route of routeRows) {
    const key = normalizeProofId(route.proof_id);
    if (key && !partiesByProof.has(key)) partiesByProof.set(key, route);
  }
  return {
    hub,
    day,
    updatedAt: new Date().toISOString(),
    totalTrips: rows.length,
    expected: rows.reduce((sum, row) => sum + (Number(row.total_num) || 0), 0),
    entered: rows.reduce((sum, row) => sum + (Number(row.already_num) || 0), 0),
    pending: rows.reduce((sum, row) => sum + (Number(row.no_entry_num) || 0), 0),
    trips: rows.map((row) => {
      const party = partiesByProof.get(normalizeProofId(row.proof_id)) || {};
      return {
      proofId: text(row.proof_id, 100),
      routeName: text(row.line_name, 300),
      previousHub: cleanStoreName(row.store_name || row.previous_hub_name || row.origin_hub_name || row.start_hub_name),
      targetHub: cleanStoreName(row.next_store_name || row.next_hub_name || row.target_hub_name || row.dst_hub_name || row.destination_hub_name || row.ticket_delivery_hub_name || row.end_hub_name),
      expected: numberOrNull(row.total_num),
      entered: numberOrNull(row.already_num),
      pending: numberOrNull(row.no_entry_num),
      supplier: text(party.supplier, 240),
      driverName: text(party.driver_name, 160),
      driverPhone: phone(party.driver_phone),
    };}).filter((row) => row.proofId),
  };
}

function cleanStoreName(value) {
  return text(value, 300).replace(/^\s*\([^)]*\)\s*/, "").trim();
}

async function pendingParcels(env, actor, hub, wantedProofId, wantedDay, wantedType) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดูข้อมูล HUB นี้", "FORBIDDEN", 403);
  const proofId = normalizeProofId(wantedProofId);
  if (!proofId) fail("รถเที่ยวนี้ยังไม่มีบาร์โค้ด จึงเปิดรายการพัสดุไม่ได้", "MISSING_PROOF_ID");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(wantedDay || ""))
    ? String(wantedDay) : thaiDay();
  const type = ["total", "already", "no_entry"].includes(String(wantedType || ""))
    ? String(wantedType) : "no_entry";
  const credentials = await preEntryCredentials(env, hub);
  if (!credentials) fail(`HUB ${hub} ยังไม่ได้เชื่อมข้อมูลพัสดุเข้าคลัง`, "PREENTRY_NOT_CONFIGURED");
  const first = await readPreEntryPage(credentials, 1, day);
  const summaryRows = [...first.items];
  const summaryPages = Math.min(20, Math.ceil((first.total || summaryRows.length) / 100));
  if (summaryPages > 1) {
    const rest = await Promise.all(Array.from({ length: summaryPages - 1 }, (_, index) =>
      readPreEntryPage(credentials, index + 2, day)));
    rest.forEach((page) => summaryRows.push(...page.items));
  }
  const summary = summaryRows.find((row) => normalizeProofId(row.proof_id) === proofId);
  if (!summary) fail("ไม่พบเที่ยวรถนี้ในข้อมูลพัสดุของวันที่เลือก", "PREENTRY_TRIP_NOT_FOUND", 404);
  const firstDetail = await readPendingParcelPage(credentials, summary, day, 1, type);
  const rows = [...firstDetail.items];
  const pages = Math.min(20, Math.ceil((firstDetail.total || rows.length) / 200));
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>
      readPendingParcelPage(credentials, summary, day, index + 2, type)));
    rest.forEach((page) => rows.push(...page.items));
  }
  return {
    proofId: text(summary.proof_id, 100),
    routeName: text(summary.line_name, 300),
    type,
    total: firstDetail.total || rows.length,
    parcels: rows.map((row) => ({
      pno: text(row.pno, 100),
      backingNo: text(row.bag_no || row.bagging_no || row.backing_no || row.pack_no || row.bag_code || row.package_no, 120),
      status: text(row.state_name, 160),
      lastAction: text(row.LastAction_name, 160),
      lastActionAt: text(row.LastActionTime, 100),
      targetHub: cleanStoreName(row.next_hub_name || row.target_hub_name || row.dst_hub_name || row.destination_hub_name || row.ticket_delivery_hub_name || row.end_hub_name || row.next_store_name || row.hub_name),
      targetBranch: cleanStoreName(row.ticket_delivery_store_name || row.dst_store_name || row.target_store_name || row.destination_store_name || row.end_store_name),
    })).filter((row) => row.pno),
  };
}

async function readPendingParcelPage(credentials, summary, day, page, type = "no_entry") {
  const url = new URL("https://fbi.flashexpress.com/api/route/route_followstart_list");
  for (const key of ["lang", "auth", "fbid", "time", "_from", "nonce", "referer", "iv"])
    if (credentials[key]) url.searchParams.set(key, credentials[key]);
  for (const [key, value] of Object.entries({
    line_id: summary.line_id || summary.van_line_id || "",
    stat_time: day,
    proof_id: summary.proof_id || "",
    store_id: summary.next_store_id || "",
    last_stop: summary.store_id || "",
    component: "warehouseDetail",
    type,
    title: type === "total" ? "arriving_monitoring.expect_num" : type === "already" ? "arriving_monitoring.already_num" : "arriving_monitoring.no_entry_num",
    page: String(page),
    page_size: "200",
    export: "0",
  })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: {
    Accept: "application/json, text/plain, */*",
    Referer: "https://fbi.flashexpress.com/fbi-ui/",
    "User-Agent": "Mozilla/5.0", "BI-PLATFORM": "pc",
  }});
  if (!response.ok) fail(`รายการพัสดุตอบกลับ ${response.status}`, "PENDING_PARCELS_HTTP_ERROR", 502);
  const json = await response.json();
  if (Number(json.code) !== 1)
    fail(json.message || "เซสชันรายการพัสดุหมดอายุ", "PENDING_PARCELS_SESSION_EXPIRED", 502);
  return {
    items: Array.isArray(json.data?.DataList) ? json.data.DataList : [],
    total: Number(json.data?.Total) || 0,
  };
}

// BUS_TIME_RATE_LIMIT_V11: provider capacity/rate limits are not session expiry.
export function classifyBusTimeFailure(message, httpStatus = 0) {
  const value = String(message || "").trim();
  if (Number(httpStatus) === 429 || /request\s+exceeds\s+the\s+limit|rate.?limit|too many requests|exceed(?:ed|s)?\s+(?:the\s+)?limit/i.test(value))
    return { code: "BUS_TIME_RATE_LIMIT", status: 429 };
  if (/session|token|auth|login|expired|unauthor/i.test(value))
    return { code: "BUS_TIME_SESSION_EXPIRED", status: 502 };
  return { code: "BUS_TIME_SOURCE_ERROR", status: 502 };
}

async function readBusPage(credentials, page, day) {
  const url = new URL("https://fbi-common.flashexpress.com/api/fleet_time/getList");
  for (const key of ["auth", "lang", "fbid", "time", "_from"])
    if (credentials[key]) url.searchParams.set(key, credentials[key]);
  const filters = {
    startDate: day, endDate: day, lineMode: "", lineArea: "", lineType: "",
    proofId: "", fleetStatus: "", transportModeCategory: "",
    transportDetailCategory: "", driverType: "", attendanceType: "",
    attendanceStatus: "", storeId: "", originId: "", targetId: "",
    plateNum: "", belongCcd: "", lineSort: "", lineName: "",
    page: String(page), pageSize: "100",
  };
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url, { headers: {
    Accept: "application/json, text/plain, */*", Referer: "https://fbi.flashexpress.com/fbi-ui/",
    "User-Agent": "Mozilla/5.0", "BI-PLATFORM": "pc",
  }});
  if (!response.ok) {
    const message = `ข้อมูลตารางเวลาตอบกลับ ${response.status}`;
    const failure = classifyBusTimeFailure(message, response.status);
    fail(
      message,
      failure.code === "BUS_TIME_RATE_LIMIT"
        ? failure.code
        : "BUS_TIME_HTTP_ERROR",
      failure.code === "BUS_TIME_RATE_LIMIT" ? failure.status : 502,
    );
  }
  const json = await response.json();
  if (Number(json.code) !== 1) {
    const message = json.msg || json.message || "การจัดการตารางเวลาตอบกลับผิดพลาด";
    const failure = classifyBusTimeFailure(message);
    fail(message, failure.code, failure.status);
  }
  return {
    items: Array.isArray(json.data?.dataList) ? json.data.dataList : [],
    total: Number(json.data?.total) || 0,
  };
}

function nestedValue(field, index) {
  return Array.isArray(field) ? field[index]?.value ?? "" : "";
}
function earliestDate(...values) {
  const valid = values.map((value) => date(value)).filter(Boolean);
  if (!valid.length) return "";
  return valid.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

async function persistMsConnection(hub, sessionId, deviceId, updatedBy, env) {
  const nowThai = Date.now() + 7 * 3600000,
    start = Math.floor(nowThai / 86400000) * 86400000 - 7 * 3600000,
    end = start + 86400000 - 1000;
  const test = await readMsPage({ sessionId, deviceId }, 1, start, end);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ms_connections(hub,session_cipher,device_cipher,updated_at,updated_by,last_success_at,last_error) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hub) DO UPDATE SET session_cipher=excluded.session_cipher,device_cipher=excluded.device_cipher,updated_at=excluded.updated_at,updated_by=excluded.updated_by,last_success_at=excluded.last_success_at,last_error='' ",
  )
    .bind(
      hub,
      await encryptMs(sessionId, env),
      await encryptMs(deviceId, env),
      now,
      updatedBy,
      now,
      "",
    )
    .run();
  msCredentialCache.set(hub, {
    until: Date.now() + MS_CREDENTIAL_CACHE_MS,
    value: { sessionId, deviceId },
  });
  await audit(
    env,
    "SAVE_MS_CONNECTION",
    hub,
    `ทดสอบสำเร็จ ${test.total} รายการ`,
    updatedBy,
  );
  if (env.MS_REFRESH_COORDINATOR) {
    try {
      const id = env.MS_REFRESH_COORDINATOR.idFromName(hub);
      const stub = env.MS_REFRESH_COORDINATOR.get(id);
      await stub.fetch(new Request("https://ms-refresh.internal/quota-reset?branch=" + encodeURIComponent(hub)));
    } catch (error) {
      console.warn(JSON.stringify({ event: "ms_route_quota_guard_reset_failed", hub, message: error?.message || String(error) }));
    }
  }
  return { hub, total: test.total, updatedAt: now };
}

async function createMsPairing(body, actor, env) {
  const hub = text(body.hub, 80).toUpperCase();
  if (!hub || !access(hub, actor)) fail("ไม่มีสิทธิ์เชื่อมต่อ HUB นี้", "FORBIDDEN", 403);
  const pairing = randomToken(24), now = new Date(), expires = new Date(now.getTime() + 10 * 60000);
  await env.DB.prepare("DELETE FROM ms_pairings WHERE expires_at<? OR (hub=? AND status='PENDING')").bind(now.toISOString(), hub).run();
  await env.DB.prepare("INSERT INTO ms_pairings(code_hash,hub,created_by,created_at,expires_at,status,completed_at) VALUES(?,?,?,?,?,'PENDING','')")
    .bind(await sha256(pairing), hub, actor.username, now.toISOString(), expires.toISOString()).run();
  return { pairing, hub, expiresAt: expires.toISOString(), browserUrl: `https://waiting-trucks-ms-browser-test.26nak-testdev.workers.dev/?pairing=${encodeURIComponent(pairing)}&hub=${encodeURIComponent(hub)}` };
}

async function msPairingStatus(pairing, actor, env) {
  const row = await env.DB.prepare("SELECT hub,status,expires_at,completed_at FROM ms_pairings WHERE code_hash=?").bind(await sha256(text(pairing, 200))).first();
  if (!row || !access(row.hub, actor)) return { status: "NOT_FOUND" };
  if (Date.parse(row.expires_at) < Date.now() && row.status !== "COMPLETED") return { status: "EXPIRED", hub: row.hub };
  return { status: row.status, hub: row.hub, completedAt: row.completed_at || "" };
}

async function completeMsPairing(body, env) {
  const pairing = text(body.pairing, 200), requestedHub = text(body.hub, 80).toUpperCase();
  const row = await env.DB.prepare("SELECT * FROM ms_pairings WHERE code_hash=?").bind(await sha256(pairing)).first();
  if (!row || row.status !== "PENDING" || row.hub !== requestedHub || Date.parse(row.expires_at) < Date.now())
    fail("รหัสเชื่อมต่อหมดอายุ กรุณาเริ่มจากหน้าเว็บหลักอีกครั้ง", "PAIRING_EXPIRED", 401);
  const result = await persistMsConnection(row.hub, text(body.sessionId, 2000), text(body.deviceId, 500), `QR:${row.created_by}`, env);
  const connectorToken = randomToken(32), now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE ms_pairings SET status='COMPLETED',completed_at=? WHERE code_hash=? AND status='PENDING'").bind(now, await sha256(pairing)),
    env.DB.prepare("INSERT INTO ms_connector_tokens(hub,token_hash,created_at,last_used_at,active) VALUES(?,?,?,'',1) ON CONFLICT(hub) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,last_used_at='',active=1").bind(row.hub, await sha256(connectorToken), now),
  ]);
  await refreshMsIfStale(env, { username: "MS_QR", role: "admin", branches: ["*"] }, row.hub);
  return { ...result, connectorToken };
}

async function bootstrapConnector(body, env) {
  const configuredSecret = String(env.CONNECTOR_BOOTSTRAP_SECRET || "");
  if (!configuredSecret)
    fail(
      "ปิดการรับตัวเชื่อมต่อชั่วคราว",
      "CONNECTOR_BOOTSTRAP_DISABLED",
      404,
    );

  const suppliedSecret = String(body.bootstrapSecret || "");
  if (
    !suppliedSecret ||
    !(await equal(
      await sha256(suppliedSecret),
      await sha256(configuredSecret),
    ))
  )
    fail(
      "ยืนยันการย้ายตัวเชื่อมต่อไม่สำเร็จ",
      "INVALID_CONNECTOR_BOOTSTRAP",
      401,
    );

  const hub = text(body.hub, 80).toUpperCase();
  const connectorToken = text(body.connectorToken, 500);
  if (!/^[A-Z0-9_-]{2,20}$/.test(hub) || connectorToken.length < 20)
    fail(
      "ข้อมูลตัวเชื่อมต่อไม่ถูกต้อง",
      "INVALID_CONNECTOR_BOOTSTRAP",
      400,
    );

  const connection = await env.DB.prepare(
    "SELECT hub FROM ms_connections WHERE hub=?",
  )
    .bind(hub)
    .first();
  if (!connection)
    fail(
      "HUB นี้ยังไม่มี MS connection ที่ยืนยันแล้ว",
      "MS_NOT_CONFIGURED",
      409,
    );

  const tokenHash = await sha256(connectorToken);
  const existing = await env.DB.prepare(
    "SELECT token_hash,active FROM ms_connector_tokens WHERE hub=?",
  )
    .bind(hub)
    .first();
  if (Number(existing?.active) === 1) {
    if (await equal(String(existing.token_hash || ""), tokenHash))
      return { hub, adopted: false, alreadyRegistered: true };
    fail(
      "HUB นี้มีตัวเชื่อมต่อที่ใช้งานอยู่แล้ว",
      "CONNECTOR_ALREADY_ACTIVE",
      409,
    );
  }

  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare(
      "UPDATE ms_connector_tokens SET token_hash=?,created_at=?,last_used_at='',active=1 WHERE hub=? AND active<>1",
    )
      .bind(tokenHash, now, hub)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO ms_connector_tokens(hub,token_hash,created_at,last_used_at,active) VALUES(?,?,?,'',1)",
    )
      .bind(hub, tokenHash, now)
      .run();
  }

  const registered = await env.DB.prepare(
    "SELECT token_hash,active FROM ms_connector_tokens WHERE hub=?",
  )
    .bind(hub)
    .first();
  if (
    Number(registered?.active) !== 1 ||
    !(await equal(String(registered?.token_hash || ""), tokenHash))
  )
    fail(
      "มีตัวเชื่อมต่ออื่นลงทะเบียนก่อนแล้ว",
      "CONNECTOR_ALREADY_ACTIVE",
      409,
    );

  return { hub, adopted: true, alreadyRegistered: false };
}

// TBR_SHADOW_READONLY_V1: Browser TEST can request a quota-safe shadow snapshot.
// The shadow path never calls syncMs, pre-entry, ms_routes, history or live cache.
async function connectorSync(body, env) {
  const hub = text(body.hub, 80).toUpperCase(), tokenHash = await sha256(text(body.connectorToken, 500));
  const row = await env.DB.prepare("SELECT hub FROM ms_connector_tokens WHERE hub=? AND token_hash=? AND active=1").bind(hub, tokenHash).first();
  if (!row) fail("ตัวเชื่อมต่อไม่ถูกต้อง", "INVALID_CONNECTOR", 401);
  const shadowOnly = body.shadowOnly === true;
  const shadowPart = text(body.shadowPart, 20).toLowerCase();
  const shadowDay = text(body.shadowDay, 20);
  const result = shadowOnly
    ? await readTbrShadowSnapshot(env, hub, shadowPart, shadowDay)
    : await refreshMsIfStale(env, { username: "MS_CRON", role: "admin", branches: ["*"] }, hub);
  if (!shadowOnly) {
    const now = new Date().toISOString(), cutoff = new Date(Date.parse(now) - CONNECTOR_HEARTBEAT_MS).toISOString();
    await safeStatusWrite(
      env.DB.prepare(
        "UPDATE ms_connector_tokens SET last_used_at=? WHERE hub=? AND (last_used_at IS NULL OR last_used_at='' OR last_used_at<?)",
      ).bind(now, hub, cutoff).run(),
      "ms_connector_heartbeat_write_error",
      hub,
    );
  }
  return { hub, ...result };
}

function randomToken(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return b64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// MS_CREDENTIAL_READ_CACHE_V1: avoid rereading unchanged encrypted Route credentials.
const MS_CREDENTIAL_CACHE_MS = 10 * 60 * 1000;
const msCredentialCache = new Map();
async function msCredentials(env, hub) {
  const key = text(hub, 80).toUpperCase();
  const cached = msCredentialCache.get(key);
  if (cached?.until > Date.now()) return cached.value;
  const row = await env.DB.prepare(
    "SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?",
  )
    .bind(key)
    .first();
  if (row) {
    const value = {
      sessionId: await decryptMs(row.session_cipher, env),
      deviceId: await decryptMs(row.device_cipher, env),
    };
    msCredentialCache.set(key, { until: Date.now() + MS_CREDENTIAL_CACHE_MS, value });
    return value;
  }
  if (
    key === text(env.MS_BRANCH || "NE1", 80).toUpperCase() &&
    env.MS_SESSION_ID &&
    env.MS_DEVICE_ID
  ) {
    const value = { sessionId: env.MS_SESSION_ID, deviceId: env.MS_DEVICE_ID };
    msCredentialCache.set(key, { until: Date.now() + MS_CREDENTIAL_CACHE_MS, value });
    return value;
  }
  msCredentialCache.delete(key);
  return null;
}

async function listMsConnections(env) {
  return (
    await env.DB.prepare(
      "SELECT hub,updated_at,updated_by,last_success_at,last_error FROM ms_connections ORDER BY hub",
    ).all()
  ).results.map(output);
}
async function msConnectionStatus(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const [routes, preEntry, busTime, hbiPhotos] = await Promise.all([
    env.DB.prepare("SELECT updated_at,updated_by,last_success_at,last_error FROM ms_connections WHERE hub=?").bind(hub).first(),
    env.DB.prepare("SELECT updated_at,updated_by,last_success_at,last_error FROM ms_preentry_connections WHERE hub=?").bind(hub).first(),
    env.DB.prepare("SELECT updated_at,updated_by,last_success_at,last_error FROM ms_bus_connections WHERE hub=?").bind(hub).first(),
    hbiConnectionStatus(env, hub),
  ]);
  const source = (row) => row
    ? { configured: true, ...output(row) }
    : { configured: false, updatedAt: "", updatedBy: "", lastSuccessAt: "", lastError: "" };
  const hbiSource = hbiPhotos ? { configured: true, ...output(hbiPhotos), lastSuccessAt: "", lastError: "" } : { configured: false, updatedAt: "", updatedBy: "", lastSuccessAt: "", lastError: "" };
  return { hub, routes: source(routes), preEntry: source(preEntry), busTime: source(busTime), hbiPhotos: hbiSource };
}
async function knownMsBranches(env) {
  const rows = (
    await env.DB.prepare(
      "SELECT hub FROM ms_connections UNION SELECT hub FROM ms_routes ORDER BY hub",
    ).all()
  ).results.map((x) => x.hub);
  const fallback = text(env.MS_BRANCH || "", 80).toUpperCase();
  if (fallback) rows.push(fallback);
  return [...new Set(rows)].sort();
}
async function msHistory(env, actor, hub, offset) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const raw = (
      await env.DB.prepare(
        "SELECT * FROM ms_route_history WHERE hub=? ORDER BY snapshot_at DESC LIMIT 1001 OFFSET ?",
      )
        .bind(hub, Math.max(0, offset))
        .all()
    ).results,
    hasMore = raw.length > 1000,
    rows = raw.slice(0, 1000).map((row) => {
      const item = output(row);
      return item;
    });
  return { rows, hasMore, nextOffset: offset + rows.length };
}

// MS_DAILY_HISTORY_V1: read-only daily history. It never calls upstream MS and never writes history.
async function msDailyArchive(env, actor, hub, startValue, endValue) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const start = String(startValue || ""),
    end = String(endValue || start);
  const startMs = thaiDateBoundary(start, false),
    endMs = thaiDateBoundary(end, true);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
    fail("กรุณาเลือกช่วงวันที่ให้ถูกต้อง", "INVALID_DATE_RANGE");
  if (endMs - startMs > 31 * 86400000)
    fail("ดูข้อมูลสะสมได้ครั้งละไม่เกิน 31 วัน", "DATE_RANGE_TOO_LARGE");

  const [historyResult, cancellationResult] = await Promise.all([
    env.DB.prepare(
      `WITH latest AS (
        SELECT h.route_id,h.payload_json,h.snapshot_at,h.synced_by,h.event_type
        FROM ms_route_registry r
        JOIN ms_route_history h
          ON h.rowid = (
            SELECT h2.rowid
            FROM ms_route_history h2
            WHERE h2.hub=r.hub AND h2.route_id=r.route_id
            ORDER BY h2.snapshot_at DESC,h2.rowid DESC
            LIMIT 1
          )
        WHERE r.hub=? AND h.hub=? AND json_valid(h.payload_json)=1
      ), daily AS (
        SELECT route_id,payload_json,snapshot_at,synced_by,event_type,
          CASE
            WHEN COALESCE(json_extract(payload_json,'$.attendanceType'),'') LIKE '%ต้นทาง%' THEN
              date(datetime(COALESCE(
                NULLIF(json_extract(payload_json,'$.estimatedDepartureAt'),''),
                NULLIF(json_extract(payload_json,'$.actualDepartureAt'),''),
                NULLIF(json_extract(payload_json,'$.estimatedArrivalAt'),'')
              ), '+7 hours'))
            ELSE
              date(datetime(COALESCE(
                NULLIF(json_extract(payload_json,'$.estimatedArrivalAt'),''),
                NULLIF(json_extract(payload_json,'$.actualArrivalAt'),''),
                NULLIF(json_extract(payload_json,'$.estimatedDepartureAt'),'')
              ), '+7 hours'))
          END AS business_day
        FROM latest
      )
      SELECT route_id,payload_json,snapshot_at,synced_by,event_type,business_day
      FROM daily
      WHERE business_day>=? AND business_day<=?
      ORDER BY business_day DESC,snapshot_at DESC`,
    )
      .bind(hub, hub, start, end)
      .all(),
    env.DB.prepare(
      "SELECT route_id,cancelled_at,cancelled_by,reason FROM ms_route_cancellations WHERE hub=? AND active=1",
    )
      .bind(hub)
      .all(),
  ]);

  // MS_COMPLETION_DAILY_HISTORY_TRUTH_V2: history reads expose only completion times backed by a recorded 0/1 -> 2 transition.
  const verifiedCompletionRoutes = await verifiedCompletionRouteIds(env, hub);
  const cancellations = new Map(
    cancellationResult.results.map((row) => [row.route_id, row]),
  );
  const rows = [];
  for (const item of historyResult.results) {
    try {
      const row = JSON.parse(item.payload_json || "{}");
      if (!row || typeof row !== "object") continue;
      row.id = row.id || item.route_id;
      row.hub = row.hub || hub;
      row.archivedAt = item.snapshot_at;
      row.businessDay = item.business_day;
      row.completionObservedLive =
        Boolean(row.unloadingCompletedAt) &&
        verifiedCompletionRoutes.has(String(row.id || ""));
      if (row.unloadingCompletedAt && !row.completionObservedLive)
        row.unloadingCompletedAt = "";
      const cancelled = cancellations.get(item.route_id);
      if (cancelled) {
        row.queueCancelledAt = cancelled.cancelled_at;
        row.queueCancelledBy = cancelled.cancelled_by;
        row.queueCancelReason = cancelled.reason;
      }
      rows.push(row);
    } catch {}
  }
  return {
    rows,
    total: rows.length,
    complete: true,
    branch: hub,
    start,
    end,
    source: "TURSO_DAILY_HISTORY",
    upstreamMsCalls: 0,
    historyWrites: 0,
  };
}

async function msArchiveTotal(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total_distinct FROM ms_route_registry WHERE hub=?",
  )
    .bind(hub)
    .first();
  return { branch: hub, total: Number(row?.total_distinct) || 0 };
}

// MS_ARCHIVE_COMPLETE_V1: all distinct routes, latest snapshot per route.
async function msArchive(env, actor, hub) {
  if (!access(hub, actor)) fail("ไม่มีสิทธิ์ดู HUB นี้", "FORBIDDEN", 403);
  const [historyResult, completionResult, distinctResult, currentResult] =
    await Promise.all([
      env.DB.prepare(
        `WITH ranked AS (
          SELECT route_id,payload_json,snapshot_at,synced_by,
            ROW_NUMBER() OVER (
              PARTITION BY route_id
              ORDER BY snapshot_at DESC, rowid DESC
            ) AS rn
          FROM ms_route_history
          WHERE hub=?
        )
        SELECT route_id,payload_json,snapshot_at,synced_by
        FROM ranked
        WHERE rn=1
        ORDER BY snapshot_at DESC`,
      )
        .bind(hub)
        .all(),
      env.DB.prepare(
        `WITH completions AS (
          SELECT route_id,payload_json,event_type AS action,synced_by,
            ROW_NUMBER() OVER (
              PARTITION BY route_id
              ORDER BY snapshot_at ASC, rowid ASC
            ) AS rn
          FROM ms_route_history
          WHERE hub=?
            AND json_valid(payload_json)=1
            AND COALESCE(json_extract(payload_json,'$.unloadingCompletedAt'),'')<>''
        )
        SELECT route_id,synced_by
        FROM completions
        WHERE rn=1`,
      )
        .bind(hub)
        .all(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total_distinct FROM ms_route_registry WHERE hub=?",
      )
        .bind(hub)
        .first(),
      env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?")
        .bind(hub)
        .all(),
    ]);

  const completionObserved = new Map(
    completionResult.results.map((item) => {
      let explicit;
      try {
        explicit = JSON.parse(item.payload_json || "{}")?.completionObservedLive;
      } catch {}
      return [
        item.route_id,
        explicit === true ||
          (typeof explicit !== "boolean" &&
            item.action !== "FIRST_SEEN" &&
            item.synced_by !== "MS_RANGE"),
      ];
    }),
  );
  const latest = new Map();
  for (const item of historyResult.results) {
    try {
      const row = JSON.parse(item.payload_json || "{}");
      if (!row || typeof row !== "object") continue;
      row.id = row.id || item.route_id;
      row.hub = row.hub || hub;
      row.archivedAt = item.snapshot_at;
      row.completionObservedLive = completionObserved.get(item.route_id) === true;
      latest.set(item.route_id, row);
    } catch {}
  }

  const current = currentResult.results.map(output);
  for (const row of current) {
    row.completionObservedLive = completionObserved.has(row.id)
      ? completionObserved.get(row.id) === true
      : row.syncedBy !== "MS_RANGE" && Boolean(row.unloadingCompletedAt);
    latest.set(row.id, row);
  }

  const rows = await applyRouteCancellationsToRows(
    env,
    hub,
    [...latest.values()],
  );
  // MS_COMPLETION_ARCHIVE_TRUTH_V2: never expose a completion timestamp unless history proves an observed 0/1 -> 2 transition.
  const archiveVerifiedCompletionRoutes = await verifiedCompletionRouteIds(env, hub);
  for (const row of latest.values()) {
    row.completionObservedLive =
      Boolean(row.unloadingCompletedAt) &&
      archiveVerifiedCompletionRoutes.has(String(row.id || ""));
    if (row.unloadingCompletedAt && !row.completionObservedLive)
      row.unloadingCompletedAt = "";
  }

  const totalDistinct = Math.max(
    Number(distinctResult?.total_distinct) || 0,
    rows.length,
  );
  const complete = rows.length >= totalDistinct;
  return { rows, total: rows.length, totalDistinct, complete, branch: hub };
}

async function msCryptoKey(env) {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${env.AUTH_SECRET}|ms-credentials`),
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
async function encryptMs(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    data = new TextEncoder().encode(value),
    cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await msCryptoKey(env),
        data,
      ),
    );
  return `${b64(iv)}.${b64(cipher)}`;
}
async function decryptMs(value, env) {
  const [iv, cipher] = String(value || "").split(".");
  if (!iv || !cipher)
    fail("ข้อมูลเชื่อมต่อ MS เสียหาย", "MS_CREDENTIAL_ERROR", 500);
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await msCryptoKey(env),
    unb64(cipher),
  );
  return new TextDecoder().decode(data);
}

function mapMsRow(row) {
  return {
    id: row.id || "",
    proofId: row.proof_id || "",
    routeName: row.line_name || "",
    region: row.line_sorting_no || "",
    routeAttribute: row.line_mode_text || "",
    routeType: row.line_type_text || "",
    attendanceType: normalizeMsAttendance(row.type_text),
    estimatedArrivalAt: msDate(row.estimate_end_time),
    actualArrivalAt: msDate(row.actual_end_time),
    estimatedDepartureAt: msDate(row.estimate_start_time),
    actualDepartureAt: msDate(row.actual_start_time),
    supplier: row.fleet_name || "",
    vehicleType: row.car_type_text || row.car_type || "",
    plate: row.plate_number || "",
    driverName: row.driver || "",
    driverPhone: row.driver_phone || "",
    trackingStatus: row.urge_text || "",
    vehicleStatus: row.car_state_text || "",
    loadStatus: row.unloading_state_text || "",
    unloadingState: row.unloading_state,
    sourceUpdatedAt: "",
  };
}
function normalizeMsAttendance(value) {
  const text = String(value || "").trim();
  if (text.includes("จุดดร")) return "จุดดรอป";
  if (text.includes("ปลายทาง")) return "ปลายทาง";
  if (text.includes("ต้นทาง")) return "ต้นทาง";
  return text;
}
export function msDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value).trim();
  const n = Number(raw);
  let input = Number.isFinite(n) ? (n < 100000000000 ? n * 1000 : n) : raw;
  // MS/FBI returns local Thailand wall-clock values without a timezone.
  // Make the Bangkok offset explicit so Workers never interprets them as UTC.
  if (!Number.isFinite(n) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw))
    input = `${raw.replace(" ", "T")}+07:00`;
  const d = new Date(input);
  return isNaN(d) ? "" : d.toISOString();
}

function output(r) {
  if (!r) return r;
  const names = {
      previous_station: "previousStation",
      route_name: "routeName",
      driver_name: "driverName",
      driver_phone: "driverPhone",
      vehicle_type: "vehicleType",
      arrival_at: "arrivalAt",
      imported_at: "importedAt",
      source_file: "sourceFile",
      work_status: "workStatus",
      started_at: "startedAt",
      started_by: "startedBy",
      action_at: "actionAt",
      proof_id: "proofId",
      route_attribute: "routeAttribute",
      route_type: "routeType",
      attendance_type: "attendanceType",
      estimated_arrival_at: "estimatedArrivalAt",
      actual_arrival_at: "actualArrivalAt",
      estimated_departure_at: "estimatedDepartureAt",
      actual_departure_at: "actualDepartureAt",
      tracking_status: "trackingStatus",
      vehicle_status: "vehicleStatus",
      load_status: "loadStatus",
      unloading_state: "unloadingState",
      unloading_completed_at: "unloadingCompletedAt",
      source_updated_at: "sourceUpdatedAt",
      expected_parcels: "expectedParcels",
      entered_parcels: "enteredParcels",
      pending_parcels: "pendingParcels",
      schedule_kit_arrival_at: "scheduleKitArrivalAt",
      schedule_tbr_arrival_at: "scheduleTbrArrivalAt",
      arrived_parcels: "arrivedParcels",
      arrived_bags: "arrivedBags",
      synced_at: "syncedAt",
      synced_by: "syncedBy",
      route_id: "routeId",
      event_type: "eventType",
      snapshot_at: "snapshotAt",
      payload_json: "payloadJson",
      updated_at: "updatedAt",
      updated_by: "updatedBy",
      last_success_at: "lastSuccessAt",
      last_error: "lastError",
    },
    o = {};
  for (const [k, v] of Object.entries(r)) o[names[k] || k] = v;
  return o;
}
function pickBranch(actor, wanted) {
  const b = text(
    wanted || (actor.role === "admin" ? "NE1" : actor.branches[0]),
    80,
  ).toUpperCase();
  if (actor.role !== "admin" && !access(b, actor))
    fail("ไม่มีสิทธิ์ดูสาขานี้", "FORBIDDEN", 403);
  return b;
}
function access(hub, actor) {
  return (
    actor.role === "admin" ||
    actor.branches.includes("*") ||
    actor.branches.includes(String(hub || "").toUpperCase())
  );
}
function mustAdmin(a) {
  if (a.role !== "admin") fail("ใช้ได้เฉพาะผู้ดูแลระบบ", "ADMIN_REQUIRED", 403);
}
function branchList(v) {
  return String(v || "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}
async function batches(env, s) {
  for (let i = 0; i < s.length; i += 100)
    await env.DB.batch(s.slice(i, i + 100));
}
async function audit(env, a, id, d, u) {
  await env.DB.prepare(
    "INSERT INTO audit_log(timestamp,action,record_id,detail,operator) VALUES(?,?,?,?,?)",
  )
    .bind(new Date().toISOString(), a, id, d, u)
    .run();
}
async function passHash(u, p, env) {
  return sha(`${u}|${String(p || "")}|${env.PASSWORD_PEPPER}`);
}
async function passMatch(u, p, h, env) {
  return equal(await passHash(u, p, env), String(h || ""));
}
async function hmac(v, secret) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(v)),
    ),
  );
}
async function sha(v) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function equal(a, b) {
  const x = new TextEncoder().encode(String(a)),
    y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function b64(bytes) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64(v) {
  const s = v.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );
}
function text(v, n = 500) {
  return String(v ?? "")
    .trim()
    .slice(0, n);
}
function phone(v) {
  const s = text(v, 30).replace(/\.0$/, "");
  return /^\d{9}$/.test(s) ? `0${s}` : s;
}
function date(v) {
  if (v === null || v === undefined || v === "") return "";
  const d = new Date(v);
  return isNaN(d) ? text(v, 40) : d.toISOString();
}
function ok(data) {
  return { ok: true, data };
}
function fail(message, code = "SERVER_ERROR", status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  throw e;
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}
function json(v, status = 200) {
  return new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors(),
    },
  });
}
