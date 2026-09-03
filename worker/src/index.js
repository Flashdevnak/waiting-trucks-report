import { canonicalMsSource, planMsChanges } from "./sync-policy.js";

const SESSION_MS = 180 * 86400000;
const MS_SYNC_TTL = 3000;
const CONNECTION_HEARTBEAT_MS = 15 * 60 * 1000;
const CONNECTOR_HEARTBEAT_MS = 60 * 60 * 1000;
const recentMsSync = new Map();
const activeMsSync = new Map();
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
      const url = new URL(request.url);
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
      : (
          await env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?")
            .bind(branch)
            .all()
        ).results.map(output);
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
    });
  }
  if (action === "msArchiveTotal") {
    const branch = pickBranch(actor, url.searchParams.get("branch"));
    return ok(await msArchiveTotal(env, actor, branch));
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
  const actor = await verify(body.token, env);
  if (action === "import") return ok(await importRows(body, actor, env));
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
  if (action === "createMsPairing") {
    return ok(await createMsPairing(body, actor, env));
  }
  fail("ไม่รู้จักคำสั่งที่ส่งมา", "UNKNOWN_ACTION");
}

async function login(body, env) {
  const username = text(body.username, 30).toUpperCase();
  let user = await env.DB.prepare("SELECT * FROM users WHERE username=?")
    .bind(username)
    .first();
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
    user = await env.DB.prepare(
      "SELECT * FROM users WHERE username='ADMIN'",
    ).first();
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

async function verify(token, env) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (
      !payload ||
      !signature ||
      !(await equal(signature, await hmac(payload, env.AUTH_SECRET)))
    )
      throw 0;
    const actor = JSON.parse(new TextDecoder().decode(unb64(payload)));
    if (Date.now() > Number(actor.expiresAt)) throw 0;
    const user = await env.DB.prepare(
      "SELECT username,role,branches,active FROM users WHERE username=?",
    )
      .bind(actor.username)
      .first();
    if (!user || user.active !== 1 || user.role !== actor.role) throw 0;
    return {
      username: user.username,
      role: user.role,
      branches: branchList(user.branches),
    };
  } catch {
    fail("สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "INVALID_SESSION", 401);
  }
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

async function readSettings(env, branch) {
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM hub_settings WHERE branch=? AND enabled=1 ORDER BY category,setting_key",
    )
      .bind(branch)
      .all()
  ).results;
  const central = CENTRAL_LIMITS[branch] || [],
    queue = rows.filter((x) => x.category === "vehicle"),
    ms = rows.filter((x) => x.category === "ms_vehicle"),
    pauses = rows.filter((x) => x.category === "pause");
  return {
    branch,
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
            key: x[0],
            label: x[1],
            startHour: x[2],
            endHour: x[3],
          })),
    vehicleLimits: queue.length
      ? queue.map((x) => ({ type: x.setting_key, minutes: x.minutes }))
      : LIMITS.map((type) => ({ type, minutes: 120 })),
    msVehicleLimits: ms.length
      ? ms.map((x) => ({ type: x.setting_key, minutes: x.minutes }))
      : LIMITS.map((type, i) => ({ type, minutes: central[i] || 120 })),
  };
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

