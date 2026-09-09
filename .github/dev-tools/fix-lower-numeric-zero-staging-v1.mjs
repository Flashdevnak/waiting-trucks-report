import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const target = new URL(".github/dev-tools/patch-ms-completed-view-stability.mjs", root);
let source = await readFile(target, "utf8");

if (!source.includes("MS_LOWER_NUMERIC_ZERO_V1")) {
  const from = `  output = replaceUnique(
    output,
    \`    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\\n  }\\n  const completedDisplay =\`,
    \`    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\\n  }\\n  counts.cancelled = Math.max(\\n    counts.cancelled,\\n    Number(state.cancelledToday) || 0,\\n  );\\n  const cancelledDisplay =\\n    cancelledTodayHydratedKey === completedTodayDatasetKey()\\n      ? nf.format(counts.cancelled)\\n      : \\\"…\\\";\\n  const completedDisplay =\`,
    "use authoritative cancelled count without transient zero",
  );`;

  const to = `  output = replaceUnique(
    output,
    \`    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\\n  }\`,
    \`    if (queue.cancelled && isCancelledToday(row)) counts.cancelled++;\\n  }\\n  counts.cancelled = Math.max(\\n    counts.cancelled,\\n    Number(state.cancelledToday) || 0,\\n  );\\n  // MS_LOWER_NUMERIC_ZERO_V1: a real zero is always rendered as 0, never ellipsis.\\n  const cancelledDisplay = nf.format(counts.cancelled);\`,
    "use authoritative cancelled count with numeric zero",
  );`;

  const first = source.indexOf(from);
  if (first < 0 || first !== source.lastIndexOf(from))
    throw new Error("staging numeric-zero compatibility target not unique");
  source = source.replace(from, to);
}

await writeFile(target, source);
console.log("MS_LOWER_NUMERIC_ZERO_STAGING_V1=PATCHED");
