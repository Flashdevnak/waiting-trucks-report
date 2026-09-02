import { readFile, writeFile, chmod } from "node:fs/promises";

const platformToken = String(process.env.TURSO_PLATFORM_API_TOKEN || "").trim();
const requestedOrg = String(process.env.TURSO_ORG_SLUG || "").trim();
const databaseFile = process.env.TURSO_DATABASE_FILE || "/tmp/waiting-trucks-dev.db";
const countsFile = process.env.TURSO_COUNTS_FILE || "/tmp/waiting-trucks-counts.json";
const secretsFile = process.env.TURSO_WORKER_SECRETS_FILE || "/tmp/turso-worker-secrets.json";
const outputFile = process.env.GITHUB_OUTPUT || "";

if (!platformToken) throw new Error("TURSO_PLATFORM_API_TOKEN is missing");

let created = null;
let orgSlug = "";

try {
  const organizations = await platform("/v1/organizations");
  if (!Array.isArray(organizations) || organizations.length === 0)
    throw new Error("Turso account has no accessible organizations");

  const organization = requestedOrg
    ? organizations.find((item) => item?.slug === requestedOrg)
    : organizations.find((item) => item?.type === "personal") ||
      (organizations.length === 1 ? organizations[0] : null);

  if (!organization?.slug) {
    throw new Error(
      requestedOrg
        ? `TURSO_ORG_SLUG=${requestedOrg} is not accessible with this token`
        : "Multiple Turso organizations found and no personal organization could be selected",
    );
  }
  orgSlug = organization.slug;

  const groupsPayload = await platform(`/v1/organizations/${encodeURIComponent(orgSlug)}/groups`);
  let groups = Array.isArray(groupsPayload?.groups) ? groupsPayload.groups : [];
  let group = groups.find((item) => item?.name === "default") || groups[0] || null;

  if (!group) {
    const locationsPayload = await platform("/v1/locations");
    const locations = Object.keys(locationsPayload?.locations || {});
    if (!locations.length) throw new Error("Turso returned no available database locations");
    const preferred = [
      "aws-ap-southeast-1",
      "aws-ap-northeast-1",
      "aws-ap-south-1",
    ];
    const location = preferred.find((item) => locations.includes(item)) ||
      locations.find((item) => item.includes("ap-")) || locations[0];
    const createdGroup = await platform(
      `/v1/organizations/${encodeURIComponent(orgSlug)}/groups`,
      {
        method: "POST",
        json: { name: "default", location },
      },
    );
    group = createdGroup?.group;
  }

  if (!group?.name) throw new Error("Unable to resolve a Turso database group");

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14).toLowerCase();
  const databaseName = `waiting-trucks-dev-${stamp}`.slice(0, 64);
  const createdPayload = await platform(
    `/v1/organizations/${encodeURIComponent(orgSlug)}/databases`,
    {
      method: "POST",
      json: {
        name: databaseName,
        group: group.name,
        seed: { type: "database_upload" },
      },
    },
  );

  created = createdPayload?.database;
  const hostname = String(created?.Hostname || "").trim();
  const actualName = String(created?.Name || databaseName).trim();
  if (!hostname || !actualName) throw new Error("Turso create database response is missing Hostname or Name");

  const tokenPayload = await platform(
    `/v1/organizations/${encodeURIComponent(orgSlug)}/databases/${encodeURIComponent(actualName)}/auth/tokens?authorization=full-access`,
    { method: "POST" },
  );
  const databaseToken = String(tokenPayload?.jwt || "").trim();
  if (!databaseToken) throw new Error("Turso did not return a database auth token");
  console.log(`::add-mask::${databaseToken}`);

  const databaseBytes = await readFile(databaseFile);
  const upload = await fetch(`https://${hostname}/v1/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${databaseToken}`,
      "Content-Length": String(databaseBytes.byteLength),
      "Content-Type": "application/octet-stream",
    },
    body: databaseBytes,
  });
  if (!upload.ok) {
    const text = await upload.text().catch(() => "");
    throw new Error(`Turso database upload failed: HTTP ${upload.status} ${text.slice(0, 300)}`);
  }

  const expectedCounts = JSON.parse(await readFile(countsFile, "utf8"));
  const tableNames = Object.keys(expectedCounts).sort();
  if (!tableNames.length) throw new Error("Local migration verification found no tables");

  const requests = tableNames.map((name) => ({
    type: "execute",
    stmt: { sql: `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(name)}` },
  }));
  requests.push({ type: "close" });

  const verifyResponse = await fetch(`https://${hostname}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${databaseToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });
  const verifyPayload = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok || !Array.isArray(verifyPayload?.results)) {
    throw new Error(`Turso verification pipeline failed: HTTP ${verifyResponse.status}`);
  }

  const actualCounts = {};
  for (let index = 0; index < tableNames.length; index += 1) {
    const item = verifyPayload.results[index];
    if (item?.type === "error") {
      throw new Error(`Turso verification failed for ${tableNames[index]}: ${item.error?.message || "query error"}`);
    }
    const result = item?.response?.result;
    actualCounts[tableNames[index]] = Number(decode(result?.rows?.[0]?.[0]) || 0);
  }

  const mismatches = tableNames
    .filter((name) => Number(expectedCounts[name]) !== Number(actualCounts[name]))
    .map((name) => ({ table: name, expected: Number(expectedCounts[name]), actual: Number(actualCounts[name]) }));
  if (mismatches.length) {
    throw new Error(`Turso row-count verification mismatch: ${JSON.stringify(mismatches.slice(0, 20))}`);
  }

  const databaseUrl = `libsql://${hostname}`;
  await writeFile(
    secretsFile,
    JSON.stringify({
      TURSO_DATABASE_URL: databaseUrl,
      TURSO_AUTH_TOKEN: databaseToken,
    }),
    { mode: 0o600 },
  );
  await chmod(secretsFile, 0o600);

  if (outputFile) {
    await writeFile(
      outputFile,
      `turso_database_name=${actualName}\nturso_hostname=${hostname}\nturso_org=${orgSlug}\n`,
      { flag: "a" },
    );
  }

  console.log(`TURSO_ORG=${orgSlug}`);
  console.log(`TURSO_GROUP=${group.name}`);
  console.log(`TURSO_DATABASE=${actualName}`);
  console.log(`TURSO_HOSTNAME=${hostname}`);
  console.log(`TURSO_UPLOAD_BYTES=${databaseBytes.byteLength}`);
  console.log(`TURSO_VERIFIED_TABLES=${tableNames.length}`);
  console.log("TURSO_ROW_COUNTS=PASS");
} catch (error) {
  if (created?.Name && orgSlug) {
    try {
      await platform(
        `/v1/organizations/${encodeURIComponent(orgSlug)}/databases/${encodeURIComponent(created.Name)}`,
        { method: "DELETE" },
      );
      console.error(`Cleaned up incomplete Turso database ${created.Name}`);
    } catch (cleanupError) {
      console.error(`Could not clean up incomplete Turso database: ${cleanupError.message}`);
    }
  }
  throw error;
}

async function platform(path, { method = "GET", json } = {}) {
  const response = await fetch(`https://api.turso.tech${path}`, {
    method,
    redirect: "follow",
    headers: {
      Authorization: `Bearer ${platformToken}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const message = typeof payload === "string"
      ? payload
      : payload?.error || payload?.message || JSON.stringify(payload || {});
    throw new Error(`Turso Platform API ${method} ${path} failed: HTTP ${response.status} ${String(message).slice(0, 500)}`);
  }
  return payload;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function decode(value) {
  if (value == null) return null;
  if (typeof value !== "object" || !value.type) return value;
  if (value.type === "integer" || value.type === "float") return Number(value.value);
  if (value.type === "null") return null;
  return value.value ?? null;
}
