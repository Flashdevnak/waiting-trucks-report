function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS summary performance patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "function renderRowsProgressively(rows)";
const STYLE_MARKER = "/* MS summary performance */";

export function patchMsSummaryPerformanceFrontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  output = replaceUnique(
    output,
    `            const completed = await apiGet("msCompletedToday", { branch: state.branch });\n            const completedRows = Array.isArray(completed?.rows) ? completed.rows : [];`,
    `            const cachedCompletedRows = state.archiveRows.filter(isCompletedToday);\n            const expectedCompleted = Number(state.completedToday) || 0;\n            const completed =\n              cachedCompletedRows.length === expectedCompleted\n                ? { rows: cachedCompletedRows, total: expectedCompleted }\n                : await apiGet("msCompletedToday", { branch: state.branch });\n            const completedRows = Array.isArray(completed?.rows) ? completed.rows : [];`,
    "reuse completed rows already loaded in browser",
  );

  output = replaceUnique(
    output,
    `  const mobileLayout = window.matchMedia("(max-width: 700px)").matches;\n  if (mobileLayout) {\n    el("table-body").innerHTML = "";\n    el("mobile-cards").innerHTML = rows.map(card).join("");\n  } else {\n    el("table-body").innerHTML = rows.map(tableRow).join("");\n    el("mobile-cards").innerHTML = "";\n  }`,
    `  renderRowsProgressively(rows);`,
    "progressive visible-row rendering",
  );

  output = replaceUnique(
    output,
    `function renderFilterSummary(rows) {`,
    `let rowRenderGeneration = 0;\n\nfunction renderRowsProgressively(rows) {\n  const generation = ++rowRenderGeneration;\n  const mobileLayout = window.matchMedia("(max-width: 700px)").matches;\n  const tableBody = el("table-body");\n  const mobileCards = el("mobile-cards");\n  tableBody.innerHTML = "";\n  mobileCards.innerHTML = "";\n\n  const target = mobileLayout ? mobileCards : tableBody;\n  const renderer = mobileLayout ? card : tableRow;\n  const firstBatch = mobileLayout ? 32 : 64;\n  const nextBatch = mobileLayout ? 24 : 64;\n\n  const appendBatch = (start, end) => {\n    if (generation !== rowRenderGeneration || start >= rows.length) return;\n    target.insertAdjacentHTML(\n      "beforeend",\n      rows.slice(start, end).map(renderer).join(""),\n    );\n  };\n\n  let index = Math.min(firstBatch, rows.length);\n  appendBatch(0, index);\n\n  const pump = () => {\n    if (generation !== rowRenderGeneration || index >= rows.length) return;\n    const end = Math.min(index + nextBatch, rows.length);\n    appendBatch(index, end);\n    index = end;\n    if (index < rows.length) requestAnimationFrame(pump);\n  };\n\n  if (index < rows.length) requestAnimationFrame(pump);\n}\n\nfunction renderFilterSummary(rows) {`,
    "progressive renderer helper",
  );

  return output;
}

export function patchMsSummaryPerformanceStyle(source) {
  const output = String(source || "");
  if (output.includes(STYLE_MARKER)) return output;
  return `${output.trimEnd()}\n\n${STYLE_MARKER}\n@media (min-width:1201px){.ms-page .filter-summary{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}.ms-page .filter-summary button{min-width:0}}\n@media (min-width:701px) and (max-width:1200px){.ms-page .filter-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}}\n@media (max-width:700px){.ms-page .filter-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}\n`;
}
