import fs from "node:fs";

const MARKER = "TBR_INTELLIGENCE_V1";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`TBR Intelligence patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchTbrIntelligenceV1(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;

  output = replaceUnique(
    output,
`import {
  observeTbrShadow,
  readTbrShadowReport,
  tbrShadowPage,
} from "./tbr-shadow.js";`,
`import {
  observeTbrShadow,
  readTbrShadowReport,
  tbrShadowPage,
} from "./tbr-shadow.js";
// ${MARKER}: Browser-KV-only rolling intelligence; no extra MS polling and no Turso writes.
import {
  readTbrIntelligenceReport,
  recordTbrRepairEvent,
  shouldAttemptTbrAutoRepair,
  shouldUpdateTbrIntelligence,
  tbrIntelligencePage,
  updateTbrIntelligence,
} from "./tbr-intelligence.js";`,
    "import intelligence module",
  );

  output = replaceUnique(
    output,
`    // TBR_SHADOW_REPORT_V1: KV-only readout for the hidden TBR shadow test.
    if (url.pathname === "/shadow-tbr")
      return tbrShadowPage(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );
    if (url.pathname === "/api/shadow-tbr")
      return reply(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );`,
`    // TBR_SHADOW_REPORT_V1: upgraded in-place to TBR Intelligence while keeping the read-only Shadow API.
    if (url.pathname === "/shadow-tbr") {
      const hub = url.searchParams.get("hub") || "NE1";
      const shadow = await readTbrShadowReport(env, hub);
      const intelligence = await readTbrIntelligenceReport(env, hub, shadow);
      return tbrIntelligencePage(shadow, intelligence);
    }
    if (url.pathname === "/api/shadow-tbr")
      return reply(
        await readTbrShadowReport(env, url.searchParams.get("hub") || "NE1"),
      );
    if (url.pathname === "/api/tbr-intelligence") {
      const hub = url.searchParams.get("hub") || "NE1";
      const shadow = await readTbrShadowReport(env, hub);
      return reply(await readTbrIntelligenceReport(env, hub, shadow));
    }`,
    "upgrade shadow routes",
  );

  output = replaceUnique(
    output,
`        if (!connectorToken && env.CONNECTOR_BOOTSTRAP_SECRET) {
          const candidate = randomConnectorToken();
          if (await registerConnectorForCutover(env, hub, candidate)) {
            connectorToken = candidate;
            await rememberConnector(env, hub, connectorToken);
          }
        }`,
`        if (!connectorToken && env.CONNECTOR_BOOTSTRAP_SECRET && shouldAttemptTbrAutoRepair()) {
          const candidate = randomConnectorToken();
          if (await registerConnectorForCutover(env, hub, candidate)) {
            connectorToken = candidate;
            await rememberConnector(env, hub, connectorToken);
            await recordTbrRepairEvent(env, hub, "connector_bootstrap");
          }
        }`,
    "throttle connector bootstrap self-repair",
  );

  output = replaceUnique(
    output,
`        if (
          response.status === 401 &&
          env.CONNECTOR_BOOTSTRAP_SECRET &&
          payload?.code === "INVALID_CONNECTOR"
        ) {
          if (await registerConnectorForCutover(env, hub, connectorToken)) {
            response = await sendConnectorSync(env, hub, connectorToken);
            payload = await response.clone().json().catch(() => ({}));
          }
        }`,
`        if (
          response.status === 401 &&
          env.CONNECTOR_BOOTSTRAP_SECRET &&
          payload?.code === "INVALID_CONNECTOR" &&
          shouldAttemptTbrAutoRepair()
        ) {
          if (await registerConnectorForCutover(env, hub, connectorToken)) {
            await recordTbrRepairEvent(env, hub, "connector_reregister");
            response = await sendConnectorSync(env, hub, connectorToken);
            payload = await response.clone().json().catch(() => ({}));
          }
        }`,
    "throttle invalid connector self-repair",
  );

  output = replaceUnique(
    output,
`            if (failedShadow?.sourceChanged) {
              const failureCode = String(payload?.code || \`HTTP_\${response.status}\`);
              const failureSource = failureCode.includes("BUS") ? "busTime" : "routes";
              await recordConnectionErrorKv(env, {
                hub, source: failureSource, code: failureCode,
                message: payload?.message || \`DEV Shadow ตอบกลับ HTTP \${response.status}\`,
              });
            }`,
`            if (failedShadow?.sourceChanged) {
              const failureCode = String(payload?.code || \`HTTP_\${response.status}\`);
              const failureSource = failureCode.includes("BUS") ? "busTime" : "routes";
              await recordConnectionErrorKv(env, {
                hub, source: failureSource, code: failureCode,
                message: payload?.message || \`DEV Shadow ตอบกลับ HTTP \${response.status}\`,
              });
            }
            if (shouldUpdateTbrIntelligence(failedShadow)) {
              const shadowReport = await readTbrShadowReport(env, hub);
              await updateTbrIntelligence(env, hub, shadowReport, failedShadow, {}, {
                sourceError: {
                  code: String(payload?.code || \`HTTP_\${response.status}\`),
                  message: String(payload?.message || "source unavailable"),
                },
              });
            }`,
    "record source failure intelligence",
  );

  output = replaceUnique(
    output,
`            } else if (observedShadow?.sourceChanged || observedShadow?.routeFallbackChanged) {
              await recordConnectionRecoveredKv(env, { hub });
            }`,
`            } else if (observedShadow?.sourceChanged || observedShadow?.routeFallbackChanged) {
              await recordConnectionRecoveredKv(env, { hub });
            }
            if (shouldUpdateTbrIntelligence(observedShadow)) {
              const shadowReport = await readTbrShadowReport(env, hub);
              await updateTbrIntelligence(env, hub, shadowReport, observedShadow, payload?.data || {});
            }`,
    "record live intelligence checkpoint",
  );

  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || "src/index.js";
  const source = fs.readFileSync(target, "utf8");
  const patched = patchTbrIntelligenceV1(source);
  fs.writeFileSync(target, patched);
  console.log(`TBR_INTELLIGENCE_V1_PATCHED=${patched.includes(MARKER)}`);
}
