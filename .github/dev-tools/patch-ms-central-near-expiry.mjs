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

function unloadStandard(row) {
  return centralVehicleStandard(row.vehicleType);
}`);
  return output;
}
