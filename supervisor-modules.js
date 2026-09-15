// SUPERVISOR_MODULE_REGISTRY_V1
// Pure internal adapters only. This file performs no I/O, polling, persistence, or repair.
export const MODULE_HEALTH_STATES = Object.freeze([
  "HEALTHY",
  "WARNING",
  "CRITICAL",
  "STALE",
  "PARTIAL",
  "AUTH_REQUIRED",
  "ERROR",
  "BLOCKED",
  "UNKNOWN",
  "RECOVERED",
]);

const OPTIONAL_CAPABILITIES = Object.freeze([
  "quota",
  "repair",
  "guide",
  "audit",
  "actions",
  "diagnostics",
  "dependencies",
]);

function normalizeHealth(value) {
  const input = value && typeof value === "object" ? value : {};
  const state = MODULE_HEALTH_STATES.includes(input.state) ? input.state : "UNKNOWN";
  return Object.freeze({
    state,
    observedAt: typeof input.observedAt === "string" && input.observedAt ? input.observedAt : null,
    evidence: Array.isArray(input.evidence) ? Object.freeze(input.evidence.slice()) : Object.freeze([]),
    impact: typeof input.impact === "string" ? input.impact : "",
  });
}

function normalizeList(value) {
  return Object.freeze(Array.isArray(value) ? value.slice() : []);
}

export function defineSupervisorModule(definition) {
  if (!definition || !/^[a-z][a-z0-9-]{1,63}$/.test(String(definition.id || "")))
    throw new TypeError("Supervisor module id is invalid");
  if (!String(definition.name || "").trim()) throw new TypeError("Supervisor module name is required");
  for (const adapter of ["health", "metrics", "incidents"])
    if (typeof definition[adapter] !== "function") throw new TypeError(`Supervisor module ${adapter} adapter is required`);

  const capabilities = {};
  for (const name of OPTIONAL_CAPABILITIES) {
    const enabled = definition.capabilities?.[name] === true;
    if (enabled && typeof definition[name] !== "function")
      throw new TypeError(`Supervisor module ${name} capability requires an adapter`);
    capabilities[name] = enabled;
  }

  return Object.freeze({
    id: definition.id,
    name: String(definition.name).trim(),
    health: definition.health,
    metrics: definition.metrics,
    incidents: definition.incidents,
    capabilities: Object.freeze(capabilities),
    ...Object.fromEntries(OPTIONAL_CAPABILITIES.filter((name) => capabilities[name]).map((name) => [name, definition[name]])),
  });
}

function evaluateModule(module, context) {
  try {
    const result = {
      id: module.id,
      name: module.name,
      health: normalizeHealth(module.health(context)),
      metrics: normalizeList(module.metrics(context)),
      incidents: normalizeList(module.incidents(context)),
      capabilities: module.capabilities,
    };
    for (const name of OPTIONAL_CAPABILITIES)
      if (module.capabilities[name]) result[name] = module[name](context);
    return Object.freeze(result);
  } catch {
    return Object.freeze({
      id: module.id,
      name: module.name,
      health: normalizeHealth({ state: "ERROR", evidence: ["MODULE_ADAPTER_ERROR"] }),
      metrics: Object.freeze([]),
      incidents: Object.freeze([]),
      capabilities: module.capabilities,
    });
  }
}

export function createSupervisorRegistry(initialModules = []) {
  const modules = new Map();
  const register = (module) => {
    if (!module?.id || modules.has(module.id)) throw new TypeError("Supervisor module id must be unique");
    modules.set(module.id, module);
    return module;
  };
  initialModules.forEach(register);
  return Object.freeze({
    register,
    list: () => Object.freeze([...modules.values()]),
    evaluate: (context = {}) => Object.freeze([...modules.values()].map((module) => evaluateModule(module, context))),
  });
}

export const waitingTrucksModule = defineSupervisorModule({
  id: "waiting-trucks",
  name: "Waiting Trucks",
  health: (context) => context?.waitingTrucks?.health || { state: "UNKNOWN" },
  metrics: (context) => context?.waitingTrucks?.metrics || [],
  incidents: (context) => context?.waitingTrucks?.incidents || [],
  capabilities: {},
});
