function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS operating-day patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = 'state.summary === "completed-all"';
const FRONTEND_0700_MARKER = "MS_LOWER_OPERATING_DAY_0700_V2";
const WORKER_MARKER = "start + 3 * 86400000 - 1000";

export function patchMsOperatingDayFrontend(source) {
  let output = String(source || "");

  if (!output.includes(FRONTEND_MARKER)) {
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
      `  setMetric(\n    "metric-completed",\n    state.archiveRows.filter((row) => isCompletedToday(row)).length,\n  );`,
      `  if (state.archiveLoaded)\n    setMetric(\n      "metric-completed",\n      state.archiveRows.filter((row) => isCompletedAccumulated(row)).length,\n    );\n  else\n    el("metric-completed").textContent = "กดดู";`,
      "top completed metric is cumulative and never partial",
    );

    output = replaceUnique(
      output,
      `function metrics() {\n  const active =`,
      `function metrics() {\n  const completedNote = el("metric-completed")?.closest(".metric-card")?.querySelector("small");\n  if (completedNote) completedNote.textContent = "ปลายทางและจุดดรอปที่ลงของเสร็จสะสม";\n  const active =`,
      "upper completed cumulative wording",
    );
  }

  if (!output.includes(FRONTEND_0700_MARKER)) {
    output = replaceUnique(
      output,
      `let lowerDailyDay = bangkokDateValue(new Date());`,
      `// ${FRONTEND_0700_MARKER}: Lower daily cards use the operational day 07:00 -> 07:00 Asia/Bangkok.\nfunction lowerOperatingDayValue(value = new Date()) {\n  const parsed = parseDate(value);\n  if (!parsed) return "";\n  return bangkokDateValue(new Date(parsed.getTime() - 7 * 60 * 60 * 1000));\n}\n\nlet lowerDailyDay = lowerOperatingDayValue(new Date());`,
      "lower daily operating-day helper",
    );

    output = replaceUnique(
      output,
      `  const nextDay = bangkokDateValue(new Date());\n  if (!nextDay || nextDay === lowerDailyDay) return;`,
      `  const nextDay = lowerOperatingDayValue(new Date());\n  if (!nextDay || nextDay === lowerDailyDay) return;`,
      "lower daily reset at 07:00",
    );

    output = replaceUnique(
      output,
      `  return bangkokDateValue(row.unloadingCompletedAt) === bangkokDateValue(now);`,
      `  return lowerOperatingDayValue(row.unloadingCompletedAt) === lowerOperatingDayValue(now);`,
      "completed lower filter uses 07:00 operating day",
    );

    output = replaceUnique(
      output,
      `    bangkokDateValue(row.queueCancelledAt) === bangkokDateValue(now)`,
      `    lowerOperatingDayValue(row.queueCancelledAt) === lowerOperatingDayValue(now)`,
      "cancelled lower filter uses 07:00 operating day",
    );
  }

  return output;
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
