const FRONTEND_MARKER = "MS_DROP_RELEASE_PAIR_V1";

export function patchMsDropReleasePairV1Frontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  const helperAnchor = `function classicOperationFact(label, value, wide = false) {\n  return \`<div class=\\"classic-operation-fact\${wide ? \" is-wide\" : \"\"}\\"><span>\${esc(label)}</span><strong>\${esc(value || \"-\")}</strong></div>\`;\n}\n`;
  if (!output.includes(helperAnchor))
    throw new Error("MS Drop release pair V1 helper anchor missing");

  const helper = `${helperAnchor}\n// ${FRONTEND_MARKER}: one Drop release box, split into planned and actual columns.\n// Planned release is display-only; Route actualDepartureAt remains the only actual departure truth.\nfunction classicDropReleasePair(row, release) {\n  const planned = shortDateTime(release?.plan);\n  const actual = shortDateTime(row.actualDepartureAt);\n  return \`<div class=\\"classic-operation-facts drop-release-pair\\" style=\\"grid-column:1/-1\\"><div class=\\"classic-operation-fact\\"><span>กำหนดปล่อยรถ</span><strong>\${esc(planned)}</strong></div><div class=\\"classic-operation-fact\\"><span>ออกจากจุดดรอปจริง</span><strong>\${esc(actual)}</strong></div></div>\`;\n}\n`;
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
    'class=\\"classic-operation-facts drop-release-pair\\" style=\\"grid-column:1/-1\\"',
    "กำหนดปล่อยรถ",
    "ออกจากจุดดรอปจริง",
    "(release?.plan || parseDate(row.actualDepartureAt)) ? classicDropReleasePair(row, release) : \"\"",
  ]) {
    if (!output.includes(expected))
      throw new Error(`MS Drop release pair V1 invariant missing: ${expected}`);
  }

  return output;
}
