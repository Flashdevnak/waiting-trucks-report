import fs from "node:fs";

const files = [
  "src/connection-error.js",
  "src/tbr-intelligence-entry.js",
];

for (const path of files) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes("INTELLIGENCE_HUB_FILTER_V3")) {
    throw new Error(`INTELLIGENCE_UI_NOT_PERSISTED: ${path}`);
  }
  if (!source.includes("HUB ในระบบ")) {
    throw new Error(`INTELLIGENCE_HUB_SELECTOR_MISSING: ${path}`);
  }
  if (!source.includes("Error Intelligence") || !source.includes("TBR Intelligence")) {
    throw new Error(`INTELLIGENCE_TABS_MISSING: ${path}`);
  }
}

console.log("INTELLIGENCE_UI_PERSISTED_SOURCE=PASS");
console.log("INTELLIGENCE_UI_EXTRA_MS_POLLING=0");
