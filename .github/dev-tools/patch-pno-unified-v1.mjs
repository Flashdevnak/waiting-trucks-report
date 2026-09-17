import { gunzipSync } from "node:zlib";

const PATCH_MARKER = "PNO_UNIFIED_STAGE_PATCH_V1";

export function applyExactUnifiedDiff(source, encodedDiff, label = "PNO") {
  const diff = gunzipSync(Buffer.from(String(encodedDiff || ""), "base64")).toString("utf8");
  const lines = String(source || "").split("\n");
  const diffLines = diff.split("\n");
  let i = 0;
  while (i < diffLines.length) {
    const header = diffLines[i];
    if (!header.startsWith("@@ ")) { i += 1; continue; }
    i += 1;
    const oldLines = [];
    const newLines = [];
    while (i < diffLines.length && !diffLines[i].startsWith("@@ ")) {
      const line = diffLines[i];
      if (line.startsWith("--- ") || line.startsWith("+++ ")) { i += 1; continue; }
      if (line.startsWith("\\ No newline")) { i += 1; continue; }
      const prefix = line[0];
      const body = line.slice(1);
      if (prefix === " " || prefix === "-") oldLines.push(body);
      if (prefix === " " || prefix === "+") newLines.push(body);
      i += 1;
    }
    let found = -1;
    outer: for (let at = 0; at <= lines.length - oldLines.length; at += 1) {
      for (let j = 0; j < oldLines.length; j += 1)
        if (lines[at + j] !== oldLines[j]) continue outer;
      if (found !== -1)
        throw new Error(`${PATCH_MARKER}:${label}: hunk anchor is not unique`);
      found = at;
    }
    if (found < 0)
      throw new Error(`${PATCH_MARKER}:${label}: hunk anchor missing`);
    lines.splice(found, oldLines.length, ...newLines);
  }
  return lines.join("\n");
}
