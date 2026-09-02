import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV summary filter patch failed: ${label}`);
  return output.replace(from, to);
}

export function patchDevSummaryFilter(source) {
  let output = String(source || "");
  output = replaceUnique(
    output,
    `            const completed = await apiGet("msCompletedToday", { branch: state.branch });
            state.archiveRows = mergeLatest(state.archiveRows, completed?.rows || []);
            state.rows = mergeLatest(state.archiveRows, state.currentRows);
            state.completedToday = Number(completed?.total) || 0;
            state.queue = "all";
            el("queue-filter").value = "all";`,
    `            const completed = await apiGet("msCompletedToday", { branch: state.branch });
            const completedRows = Array.isArray(completed?.rows) ? completed.rows : [];
            state.archiveRows = mergeLatest(
              state.archiveRows.filter((row) => !isCompletedToday(row)),
              completedRows,
            );
            state.rows = mergeLatest(state.archiveRows, state.currentRows);
            state.completedToday = Number(completed?.total) || completedRows.length;
            state.query = "";
            state.dateFrom = "";
            state.dateTo = "";
            state.attendance = "all";
            state.attribute = "all";
            state.region = "all";
            state.route = "all";
            state.status = "all";
            el("search-input").value = "";
            el("date-from").value = "";
            el("date-to").value = "";
            el("attendance-filter").value = "all";
            el("attribute-filter").value = "all";
            el("region-filter").value = "all";
            el("route-filter").value = "all";
            el("status-filter").value = "all";
            state.queue = "all";
            el("queue-filter").value = "all";`,
    "completed card must display the same daily rows as its total",
  );
  output = replaceUnique(
    output,
    `        }
        state.summary = value;
        render();`,
    `        } else {
          state.queue = "queue";
          el("queue-filter").value = "queue";
        }
        state.summary = value;
        render();`,
    "active summary cards must return to current queue after completed view",
  );
  output = replaceUnique(
    output,
    `function filteredRows(ignoreSummary = false) {
  const source =
    state.queue === "queue" ? state.currentRows : state.archiveRows;`,
    `function filteredRows(ignoreSummary = false, queueMode = state.queue) {
  const source =
    queueMode === "queue" ? state.currentRows : state.archiveRows;`,
    "summary counting can choose current queue without changing table view",
  );
  output = replaceUnique(
    output,
    `      const queueMatch =
        state.queue === "all" ||
        (state.queue === "completed" && (queue.done || queue.expired)) ||
        (state.queue === "queue" && queue.active);`,
    `      const queueMatch =
        queueMode === "all" ||
        (queueMode === "completed" && (queue.done || queue.expired)) ||
        (queueMode === "queue" && queue.active);`,
    "queue match follows requested summary source",
  );
  output = replaceUnique(
    output,
    `      return state.queue === "queue" ? aTime - bTime : bTime - aTime;`,
    `      return queueMode === "queue" ? aTime - bTime : bTime - aTime;`,
    "summary source sort follows requested queue mode",
  );
  output = replaceUnique(
    output,
    `  const summaryRows = filteredRows(true);
  const rows = filteredRows();`,
    `  const summaryRows = filteredRows(
    true,
    state.summary === "completed" ? "queue" : state.queue,
  );
  const rows = filteredRows();`,
    "completed view keeps the other five summary counts on current live queue",
  );
  return output;
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedPath) {
  const target = process.argv[2];
  if (!target)
    throw new Error("Usage: node patch-ms-summary-filter.mjs <staged-ms.js>");
  const source = await readFile(target, "utf8");
  await writeFile(target, patchDevSummaryFilter(source), "utf8");
  console.log(`Patched DEV summary card filtering: ${target}`);
}
