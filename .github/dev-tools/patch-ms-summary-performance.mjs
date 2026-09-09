function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS summary performance patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "function renderRowsProgressively(rows)";
const STYLE_MARKER = "/* MS summary performance */";
const MOBILE_EXPORT_MARKER = "/* MS mobile export single-column v2 */";
const PROOF_MOBILE_TOOLBAR_MARKER = "/* Proof V16 mobile toolbar containment v2 */";
const PROOF_MOBILE_HEADER_MARKER = "/* Proof mobile header full-width anchor v4 */";
const CANONICAL_LOWER_MARKER = "MS_LOWER_CANONICAL_V11";
const CLASSIC_LOWER_MARKER = "MS_LOWER_CLASSIC_V12";
const DEV_MOBILE_LOWER_MARKER = "/* DEV mobile MS card spacing v7 base */";
const DEV_MOBILE_SHELL_MARKER = "/* DEV mobile unified shell v7 */";
const CANONICAL_DEV_MOBILE_NOOP =
  "/* canonical no-op: Lower responsive rules live only in MS_LOWER_CANONICAL_V11. */";

function keepCanonicalLowerStyleSingleGeneration(source) {
  const output = String(source || "");
  if (!output.includes(CANONICAL_LOWER_MARKER)) return output;

  const lowerStart = output.indexOf(DEV_MOBILE_LOWER_MARKER);
  const shellStart = output.indexOf(DEV_MOBILE_SHELL_MARKER, lowerStart);
  if (lowerStart < 0 || shellStart <= lowerStart) return output;

  const lowerBody = output
    .slice(lowerStart + DEV_MOBILE_LOWER_MARKER.length, shellStart)
    .trim();
  if (lowerBody === CANONICAL_DEV_MOBILE_NOOP) return output;

  return `${output.slice(0, lowerStart).trimEnd()}\n\n${DEV_MOBILE_LOWER_MARKER}\n${CANONICAL_DEV_MOBILE_NOOP}\n${output.slice(shellStart)}`;
}

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
  const sourceText = String(source || "");
  const hasLowerAuthority =
    sourceText.includes(CANONICAL_LOWER_MARKER) ||
    sourceText.includes(CLASSIC_LOWER_MARKER);
  const lowerMobileSafe =
    !sourceText.includes(CANONICAL_LOWER_MARKER) ||
    sourceText.includes(CANONICAL_DEV_MOBILE_NOOP);
  const fullyStagedLower =
    hasLowerAuthority &&
    lowerMobileSafe &&
    sourceText.includes(DEV_MOBILE_LOWER_MARKER) &&
    sourceText.includes(DEV_MOBILE_SHELL_MARKER) &&
    sourceText.includes(STYLE_MARKER) &&
    sourceText.includes(MOBILE_EXPORT_MARKER) &&
    sourceText.includes(PROOF_MOBILE_TOOLBAR_MARKER) &&
    sourceText.includes(PROOF_MOBILE_HEADER_MARKER);
  if (fullyStagedLower) return sourceText;

  let output = keepCanonicalLowerStyleSingleGeneration(sourceText);
  const canonicalLower = output.includes(CANONICAL_LOWER_MARKER);
  const classicLower = output.includes(CLASSIC_LOWER_MARKER);

  if (!output.includes(STYLE_MARKER)) {
    output = canonicalLower || classicLower
      ? `${output.trimEnd()}\n\n${STYLE_MARKER}\n/* lower-authority no-op: summary and responsive rules stay with the selected Lower presentation. */\n@media (min-width:1201px){}\n`
      : `${output.trimEnd()}\n\n${STYLE_MARKER}\n@media (min-width:1201px){.ms-page .filter-summary{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:10px}.ms-page .filter-summary button{min-width:0}}\n@media (min-width:701px) and (max-width:1200px){.ms-page .filter-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}}\n@media (max-width:700px){.ms-page .filter-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}\n`;
  }

  if (!output.includes(MOBILE_EXPORT_MARKER)) {
    output = `${output.trimEnd()}\n\n${MOBILE_EXPORT_MARKER}\n@media (max-width:520px){.ms-page .ms-export-actions{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:8px!important;width:100%!important}.ms-page .ms-export-actions .btn{width:100%!important;min-width:0!important;max-width:100%!important;white-space:normal!important}}\n`;
  }

  if (!output.includes(PROOF_MOBILE_TOOLBAR_MARKER)) {
    output = `${output.trimEnd()}\n\n${PROOF_MOBILE_TOOLBAR_MARKER}\n@media (max-width:760px){body.proof-page .proof-toolbar-v16{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;grid-auto-columns:minmax(0,1fr)!important;width:100%!important;min-width:0!important;max-width:100%!important}body.proof-page .proof-toolbar-v16>label,body.proof-page .proof-toolbar-v16>#clear-filter-btn{min-width:0!important;max-width:100%!important;width:100%!important;grid-column:auto!important}body.proof-page .proof-toolbar-v16>.proof-search,body.proof-page .proof-toolbar-v16>.proof-search-field-v16{grid-column:1/-1!important}body.proof-page .proof-toolbar-v16 select,body.proof-page .proof-toolbar-v16 input{min-width:0!important;max-width:100%!important;width:100%!important}}\n@media (max-width:430px){body.proof-page .proof-toolbar-v16{grid-template-columns:minmax(0,1fr)!important;grid-auto-columns:minmax(0,1fr)!important}body.proof-page .proof-toolbar-v16>label,body.proof-page .proof-toolbar-v16>#clear-filter-btn,body.proof-page .proof-toolbar-v16>.proof-search,body.proof-page .proof-toolbar-v16>.proof-search-field-v16{grid-column:1!important}}\n`;
  }

  if (!output.includes(PROOF_MOBILE_HEADER_MARKER)) {
    output = `${output.trimEnd()}\n\n${PROOF_MOBILE_HEADER_MARKER}\n@media (max-width:700px){body.ms-page.proof-page header.site-header.dev-unified-header{position:relative!important;overflow:visible!important}body.ms-page.proof-page header.site-header.dev-unified-header .site-header-inner,body.ms-page.proof-page header.site-header.dev-unified-header .dev-unified-actions,body.ms-page.proof-page header.site-header.dev-unified-header .dev-shell-slot,body.ms-page.proof-page header.site-header.dev-unified-header details.app-nav{position:static!important}body.ms-page.proof-page header.site-header.dev-unified-header details.app-nav[open]>.app-nav-menu{position:absolute!important;left:10px!important;right:auto!important;top:calc(100% + 6px)!important;bottom:auto!important;width:calc(100vw - 20px)!important;min-width:0!important;max-width:calc(100vw - 20px)!important;max-height:calc(100dvh - 210px)!important;box-sizing:border-box!important;margin:0!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;z-index:9999!important}}\n`;
  }

  return output;
}
