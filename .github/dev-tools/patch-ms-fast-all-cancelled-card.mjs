function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`Fast all/cancelled summary patch failed: ${label}`);
  return output.replace(from, to);
}

function replaceCount(output, from, to, expected, label) {
  const parts = output.split(from);
  const count = parts.length - 1;
  if (count !== expected)
    throw new Error(
      `Fast all/cancelled summary patch failed: ${label} (expected ${expected}, got ${count})`,
    );
  return parts.join(to);
}

const MARKER = "archiveView: false";

export function patchMsFastAllCancelledFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER) && output.includes('data-summary-status="cancelled"'))
    return output;

  output = replaceUnique(
    output,
    `  archiveLoaded: false,\n  cancelledRouteIds: new Set(),`,
    `  archiveLoaded: false,\n  archiveView: false,\n  cancelledRouteIds: new Set(),`,
    "archive view state",
  );

  output = replaceUnique(
    output,
    `    state.queue = event.target.value;\n    state.summary = "all";\n    if (state.queue === "all" || state.queue === "completed") await ensureArchiveLoaded(true);\n    render();`,
    `    state.queue = event.target.value;\n    state.summary = "all";\n    state.archiveView = state.queue === "completed";\n    if (state.archiveView) await ensureArchiveLoaded(true);\n    render();`,
    "รายการทั้งหมด must stay on live rows",
  );

  output = replaceUnique(
    output,
    `  state.archiveLoaded = false;\n  state.cancelledRouteIds.clear();`,
    `  state.archiveLoaded = false;\n  state.archiveView = false;\n  state.cancelledRouteIds.clear();`,
    "reset archive view",
  );

  output = replaceUnique(
    output,
    `    state.queue = "all";\n    el("queue-filter").value = "all";\n    state.archiveLoaded = false;`,
    `    state.queue = "all";\n    el("queue-filter").value = "all";\n    state.archiveView = true;\n    state.archiveLoaded = false;`,
    "explicit range keeps archive view",
  );

  output = replaceUnique(
    output,
    `function filteredRows(ignoreSummary = false, queueMode = state.queue) {\n  const source =\n    queueMode === "queue" ? state.currentRows : state.archiveRows;`,
    `function filteredRows(ignoreSummary = false, queueMode = state.queue) {\n  const useArchive =\n    queueMode === "completed" ||\n    (queueMode === "all" && state.archiveView);\n  const source = useArchive ? state.archiveRows : state.currentRows;`,
    "live all source",
  );

  output = replaceUnique(
    output,
    `        (state.summary === "drop" && isDrop(row) && !queue.done && !queue.cancelled);`,
    `        (state.summary === "drop" && isDrop(row) && !queue.done && !queue.cancelled) ||\n        (state.summary === "cancelled" && queue.cancelled);`,
    "cancelled summary filter",
  );

  output = replaceUnique(
    output,
    `  const summaryRows = filteredRows(\n    true,\n    state.summary === "completed" ? "queue" : state.queue,\n  );`,
    `  const summaryRows = filteredRows(\n    true,\n    state.summary === "completed" || state.summary === "cancelled"\n      ? "queue"\n      : state.queue,\n  );`,
    "cancelled view keeps active summary counts",
  );

  output = replaceUnique(
    output,
    `  const counts = {\n    waiting: 0,\n    unloading: 0,\n    completed: Number(state.completedToday) || 0,\n    origin: 0,\n    drop: 0,\n  };`,
    `  const counts = {\n    waiting: 0,\n    unloading: 0,\n    completed: Number(state.completedToday) || 0,\n    origin: 0,\n    drop: 0,\n    cancelled: 0,\n  };`,
    "cancelled summary count state",
  );

  output = replaceUnique(
    output,
    `    if (isOrigin(row) && !queue.done) counts.origin++;\n    if (isDrop(row) && !queue.done) counts.drop++;\n  }\n  el("filter-summary").innerHTML = \``,
    `    if (isOrigin(row) && !queue.done && !queue.cancelled) counts.origin++;\n    if (isDrop(row) && !queue.done && !queue.cancelled) counts.drop++;\n  }\n  counts.cancelled = state.currentRows.filter((row) => queueInfo(row).cancelled).length;\n  el("filter-summary").innerHTML = \``,
    "cancelled summary count",
  );

  output = replaceUnique(
    output,
    `    <button type="button" class="summary-drop \${state.summary === "drop" ? "is-active" : ""}" data-summary-status="drop"><span>จุดดรอป</span><strong>\${nf.format(counts.drop)}</strong></button>\`;`,
    `    <button type="button" class="summary-drop \${state.summary === "drop" ? "is-active" : ""}" data-summary-status="drop"><span>จุดดรอป</span><strong>\${nf.format(counts.drop)}</strong></button>\n    <button type="button" class="summary-cancelled \${state.summary === "cancelled" ? "is-active" : ""}" data-summary-status="cancelled"><span>ยกเลิกรถแล้ว</span><strong>\${nf.format(counts.cancelled)}</strong></button>\`;`,
    "cancelled summary card",
  );

  output = replaceUnique(
    output,
    `            state.queue = "all";\n            el("queue-filter").value = "all";\n          } catch (error) {`,
    `            state.archiveView = true;\n            state.queue = "all";\n            el("queue-filter").value = "all";\n          } catch (error) {`,
    "completed daily view uses archive rows",
  );

  output = replaceUnique(
    output,
    `        } else {\n          state.queue = "queue";\n          el("queue-filter").value = "queue";\n        }\n        state.summary = value;`,
    `        } else if (value === "cancelled") {\n          state.archiveView = false;\n          state.queue = "all";\n          el("queue-filter").value = "all";\n        } else {\n          state.archiveView = false;\n          state.queue = "queue";\n          el("queue-filter").value = "queue";\n        }\n        state.summary = value;`,
    "cancelled summary click",
  );

  output = replaceUnique(
    output,
    `  if (["all", "completed", "arrival-ontime", "arrival-late", "departure-ontime", "departure-late"].includes(metric))\n    await ensureArchiveLoaded(true);`,
    `  if (["completed", "arrival-ontime", "arrival-late", "departure-ontime", "departure-late"].includes(metric))\n    await ensureArchiveLoaded(true);`,
    "top all metric avoids archive",
  );

  output = replaceUnique(
    output,
    `  state.attendance = "all";\n  if (metric === "all") state.queue = "all";`,
    `  state.attendance = "all";\n  state.archiveView = [\n    "completed",\n    "arrival-ontime",\n    "arrival-late",\n    "departure-ontime",\n    "departure-late",\n  ].includes(metric);\n  if (metric === "all") state.queue = "all";`,
    "metric archive view",
  );

  output = replaceUnique(
    output,
    `  el("table-body").innerHTML = rows.map(tableRow).join("");\n  el("mobile-cards").innerHTML = rows.map(card).join("");`,
    `  const mobileLayout = window.matchMedia("(max-width: 700px)").matches;\n  if (mobileLayout) {\n    el("table-body").innerHTML = "";\n    el("mobile-cards").innerHTML = rows.map(card).join("");\n  } else {\n    el("table-body").innerHTML = rows.map(tableRow).join("");\n    el("mobile-cards").innerHTML = "";\n  }`,
    "render only visible layout",
  );

  output = replaceCount(
    output,
    `  const workStatus = q.cancelled\n    ? "ยกเลิกเส้นทาง"`,
    `  const workStatus = q.cancelled\n    ? "ยกเลิกรถแล้ว"`,
    2,
    "cancelled desktop/mobile wording",
  );

  output = replaceUnique(
    output,
    `    queueStatus: q.cancelled\n      ? "ยกเลิกเส้นทาง"`,
    `    queueStatus: q.cancelled\n      ? "ยกเลิกรถแล้ว"`,
    "cancelled export wording",
  );

  return output;
}
