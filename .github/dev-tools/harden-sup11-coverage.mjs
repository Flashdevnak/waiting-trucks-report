import { readFile, writeFile } from "node:fs/promises";

const path = "supervisor.js";
const source = await readFile(path, "utf8");
const from = `    const coverageMismatch = declaredQuotaHubs === null || declaredQuotaHubs !== hubs.length || (observedHubs !== null && observedHubs < hubs.length);`;
const to = `    const coverageMismatch = observedHubs === null || declaredQuotaHubs === null || declaredQuotaHubs !== hubs.length || observedHubs < hubs.length;`;
if (!source.includes(from)) {
  if (!source.includes(to)) throw new Error("SUP-11 coverage hardening anchor missing");
  console.log("SUP11_COVERAGE_ALREADY_HARDENED=true");
} else {
  await writeFile(path, source.replace(from, to), "utf8");
  console.log("SUP11_COVERAGE_HARDENED=PASS");
}
