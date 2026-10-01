const MARKER = "MS_CENTRAL_NEAR_EXPIRY_V1";

function once(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0)
    throw new Error(`${MARKER}: staging anchor absent or repeated`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export function patchMsCentralNearExpiry(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  output = once(output,
    'function unloadStandard(row) {\n  const value = Number(state.standards[normalizeVehicle(row.vehicleType)]);\n  return Number.isFinite(value) && value > 0 ? value : null;\n}',
    `// ${MARKER}: warning and over-standard truth use CENTRAL, never HUB settings.
const CENTRAL_NEAR_EXPIRY_MINUTES = Object.freeze({
  "4W": 20, "4WJ": 30, "6W": 60, "10W": 60,
  "14W": 120, "18W": 180, "22W": 180,
});

function centralVehicleStandard(vehicleType) {
  const type = normalizeVehicle(vehicleType);
  return Object.prototype.hasOwnProperty.call(CENTRAL_NEAR_EXPIRY_MINUTES, type)
    ? CENTRAL_NEAR_EXPIRY_MINUTES[type] : null;
}

function centralNearExpiryBand(vehicleType) {
  const standardMinutes = centralVehicleStandard(vehicleType);
  return standardMinutes === null ? null : {
    standardMinutes,
    warningBandMinutes: Math.max(1, Math.ceil(standardMinutes * 0.2)),
  };
}

function centralReleaseSeverity(row, countdown, normal) {
  if (!countdown) return "neutral";
  if (countdown.key === "late") return "danger";
  if (countdown.key === "ontime") return "safe";
  if (countdown.key !== "pending") return "neutral";
  const band = centralNearExpiryBand(row.vehicleType);
  if (!band) return "neutral";
  return countdown.minutes <= band.warningBandMinutes ? "warning" : normal;
}

function unloadStandard(row) {
  return centralVehicleStandard(row.vehicleType);
}`);
  output = once(output,
    'const releaseSeverity = release?.key === "late" ? "danger" : release?.key === "ontime" && drop.onwardDone ? "safe" : "drop";',
    'const releaseSeverity = release?.key === "ontime" && !drop.onwardDone ? "drop" : centralReleaseSeverity(row, release, "drop");');
  output = once(output,
    'const releaseSeverity = countdown?.key === "late" ? "danger" : countdown ? "safe" : "neutral";',
    'const releaseSeverity = centralReleaseSeverity(row, countdown, "safe");');
  return output;
}
