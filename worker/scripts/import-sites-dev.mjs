import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE_API = process.env.MIGRATION_SOURCE_API;
const TRANSFER_TOKEN = process.env.MIGRATION_TRANSFER_TOKEN;
const CONFIG = process.env.WRANGLER_CONFIG || "wrangler.dev.jsonc";
const DATABASE = process.env.WRANGLER_DATABASE || "DB";

if (!SOURCE_API || !TRANSFER_TOKEN) {
  throw new Error("MIGRATION_SOURCE_API and MIGRATION_TRANSFER_TOKEN are required");
}

const TABLES = [
  "active_trucks",
  "audit_log",
  "hub_settings",
  "ms_bus_connections",
  "ms_connections",
  "ms_connector_tokens",
  "ms_pairings",
  "ms_preentry_connections",
  "ms_route_history",
  "ms_routes",
  "truck_history",
  "users",
];

const SECRET_KEYS = [
  "AUTH_SECRET",
  "INITIAL_ADMIN_PASSWORD",
  "PASSWORD_PEPPER",
  "MS_DEVICE_ID",
  "MS_SESSION_ID",
];

function runWrangler(args, options = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.quiet ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`wrangler ${args[0]} failed with exit code ${result.status}`);
  }
  return result.stdout || "";
}

async function sourceRequest(kind, extra = {}) {
  const response = await fetch(SOURCE_API, {
    method: "POST",
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({
      action: "migrationExport",
      transferToken: TRANSFER_TOKEN,
      kind,
      ...extra,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`Source export failed (${response.status}, ${payload?.errorCode || "UNKNOWN"})`);
  }
  return payload.data;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number in export");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value !== "string") value = JSON.stringify(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Unsafe SQL identifier");
  return `"${value}"`;
}

async function exportTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await sourceRequest("table", { table, offset, limit: 500 });
    if (page.table !== table || !Array.isArray(page.rows)) throw new Error(`Invalid ${table} page`);
    rows.push(...page.rows);
    if (!page.hasMore) break;
  }
  return rows;
}

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Could not parse Wrangler JSON output");
  return JSON.parse(output.slice(start, end + 1));
}

function remoteCount(table) {
  const output = runWrangler([
    "d1", "execute", DATABASE, "--remote", "--config", CONFIG,
    "--command", `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`, "--json",
  ], { quiet: true });
  const parsed = parseWranglerJson(output);
  return Number(parsed?.[0]?.results?.[0]?.row_count ?? -1);
}

const tempDir = await mkdtemp(join(tmpdir(), "waiting-trucks-migration-"));
try {
  const manifest = await sourceRequest("manifest");
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tables)) {
    throw new Error("Unsupported source manifest");
  }
  const expected = new Map(manifest.tables.map((entry) => [entry.table, Number(entry.rowCount)]));
  if (TABLES.some((table) => !expected.has(table)) || expected.size !== TABLES.length) {
    throw new Error("Source table manifest does not match the approved whitelist");
  }

  const secrets = await sourceRequest("secrets");
  for (const key of SECRET_KEYS) {
    const value = String(secrets[key] || "");
    if (!value) continue;
    process.stdout.write(`::add-mask::${value}\n`);
    runWrangler(["secret", "put", key, "--config", CONFIG], { input: `${value}\n`, quiet: true });
  }

  for (const table of TABLES) {
    const rows = await exportTable(table);
    if (rows.length !== expected.get(table)) {
      throw new Error(`${table}: exported ${rows.length}, expected ${expected.get(table)}`);
    }
    if (rows.length) {
      const statements = ["PRAGMA foreign_keys=OFF;"];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        statements.push(
          `INSERT OR REPLACE INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(",")});`,
        );
      }
      const sqlPath = join(tempDir, `${table}.sql`);
      await writeFile(sqlPath, `${statements.join("\n")}\n`, { mode: 0o600 });
      runWrangler(["d1", "execute", DATABASE, "--remote", "--config", CONFIG, "--file", sqlPath]);
    }
    const actual = remoteCount(table);
    if (actual !== expected.get(table)) {
      throw new Error(`${table}: DEV row count ${actual}, expected ${expected.get(table)}`);
    }
    console.log(`${table}: ${actual} rows verified`);
  }

  console.log("DEV migration copy verified against the source manifest");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
