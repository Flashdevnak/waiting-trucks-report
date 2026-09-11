const TURSO_ORG = process.env.TURSO_ORG || "flashdevnak";
const TURSO_DATABASE =
  process.env.TURSO_DATABASE || "waiting-trucks-dev-turso-20260902192750";
const WORKER_ORIGIN =
  process.env.WORKER_ORIGIN ||
  "https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev";

function decode(cell) {
  if (cell == null || typeof cell !== "object") return cell;
  return "value" in cell ? cell.value : cell;
}

function rowsAsObjects(result) {
  const columns = (result?.cols || []).map((column) => column.name);
  return (result?.rows || []).map((row) =>
    Object.fromEntries(columns.map((name, index) => [name, decode(row[index])])),
  );
}

function ageSeconds(value, now = Date.now()) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round((now - parsed) / 1000)) : -1;
}

export function classifyHubRuntime(row, now = Date.now()) {
  const configured = Number(row.route_configured || 0) === 1;
  const acceptedRows = Number(row.accepted_rows);
  const hasAcceptedSnapshot =
    Boolean(row.accepted_snapshot_at) && Number.isFinite(acceptedRows) && acceptedRows >= 0;
  const error = String(row.route_last_error || "");
  const sessionExpired = /(?:401|403|session|token|auth|login|expired|หมดอายุ)/i.test(error);
  const connectorActive = Number(row.connector_active || 0) === 1;
  let state = "NOT_CONFIGURED";
  if (configured && sessionExpired && hasAcceptedSnapshot) state = "DEGRADED_SESSION";
  else if (configured && sessionExpired) state = "SESSION_REQUIRED";
  else if (configured && row.route_last_success_at && hasAcceptedSnapshot) state = "READY";
  else if (configured) state = "ONBOARDING";
  return {
    hub: String(row.hub || ""),
    state,
    configured,
    connectorActive,
    credentialUpdatedAt: row.credential_updated_at || "",
    routeLastSuccessAt: row.route_last_success_at || "",
    routeSuccessAgeSeconds: ageSeconds(row.route_last_success_at, now),
    routeLastError: error,
    connectorLastUsedAt: row.connector_last_used_at || "",
    connectorAgeSeconds: ageSeconds(row.connector_last_used_at, now),
    acceptedSnapshotAt: row.accepted_snapshot_at || "",
    acceptedSnapshotAgeSeconds: ageSeconds(row.accepted_snapshot_at, now),
    acceptedRows: Number.isFinite(acceptedRows) ? acceptedRows : null,
    routeRows: Number(row.route_rows || 0),
    routeMaxSyncedAt: row.route_max_synced_at || "",
  };
}

async function createQuery() {
  const platform = process.env.TURSO_PLATFORM_API_TOKEN;
  if (!platform) throw new Error("TURSO_PLATFORM_API_TOKEN is required");
  const headers = { Authorization: `Bearer ${platform}` };
  const lookup = await fetch(
    `https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases/${TURSO_DATABASE}`,
    { headers },
  );
  const lookupJson = await lookup.json();
  if (!lookup.ok) throw new Error(`Turso lookup HTTP ${lookup.status}`);
  const database = lookupJson.database || lookupJson;
  const hostname = database.Hostname || database.hostname;
  if (!hostname) throw new Error("Turso hostname missing");
  const tokenResponse = await fetch(
    `https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases/${TURSO_DATABASE}/auth/tokens?authorization=full-access`,
    { method: "POST", headers },
  );
  const tokenJson = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenJson.jwt)
    throw new Error(`Turso token HTTP ${tokenResponse.status}`);
  console.log(`::add-mask::${tokenJson.jwt}`);
  return async (sql) => {
    const response = await fetch(`https://${hostname}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenJson.jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: [{ type: "execute", stmt: { sql } }, { type: "close" }],
      }),
    });
    const payload = await response.json();
    const item = payload?.results?.[0];
    if (!response.ok || item?.type === "error")
      throw new Error(`Turso SELECT failed: ${JSON.stringify(item?.error || payload)}`);
    return rowsAsObjects(item?.response?.result);
  };
}

export async function inspectAllHubs() {
  const query = await createQuery();
  const [rows, healthResponse] = await Promise.all([
    query(`
      WITH known_hubs AS (
        SELECT hub FROM ms_connections
        UNION SELECT hub FROM ms_connector_tokens
        UNION SELECT hub FROM ms_live_cache
        UNION SELECT hub FROM ms_routes
      )
      SELECT
        h.hub,
        CASE WHEN c.hub IS NULL THEN 0 ELSE 1 END AS route_configured,
        c.updated_at AS credential_updated_at,
        c.last_success_at AS route_last_success_at,
        c.last_error AS route_last_error,
        COALESCE(t.active,0) AS connector_active,
        t.last_used_at AS connector_last_used_at,
        l.synced_at AS accepted_snapshot_at,
        CASE
          WHEN json_type(l.rows_json)='array' THEN json_array_length(l.rows_json)
          WHEN json_type(l.rows_json,'$.rows')='array' THEN json_array_length(l.rows_json,'$.rows')
          ELSE NULL
        END AS accepted_rows,
        COUNT(r.id) AS route_rows,
        MAX(r.synced_at) AS route_max_synced_at
      FROM known_hubs h
      LEFT JOIN ms_connections c ON c.hub=h.hub
      LEFT JOIN ms_connector_tokens t ON t.hub=h.hub
      LEFT JOIN ms_live_cache l ON l.hub=h.hub
      LEFT JOIN ms_routes r ON r.hub=h.hub
      GROUP BY h.hub
      ORDER BY h.hub
    `),
    fetch(`${WORKER_ORIGIN}/api?action=health`, { cache: "no-store" }),
  ]);
  const health = await healthResponse.json().catch(() => ({}));
  return {
    generatedAt: new Date().toISOString(),
    workerHealth: Boolean(healthResponse.ok && health?.ok),
    hubs: rows.map((row) => classifyHubRuntime(row)),
    quota: { upstreamReads: 0, upstreamWrites: 0, tursoSelects: 1, tursoWrites: 0 },
  };
}

const invoked = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (invoked) {
  inspectAllHubs()
    .then((report) => {
      console.log(`HUB_RUNTIME_REPORT=${JSON.stringify(report)}`);
      if (!report.workerHealth) throw new Error("DEV Worker health failed");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
