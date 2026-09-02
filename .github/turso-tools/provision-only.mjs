import { writeFile, chmod } from "node:fs/promises";

const token = String(process.env.TURSO_PLATFORM_API_TOKEN || "").trim();
const requestedOrg = String(process.env.TURSO_ORG_SLUG || "").trim();
const databaseName = String(process.env.TURSO_DATABASE_NAME || "waiting-trucks-dev-turso").trim();
const secretsFile = process.env.TURSO_WORKER_SECRETS_FILE || "/tmp/turso-worker-secrets.json";
const outputFile = process.env.GITHUB_OUTPUT || "";
if (!token) throw new Error("TURSO_PLATFORM_API_TOKEN is missing");

const organizations = await platform("/v1/organizations");
const organization = requestedOrg
  ? organizations.find((item) => item?.slug === requestedOrg)
  : organizations.find((item) => item?.type === "personal") || (organizations.length === 1 ? organizations[0] : null);
if (!organization?.slug) throw new Error("Unable to select Turso organization");
const org = organization.slug;

const groupsPayload = await platform(`/v1/organizations/${encodeURIComponent(org)}/groups`);
let groups = Array.isArray(groupsPayload?.groups) ? groupsPayload.groups : [];
let group = groups.find((item) => item?.name === "default") || groups[0] || null;
if (!group) {
  const locationsPayload = await platform("/v1/locations");
  const locations = Object.keys(locationsPayload?.locations || {});
  const preferred = ["aws-ap-northeast-1", "aws-ap-south-1"];
  const location = preferred.find((item) => locations.includes(item)) || locations.find((item) => item.includes("ap-")) || locations[0];
  if (!location) throw new Error("Turso returned no usable location");
  const created = await platform(`/v1/organizations/${encodeURIComponent(org)}/groups`, {
    method: "POST",
    json: { name: "default", location },
  });
  group = created?.group;
}
if (!group?.name) throw new Error("Unable to resolve Turso group");

let database = null;
try {
  database = (await platform(`/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(databaseName)}`))?.database || null;
} catch (error) {
  if (error.status !== 404) throw error;
}
if (!database) {
  database = (await platform(`/v1/organizations/${encodeURIComponent(org)}/databases`, {
    method: "POST",
    json: { name: databaseName, group: group.name, seed: { type: "database_upload" } },
  }))?.database || null;
}
const actualName = String(database?.Name || databaseName).trim();
const hostname = String(database?.Hostname || "").trim();
if (!hostname) throw new Error("Turso database hostname missing");

const tokenPayload = await platform(
  `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(actualName)}/auth/tokens?authorization=full-access`,
  { method: "POST" },
);
const databaseToken = String(tokenPayload?.jwt || "").trim();
if (!databaseToken) throw new Error("Turso database token missing");
console.log(`::add-mask::${databaseToken}`);
await writeFile(secretsFile, JSON.stringify({ TURSO_DATABASE_URL: `libsql://${hostname}`, TURSO_AUTH_TOKEN: databaseToken }), { mode: 0o600 });
await chmod(secretsFile, 0o600);

if (outputFile) {
  await writeFile(outputFile, `turso_org=${org}\nturso_group=${group.name}\nturso_database_name=${actualName}\nturso_hostname=${hostname}\nturso_primary=${database?.primaryRegion || group?.primary || ""}\n`, { flag: "a" });
}
console.log(`TURSO_ORG=${org}`);
console.log(`TURSO_GROUP=${group.name}`);
console.log(`TURSO_GROUP_PRIMARY=${group.primary || "unknown"}`);
console.log(`TURSO_DATABASE=${actualName}`);
console.log(`TURSO_PRIMARY_REGION=${database?.primaryRegion || group.primary || "unknown"}`);
console.log(`TURSO_HOSTNAME=${hostname}`);
console.log("D1_ACCESS=0");

async function platform(path, { method = "GET", json } = {}) {
  const response = await fetch(`https://api.turso.tech${path}`, {
    method,
    redirect: "follow",
    headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const error = new Error(`Turso Platform API ${method} ${path} failed: HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
