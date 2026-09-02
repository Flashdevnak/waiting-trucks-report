import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function patchDevMsArchive(source) {
  let output = String(source || "");
  const replacements = [
    {
      name: "disable automatic archive load",
      from: "    if (!silent && !state.archiveLoaded) scheduleArchiveLoad();",
      to: "    // DEV: archive stays lazy; live polling must never auto-read msArchive.",
    },
    {
      name: "load archive for completed/all views",
      from: "    if (state.queue === \"all\") await ensureArchiveLoaded(true);",
      to: "    if (state.queue === \"all\" || state.queue === \"completed\") await ensureArchiveLoaded(true);",
    },
    {
      name: "load archive after explicit range search",
      from: "    await loadData(false);\n    toast(`ดึงข้อมูลย้อนหลัง ${nf.format(result.total)} รายการแล้ว`);",
      to: "    await loadData(false);\n    if (!(await ensureArchiveLoaded(true)))\n      throw new Error(\"โหลดรายการย้อนหลังไม่สำเร็จ\");\n    toast(`ดึงข้อมูลย้อนหลัง ${nf.format(result.total)} รายการแล้ว`);",
    },
    {
      name: "keep archive metric unloaded until requested",
      from: "  setMetric(\"metric-archive\", state.archiveTotal ?? state.archiveRows.length);",
      to: "  if (state.archiveLoaded)\n    setMetric(\"metric-archive\", state.archiveTotal ?? state.archiveRows.length);\n  else\n    el(\"metric-archive\").textContent = \"กดดู\";",
    },
    {
      name: "keep upper completed metric cumulative",
      from: "  setMetric(\n    \"metric-completed\",\n    state.archiveRows.filter((row) => isCompletedToday(row)).length,\n  );",
      to: "  setMetric(\n    \"metric-completed\",\n    state.archiveRows.filter(\n      (row) =>\n        (isDestination(row) || isDrop(row)) &&\n        Number(row.unloadingState) === 2,\n    ).length,\n  );",
    },
  ];

  for (const replacement of replacements) {
    const first = output.indexOf(replacement.from);
    const last = output.lastIndexOf(replacement.from);
    if (first < 0 || first !== last)
      throw new Error(`DEV archive patch failed: ${replacement.name}`);
    output = output.replace(replacement.from, replacement.to);
  }

  return output;
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  const target = process.argv[2] || ".dev-assets/ms.js";
  const source = await readFile(target, "utf8");
  const patched = patchDevMsArchive(source);
  await writeFile(target, patched, "utf8");
  console.log(`Patched DEV archive loading: ${target}`);
}
