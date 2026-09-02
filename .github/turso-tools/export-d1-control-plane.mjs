import { writeFile } from "node:fs/promises";

const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const databaseId = String(process.env.DEV_D1_DATABASE_ID || "798db282-46cd-4b2c-bfca-3d6d29596451").trim();
const output = process.env.D1_EXPORT_OUTPUT || "/tmp/waiting-trucks-d1-export.sql";
if (!account || !token || !databaseId) throw new Error("Cloudflare export credentials are missing");

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/export`;
let body = { output_format: "polling" };
let signedUrl = "";
for (let attempt = 1; attempt <= 90; attempt += 1) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const details = JSON.stringify(payload?.errors || payload?.result?.error || payload || {}).slice(0, 1000);
    throw new Error(`D1 control-plane export failed HTTP ${response.status}: ${details}`);
  }
  const result = payload?.result || {};
  const nested = result?.result || {};
  const status = String(result?.status || "").toLowerCase();
  signedUrl = String(nested?.signed_url || "").trim();
  if (status === "complete" && signedUrl) break;
  if (status === "error" || result?.success === false) {
    throw new Error(`D1 control-plane export reported error: ${JSON.stringify(result).slice(0, 1000)}`);
  }
  body = { output_format: "polling", current_bookmark: result?.at_bookmark || undefined };
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!signedUrl) throw new Error("D1 control-plane export did not complete in time");
const download = await fetch(signedUrl);
if (!download.ok) throw new Error(`D1 signed export download failed HTTP ${download.status}`);
const bytes = new Uint8Array(await download.arrayBuffer());
if (!bytes.byteLength) throw new Error("D1 export file is empty");
await writeFile(output, bytes);
console.log(`D1_CONTROL_PLANE_EXPORT=PASS`);
console.log(`D1_EXPORT_BYTES=${bytes.byteLength}`);
console.log(`D1_SQL_QUERY_CALLS=0`);
