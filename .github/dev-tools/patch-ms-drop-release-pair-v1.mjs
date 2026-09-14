const FRONTEND_MARKER = "MS_DROP_RELEASE_PAIR_V1";
const STYLE_MARKER = "MS_DROP_RELEASE_PAIR_STYLE_V1";

export function patchMsDropReleasePairV1Frontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  const helperAnchor = `function classicOperationFact(label, value, wide = false) {\n  return \`<div class=\\"classic-operation-fact\${wide ? \" is-wide\" : \"\"}\\"><span>\${esc(label)}</span><strong>\${esc(value || \"-\")}</strong></div>\`;\n}\n`;
  if (!output.includes(helperAnchor))
    throw new Error("MS Drop release pair V1 helper anchor missing");

  const helper = `${helperAnchor}\n// ${FRONTEND_MARKER}: one Drop release box, split into planned and actual columns.\n// Planned release is display-only; Route actualDepartureAt remains the only actual departure truth.\nfunction classicDropReleasePair(row, release) {\n  const planned = shortDateTime(release?.plan);\n  const actual = shortDateTime(row.actualDepartureAt);\n  return \`<div class=\\"classic-operation-fact is-wide drop-release-pair\\"><div class=\\"drop-release-pair-cell\\"><span>กำหนดปล่อยรถ</span><strong>\${esc(planned)}</strong></div><div class=\\"drop-release-pair-cell is-actual\\"><span>ออกจากจุดดรอปจริง</span><strong>\${esc(actual)}</strong></div></div>\`;\n}\n`;
  output = output.replace(helperAnchor, helper);

  const oldFact = `drop.onwardDone ? classicOperationFact("ออกจากจุดดรอปจริง", shortDateTime(row.actualDepartureAt), true) : "",`;
  const newFact = `(release?.plan || parseDate(row.actualDepartureAt)) ? classicDropReleasePair(row, release) : "",`;
  if (!output.includes(oldFact))
    throw new Error("MS Drop release pair V1 Drop fact anchor missing");
  output = output.replace(oldFact, newFact);

  for (const expected of [
    FRONTEND_MARKER,
    "function classicDropReleasePair(row, release)",
    "const planned = shortDateTime(release?.plan);",
    "const actual = shortDateTime(row.actualDepartureAt);",
    "กำหนดปล่อยรถ",
    "ออกจากจุดดรอปจริง",
    "(release?.plan || parseDate(row.actualDepartureAt)) ? classicDropReleasePair(row, release) : \"\"",
  ]) {
    if (!output.includes(expected))
      throw new Error(`MS Drop release pair V1 invariant missing: ${expected}`);
  }

  return output;
}

export function patchMsDropReleasePairV1Style(source) {
  let output = String(source || "");
  if (output.includes(STYLE_MARKER)) return output;
  return `${output}\n\n/* ${STYLE_MARKER}: one full-width Drop box split into planned/actual release columns. */\n.ms-page .drop-release-pair{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px!important;padding:0!important;overflow:hidden;background:#dedfdd!important}\n.ms-page .drop-release-pair-cell{display:flex;min-width:0;min-height:43px;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 7px;background:#fff;text-align:center}\n.ms-page .drop-release-pair-cell>span{color:#6a7277;font-size:10px;font-weight:750;line-height:1.2}\n.ms-page .drop-release-pair-cell>strong{max-width:100%;color:#202124;font-size:12px;font-weight:900;line-height:1.3;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}\n@media(max-width:430px){.ms-page .drop-release-pair-cell{min-height:43px;padding:5px 4px}.ms-page .drop-release-pair-cell>span{font-size:9px}.ms-page .drop-release-pair-cell>strong{font-size:11px}}\n`;
}
