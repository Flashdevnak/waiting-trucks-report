const SHADOW_VERSION = 1;
const SHADOW_PENDING_MS = 12 * 60 * 60 * 1000;
const SHADOW_RETAIN_MS = 3 * 24 * 60 * 60 * 1000;
const SHADOW_TTL_SECONDS = 7 * 24 * 60 * 60;

function normalizeProof(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function validTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
}

function iso(value) {
  const time = validTime(value);
  return time === null ? "" : new Date(time).toISOString();
}

async function shadowId(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value || "")),
  );
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

function freshState(hub, nowIso) {
  return {
    version: SHADOW_VERSION,
    hub,
    startedAt: nowIso,
    updatedAt: nowIso,
    records: {},
  };
}

function parseState(raw, hub, nowIso) {
  try {
    const parsed = JSON.parse(raw || "null");
    if (
      parsed?.version === SHADOW_VERSION &&
      parsed?.hub === hub &&
      parsed?.records &&
      typeof parsed.records === "object"
    )
      return parsed;
  } catch {}
  return freshState(hub, nowIso);
}

function summary(state) {
  const records = Object.values(state?.records || {});
  const confirmed = records.filter((item) => item.status === "confirmed");
  const leads = confirmed
    .map((item) => Number(item.leadMinutes))
    .filter(Number.isFinite);
  return {
    total: records.length,
    pending: records.filter((item) => item.status === "pending").length,
    confirmed: confirmed.length,
    expired: records.filter((item) => item.status === "expired").length,
    averageLeadMinutes: leads.length
      ? Math.round(leads.reduce((sum, value) => sum + value, 0) / leads.length)
      : null,
    maxLeadMinutes: leads.length ? Math.max(...leads) : null,
  };
}

export async function observeTbrShadow(env, hubValue, live, nowValue = Date.now()) {
  const hub = String(hubValue || "").trim().toUpperCase();
  if (!hub || !env?.STATE) return { changed: false, skipped: "missing_state" };
  if (!Array.isArray(live?.tbrShadowFeed) || !Array.isArray(live?.rows))
    return { changed: false, skipped: "source_unavailable" };

  const now = Number(nowValue) || Date.now();
  const nowIso = new Date(now).toISOString();
  const key = `shadow:tbr:v1:${hub}`;
  const state = parseState(await env.STATE.get(key), hub, nowIso);
  const routeByProof = new Map();
  for (const route of live.rows) {
    const proof = normalizeProof(route?.proofId);
    if (proof && !routeByProof.has(proof)) routeByProof.set(proof, route);
  }

  let changed = false;
  for (const item of live.tbrShadowFeed) {
    const proof = normalizeProof(item?.proofId);
    const tbrMs = validTime(item?.scheduleTbrArrivalAt);
    if (!proof || tbrMs === null || tbrMs > now + 5 * 60 * 1000) continue;

    const id = await shadowId(proof);
    const route = routeByProof.get(proof);
    let record = state.records[id];

    if (!record) {
      if (route || now - tbrMs > SHADOW_PENDING_MS) continue;
      record = {
        status: "pending",
        tbrAt: new Date(tbrMs).toISOString(),
        kitAt: iso(item?.scheduleKitArrivalAt),
        firstSeenAt: nowIso,
        confirmedAt: "",
        routeActualArrivalAt: "",
        leadMinutes: null,
      };
      state.records[id] = record;
      changed = true;
      continue;
    }

    if (record.status !== "pending") continue;
    const nextKit = iso(item?.scheduleKitArrivalAt);
    if (nextKit && nextKit !== record.kitAt) {
      record.kitAt = nextKit;
      changed = true;
    }
    if (route) {
      const actualMs = validTime(route?.actualArrivalAt);
      const routeMs = actualMs === null ? now : actualMs;
      record.status = "confirmed";
      record.confirmedAt = nowIso;
      record.routeActualArrivalAt =
        actualMs === null ? "" : new Date(actualMs).toISOString();
      record.leadMinutes = Math.round((routeMs - tbrMs) / 60000);
      changed = true;
    }
  }

  for (const [id, record] of Object.entries(state.records)) {
    const tbrMs = validTime(record?.tbrAt);
    if (
      record?.status === "pending" &&
      tbrMs !== null &&
      now - tbrMs > SHADOW_PENDING_MS
    ) {
      record.status = "expired";
      record.expiredAt = nowIso;
      changed = true;
    }
    const terminalAt = validTime(record?.confirmedAt || record?.expiredAt);
    if (terminalAt !== null && now - terminalAt > SHADOW_RETAIN_MS) {
      delete state.records[id];
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = nowIso;
    await env.STATE.put(key, JSON.stringify(state), {
      expirationTtl: SHADOW_TTL_SECONDS,
    });
    const result = summary(state);
    console.log(JSON.stringify({ event: "tbr_shadow_changed", hub, ...result }));
    return { changed: true, key, ...result };
  }

  return { changed: false, key, ...summary(state) };
}

export { summary as summarizeTbrShadow };