async function syncMs(body, actor, env) {
  if (!Array.isArray(body.rows) || body.rows.length > 2000)
    fail("ข้อมูล MS ไม่ถูกต้องหรือเกิน 2,000 รายการ");
  const branch = text(
    body.branch || (actor.role === "admin" ? "" : actor.branches[0]),
    80,
  ).toUpperCase();
  if (!branch || !access(branch, actor))
    fail("ไม่มีสิทธิ์ซิงก์ HUB นี้", "FORBIDDEN", 403);
  const oldRows = (
    await env.DB.prepare("SELECT * FROM ms_routes WHERE hub=?")
      .bind(branch)
      .all()
  ).results;
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
      priorCompletedAt = old?.unloading_completed_at,
      unloadingCompletedAt =
        unloadingState === 2
          ? Number.isFinite(Date.parse(priorCompletedAt || ""))
            ? priorCompletedAt
            : now
          : "";
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
      sourceUpdatedAt: values[22],
      expectedParcels: values[23],
      enteredParcels: values[24],
      pendingParcels: values[25],
      scheduleKitArrivalAt: values[26],
      scheduleTbrArrivalAt: values[27],
      arrivedParcels: values[28],
      arrivedBags: values[29],
    };
    prepared.push({ id, values, snapshot });
  }
  const plan = planMsChanges(
      oldRows.map(output),
      prepared.map((item) => item.snapshot),
      Boolean(body.preserveMissing),
    ),
    changedIds = new Set(plan.changedIds),
    removedIds = new Set(plan.removedIds),
    statements = [];
  for (const item of prepared) {
    const old = oldById.get(item.id);
    if (changedIds.has(item.id)) {
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
          JSON.stringify(item.snapshot),
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
          JSON.stringify(output(old)),
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
    const previous = old ? output(old) : null;
    const changed = changedIds.has(item.id);
    return {
      ...item.snapshot,
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

async function refreshMsIfStale(env, actor, branch, force = false) {
  if (!access(branch, actor)) return { status: "forbidden" };
  const nowMs = Date.now(), recent = recentMsSync.get(branch);
  if (!force && recent?.until > nowMs) return recent.result;
  if (activeMsSync.has(branch)) return activeMsSync.get(branch);
  const task = runMsRefresh(env, branch).finally(() => activeMsSync.delete(branch));
  activeMsSync.set(branch, task);
  return task;
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
    const parcelCounts = await readPreEntryCounts(env, branch);
    const busData = await readBusTimeData(env, branch);
    const mappedRows = rows.map((row) =>
      enrichMsRow(mapMsRow(row), parcelCounts, busData),
    );
    const sourceHash = await sha(canonicalMsSource(mappedRows));
    const cachedRows = await readMsLiveCache(env, branch, sourceHash);
    const sync = cachedRows
      ? {
          syncedAt: new Date().toISOString(),
          changes: 0,
          rows: cachedRows,
        }
      : await syncMs(
          { branch, rows: mappedRows },
          { username: "MS_AUTO", role: "admin", branches: ["*"] },
          env,
        );
    if (!cachedRows)
      await safeStatusWrite(
        writeMsLiveCache(env, branch, sourceHash, sync.rows, sync.syncedAt),
        "ms_live_cache_write_error",
        branch,
      );
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
    };
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  } catch (error) {
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
      error: error.message || "เชื่อมต่อ MS ไม่สำเร็จ",
    };
    recentMsSync.set(branch, { until: Date.now() + MS_SYNC_TTL, result });
    return result;
  }
}

