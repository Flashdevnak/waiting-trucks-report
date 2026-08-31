const OLD_API = process.env.OLD_API_URL;
const NEW_API = process.env.NEW_API_URL;
const TOKEN = process.env.API_TOKEN;
const HUB = process.env.TEST_HUB || "NE1";
const DAY = process.env.TEST_DAY || new Date().toISOString().slice(0, 10);

if (!OLD_API || !NEW_API || !TOKEN) {
  console.error("Required: OLD_API_URL, NEW_API_URL and API_TOKEN");
  process.exit(2);
}

const cases = [
  ["list", {}],
  ["history", {}],
  ["settings", { branch: HUB }],
  ["msRoutes", { branch: HUB }],
  ["msHistory", { branch: HUB }],
  ["msArchive", { branch: HUB }],
  ["msRange", { branch: HUB, start: DAY, end: DAY }],
  ["preEntryTrips", { branch: HUB, day: DAY }],
  ["msConnectionStatus", { branch: HUB }],
  ["msPairingStatus", { hub: HUB, pairingId: "parity-read-only" }],
];

function shape(value) {
  if (Array.isArray(value)) return { type: "array", count: value.length, item: value.length ? shape(value[0]) : null };
  if (value === null) return { type: "null" };
  if (typeof value !== "object") return { type: typeof value };
  return {
    type: "object",
    fields: Object.keys(value).sort().map((key) => [key, shape(value[key])]),
  };
}

async function call(base, action, params) {
  const url = new URL(base);
  url.searchParams.set("action", action);
  url.searchParams.set("token", TOKEN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { parseError: true, text }; }
  return { status: response.status, body };
}

let failed = 0;
for (const [action, params] of cases) {
  const [oldResult, newResult] = await Promise.all([
    call(OLD_API, action, params),
    call(NEW_API, action, params),
  ]);
  const checks = {
    status: oldResult.status === newResult.status,
    ok: oldResult.body?.ok === newResult.body?.ok,
    shape: JSON.stringify(shape(oldResult.body)) === JSON.stringify(shape(newResult.body)),
  };
  const pass = Object.values(checks).every(Boolean);
  if (!pass) failed += 1;
  console.log(JSON.stringify({ action, pass, checks, oldStatus: oldResult.status, newStatus: newResult.status }));
}

process.exitCode = failed ? 1 : 0;
