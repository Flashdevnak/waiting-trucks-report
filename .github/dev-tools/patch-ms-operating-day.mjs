function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS operating-day patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = 'state.summary === "completed-all"';
const HTML_MARKER = "ปลายทางและจุดดรอปที่ลงของเสร็จสะสม";
const WORKER_MARKER = "start + 3 * 86400000 - 1000";

export function patchMsOperatingDayFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  output = replaceUnique(
    output,
    `function departureCountdown(row, now = new Date()) {`,
    `function isCompletedAccumulated(row) {\n  return (\n    !row.queueCancelledAt &&\n    (isDestination(row) || isDrop(row)) &&\n    Number(row.unloadingState) === 2\n  );\n}\n\nfunction isCancelledToday(row, now = new Date()) {\n  return (\n    Boolean(row.queueCancelledAt) &&\n    bangkokDateValue(row.queueCancelledAt) === bangkokDateValue(now)\n  );\n}\n\nfunction departureCountdown(row, now = new Date()) {`,
    "cumulative completed and daily cancelled helpers",
  );

  output = replaceUnique(
    output,
    `        (state.summary === "completed" && isCompletedToday(row)) ||`,
    `        (state.summary === "completed" && isCompletedToday(row)) ||\n        (state.summary === "completed-all" && isCompletedAccumulated(row)) ||`,
    "separate cumulative completed filter",
  );

  output = replaceUnique(
    output,
    `(state.summary === "cancelled" && queue.cancelled);`,
    `(state.summary === "cancelled" && queue.cancelled && isCancelledToday(row));`,
    "cancelled card filters only today's cancellations",
  );

  output = replaceUnique(
    output,
    `    state.summary === "completed" || state.summary === "cancelled"\n      ? "queue"`,
    `    state.summary === "completed" ||\n    state.summary === "completed-all" ||\n    state.summary === "cancelled"\n      ? "queue"`,
    "completed archive view keeps lower cards on current queue",
  );

  output = replaceUnique(
    output,
    `  counts.cancelled = state.currentRows.filter((row) => queueInfo(row).cancelled).length;`,
    `  counts.cancelled = state.currentRows.filter(\n    (row) => queueInfo(row).cancelled && isCancelledToday(row),\n  ).length;`,
    "daily cancelled summary count",
  );

  output = replaceUnique(
    output,
    `  if (["completed", "arrival-ontime", "arrival-late", "departure-ontime", "departure-late"].includes(metric))\n    await ensureArchiveLoaded(true);`,
    `  if (["all", "completed", "arrival-ontime", "arrival-late", "departure-ontime", "departure-late"].includes(metric))\n    await ensureArchiveLoaded(true);`,
    "upper accumulated cards load archive",
  );

  output = replaceUnique(
    output,
    `  state.archiveView = [\n    "completed",`,
    `  state.archiveView = [\n    "all",\n    "completed",`,
    "upper accumulated all card uses archive view",
  );

  output = replaceUnique(
    output,
    `  if (metric === "completed") {\n    state.queue = "all";\n    state.summary = "completed";\n  }`,
    `  if (metric === "completed") {\n    state.queue = "all";\n    state.summary = "completed-all";\n  }`,
    "top completed card opens cumulative completed rows",
  );

  output = replaceUnique(
    output,
    `    state.archiveRows.filter((row) => isCompletedToday(row)).length,`,
    `    state.archiveRows.filter((row) => isCompletedAccumulated(row)).length,`,
    "top completed metric is cumulative",
  );

  return output;
}

export function patchMsOperatingDayHtml(source) {
  const output = String(source || "");
  if (output.includes(HTML_MARKER)) return output;
  return replaceUnique(
    output,
    `<small>ปลายทางและจุดดรอปที่ลงของเสร็จวันนี้</small>`,
    `<small>${HTML_MARKER}</small>`,
    "upper completed card description",
  );
}

export function patchMsOperatingDayWorker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;

  return replaceUnique(
    output,
    `  const end = Number.isFinite(wantedEnd) ? wantedEnd : start + 2 * 86400000 - 1000;`,
    `  // Live Route window includes previous day, today and tomorrow so trips\n  // planned across Bangkok midnight are already visible before 00:00.\n  const end = Number.isFinite(wantedEnd) ? wantedEnd : start + 3 * 86400000 - 1000;`,
    "cross-midnight live Route window",
  );
}