async function readMsLiveCache(env, hub, sourceHash) {
  try {
    const row = await env.DB.prepare(
      "SELECT source_hash,rows_json FROM ms_live_cache WHERE hub=?",
    )
      .bind(hub)
      .first();
    if (!row || row.source_hash !== sourceHash) return null;
    const rows = JSON.parse(row.rows_json || "[]");
    return Array.isArray(rows) ? rows : null;
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

async function writeMsLiveCache(env, hub, sourceHash, rows, syncedAt) {
  return env.DB.prepare(
    "INSERT INTO ms_live_cache(hub,source_hash,rows_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(hub) DO UPDATE SET source_hash=excluded.source_hash,rows_json=excluded.rows_json,synced_at=excluded.synced_at",
  )
    .bind(hub, sourceHash, JSON.stringify(rows || []), syncedAt || new Date().toISOString())
    .run();
}

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

async function readMsRoutes(credentials, wantedStart, wantedEnd) {
  const nowThai = Date.now() + 7 * 3600000;
  const start = Number.isFinite(wantedStart)
    ? wantedStart
    : Math.floor(nowThai / 86400000) * 86400000 - 7 * 3600000 - 86400000;
  const end = Number.isFinite(wantedEnd) ? wantedEnd : start + 2 * 86400000 - 1000;
  const first = await readMsPage(credentials, 1, start, end),
    rows = [...first.items];
  const pages = Math.min(
    20,
    Math.ceil((Number(first.total) || rows.length) / 100),
  );
  if (pages > 1) {
    const remaining = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        readMsPage(credentials, index + 2, start, end),
      ),
    );
    for (const result of remaining) rows.push(...result.items);
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
  const bus = findEnrichment(busData, mapped);
  if (bus) {
    mapped.scheduleKitArrivalAt = bus.scheduleKitArrivalAt;
    mapped.scheduleTbrArrivalAt = bus.scheduleTbrArrivalAt;
    mapped.arrivedParcels = bus.arrivedParcels;
    mapped.arrivedBags = bus.arrivedBags;
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
  const response = await fetch(url, {
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
  if (!response.ok) fail(`MS ตอบกลับ ${response.status}`, "MS_HTTP_ERROR", 502);
  const json = await response.json();
  if (json.code !== 1)
    fail(json.message || "เซสชัน MS หมดอายุ", "MS_SESSION_EXPIRED", 502);
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

async function preEntryCredentials(env, hub) {
  const row = await env.DB.prepare(
    "SELECT credentials_cipher FROM ms_preentry_connections WHERE hub=?",
  ).bind(hub).first();
  if (!row) return null;
  try { return JSON.parse(await decryptMs(row.credentials_cipher, env)); }
  catch { return null; }
}

async function readPreEntryCounts(env, hub, wantedDays = liveSourceDays()) {
  const credentials = await preEntryCredentials(env, hub);
  if (!credentials) return new Map();
  try {
    const rows = [];
    for (const day of wantedDays) {
      const first = await readPreEntryPage(credentials, 1, day);
      rows.push(...first.items);
      const pages = Math.min(20, Math.ceil((first.total || first.items.length) / 100));
      if (pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>
          readPreEntryPage(credentials, index + 2, day)));
        rest.forEach((result) => rows.push(...result.items));
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
    return new Map();
  }
}

async function readPreEntryPage(credentials, page, day) {
  const url = new URL("https://fbi.flashexpress.com/api/route/route_followstart");
  for (const key of ["lang", "auth", "fbid", "time", "_from", "nonce", "referer", "iv"])
    if (credentials[key]) url.searchParams.set(key, credentials[key]);
  for (const [key, value] of Object.entries({
    stat_time: day, last_stop: "", next_store_id: credentials.next_store_id || "",
    page: String(page), page_size: "100", export: "0",
  })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: {
    Accept: "application/json, text/plain, */*",
    Referer: "https://fbi.flashexpress.com/fbi-ui/",
    "User-Agent": "Mozilla/5.0", "BI-PLATFORM": "pc",
  }});
  if (!response.ok) fail(`ข้อมูลพัสดุตอบกลับ ${response.status}`, "PREENTRY_HTTP_ERROR", 502);
  const json = await response.json();
  if (Number(json.code) !== 1)
    fail(json.message || "เซสชันพัสดุที่คาดว่าจะเข้าคลังหมดอายุ", "PREENTRY_SESSION_EXPIRED", 502);
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

async function readBusTimeData(env, hub, wantedDays = liveSourceDays()) {
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
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>
          readBusPage(credentials, index + 2, day)));
        rest.forEach((result) => rows.push(...result.items));
      }
    }
    await safeStatusWrite(
      markConnectionSuccess(env, "ms_bus_connections", hub),
      "ms_bus_success_write_error",
      hub,
    );
    const result = new Map();
    for (const item of rows) {
      const targetStore = String(nestedValue(item.next_store_info, 0) || "").toUpperCase();
      if (targetStore && !targetStore.includes(String(hub).toUpperCase())) continue;
      const proofId = nestedValue(item.proof_id, 0);
      const key = normalizeProofId(proofId);
      const routeName = nestedValue(item.line_info, 0);
      if (!key) continue;
      const kit = msDate(nestedValue(item.kit_arrive_time, 0));
      const tbr = msDate(nestedValue(item.fleet_sign_info, 0));
      const current = result.get(`P:${key}`) || {};
      const candidate = {
        proofId: text(proofId, 100),
        routeName: text(routeName, 300),
        scheduleKitArrivalAt: earliestDate(current.scheduleKitArrivalAt, kit),
        scheduleTbrArrivalAt: earliestDate(current.scheduleTbrArrivalAt, tbr),
        arrivedParcels: Math.max(Number(current.arrivedParcels) || 0, Number(nestedValue(item.parcel_count, 0)) || 0),
        arrivedBags: Math.max(Number(current.arrivedBags) || 0, Number(nestedValue(item.pack_count, 0)) || 0),
      };
      setEnrichmentAliases(result, candidate, proofId);
    }
    return result;
  } catch (error) {
    await safeStatusWrite(
      markConnectionError(env, "ms_bus_connections", hub, error.message),
      "ms_bus_error_write_error",
      hub,
    );
    console.error(JSON.stringify({ event: "ms_bus_sync_error", hub, message: error.message }));
    return new Map();
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
  const response = await fetch(url, { headers: {
    Accept: "application/json, text/plain, */*", Referer: "https://fbi.flashexpress.com/fbi-ui/",
    "User-Agent": "Mozilla/5.0", "BI-PLATFORM": "pc",
  }});
  if (!response.ok) fail(`ข้อมูลตารางเวลาตอบกลับ ${response.status}`, "BUS_TIME_HTTP_ERROR", 502);
  const json = await response.json();
  if (Number(json.code) !== 1)
    fail(json.msg || "เซสชันการจัดการตารางเวลาหมดอายุ", "BUS_TIME_SESSION_EXPIRED", 502);
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
  await audit(
    env,
    "SAVE_MS_CONNECTION",
    hub,
    `ทดสอบสำเร็จ ${test.total} รายการ`,
    updatedBy,
  );
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

async function connectorSync(body, env) {
  const hub = text(body.hub, 80).toUpperCase(), tokenHash = await sha256(text(body.connectorToken, 500));
  const row = await env.DB.prepare("SELECT hub FROM ms_connector_tokens WHERE hub=? AND token_hash=? AND active=1").bind(hub, tokenHash).first();
  if (!row) fail("ตัวเชื่อมต่อไม่ถูกต้อง", "INVALID_CONNECTOR", 401);
  const result = await refreshMsIfStale(env, { username: "MS_CRON", role: "admin", branches: ["*"] }, hub);
  const now = new Date().toISOString(), cutoff = new Date(Date.parse(now) - CONNECTOR_HEARTBEAT_MS).toISOString();
  await safeStatusWrite(
    env.DB.prepare(
      "UPDATE ms_connector_tokens SET last_used_at=? WHERE hub=? AND (last_used_at IS NULL OR last_used_at='' OR last_used_at<?)",
    ).bind(now, hub, cutoff).run(),
    "ms_connector_heartbeat_write_error",
    hub,
  );
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

async function msCredentials(env, hub) {
  const row = await env.DB.prepare(
    "SELECT session_cipher,device_cipher FROM ms_connections WHERE hub=?",
  )
    .bind(hub)
    .first();
  if (row)
    return {
      sessionId: await decryptMs(row.session_cipher, env),
      deviceId: await decryptMs(row.device_cipher, env),
    };
  if (
    hub === text(env.MS_BRANCH || "NE1", 80).toUpperCase() &&
    env.MS_SESSION_ID &&
    env.MS_DEVICE_ID
  )
    return { sessionId: env.MS_SESSION_ID, deviceId: env.MS_DEVICE_ID };
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
  const [routes, preEntry, busTime] = await Promise.all([
    env.DB.prepare("SELECT updated_at,updated_by,last_success_at,last_error FROM ms_connections WHERE hub=?").bind(hub).first(),
    env.DB.prepare("SELECT updated_at,updated_by,last_success_at,last_error FROM ms_preentry_connections WHERE hub=?").bind(hub).first(),
    env.DB.prepare("SELECT updated_at,updated_by,last_success_at,last_error FROM ms_bus_connections WHERE hub=?").bind(hub).first(),
  ]);
  const source = (row) => row
    ? { configured: true, ...output(row) }
    : { configured: false, updatedAt: "", updatedBy: "", lastSuccessAt: "", lastError: "" };
  return { hub, routes: source(routes), preEntry: source(preEntry), busTime: source(busTime) };
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

  const rows = [...latest.values()];
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
