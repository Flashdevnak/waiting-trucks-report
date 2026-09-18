const WORKER_MARKER = "PNO_ROUND2_BARCODE_BACKING_V2";
const FRONTEND_MARKER = "PNO_ROUND2_UI_V2";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) throw new Error(`${label}: anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))];
  if (matches.length !== 1) throw new Error(`${label}: expected 1 match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

const DESTINATION = "\u0e1b\u0e25\u0e32\u0e22\u0e17\u0e32\u0e07";
const DROP = "\u0e08\u0e38\u0e14\u0e14\u0e23\u0e2d\u0e1b";

export function patchPnoRound2Worker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("PNO_ULTRA_LOW_QUOTA_V1")) return output;

  output = replaceUnique(
    output,
    `  if (mapped.attendanceType === "${DESTINATION}") {`,
    `  // ${WORKER_MARKER}: destination + drop-point are inbound PNO truth; origin stays excluded.\n  if (mapped.attendanceType === "${DESTINATION}" || mapped.attendanceType === "${DROP}") {`,
    "Round2 attendance eligibility",
  );

  output = replaceUnique(
    output,
    `function pnoViewKey(row) {\n  return \`${'${normalizeProofId(row?.proofId)}'}|${'${normalizeMsAttendance(row?.attendanceType)}'}\`;\n}`,
    `function pnoViewKey(row) {\n  // One truck has one exact Barcode/proofId. Attendance is not part of identity.\n  return normalizeProofId(row?.proofId);\n}`,
    "Round2 proof-only metadata key",
  );

  output = replaceUnique(
    output,
    `    if (normalizeMsAttendance(row?.attendanceType) !== "${DESTINATION}") continue;`,
    `    if (!["${DESTINATION}", "${DROP}"].includes(normalizeMsAttendance(row?.attendanceType))) continue;`,
    "Round2 drop metadata eligibility",
  );

  output = replaceRegexOnce(
    output,
    /function preEntrySemanticKey\(value\) \{[\s\S]*?\n\}/,
    `function preEntrySemanticKey(value) {\n  // Barcode/proofId is the primary trip key. Overlapping source-day snapshots are revisions, not duplicates.\n  return normalizeProofId(value?.proofId);\n}`,
    "Round2 barcode-primary collapse",
  );

  output = replaceUnique(
    output,
    `      backingNo: text(row.bag_no || row.bagging_no || row.backing_no || row.pack_no || row.bag_code || row.package_no || row.backingNo, 120),`,
    `      // HAR truth: route_followstart_list exposes Backing/Bagging in pack_no.\n      backingNo: text(row.pack_no || row.backingNo || row.backing_no || row.bagging_no || row.bag_no || row.bag_code || row.package_no, 120),`,
    "Round2 pack_no primary mapping",
  );

  output = replaceUnique(
    output,
    `    })).filter((row) => row.pno);`,
    `    })).filter((row) => row.pno || row.backingNo);`,
    "Round2 retain Backing rows",
  );

  return output;
}

export function patchPnoRound2Frontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("PNO_BROWSER_CACHE_V1")) return output;

  // Duplicate Barcode is not a valid user-facing state: exact Barcode is the one-truck primary key.
  output = output.replace(/\n\s*if \(row\.pnoState === "AMBIGUOUS"\)\s*\n\s*return '[^']*';/g, "");
  output = output.replace(/row\?\.pnoState === "AMBIGUOUS"\s*\n\s*\? "[^"]*"\s*\n\s*:\s*row\?\.pnoState === "COUNT_MISMATCH"/g, 'row?.pnoState === "COUNT_MISMATCH"');

  output = replaceUnique(
    output,
    `<th>PNO / \u0e41\u0e1a\u0e47\u0e01\u0e01\u0e34\u0e49\u0e07</th>`,
    `<th>PNO</th><th>Backing / Bagging</th>`,
    "Round2 separate Backing header",
  );

  output = replaceRegexOnce(
    output,
    /<td><strong>\$\{esc\(item\.pno\)\}<\/strong><small>[^<]*\$\{esc\(item\.backingNo \|\| "-"\)\}<\/small><\/td>/,
    `<td><strong>${'${esc(item.pno || "-")}'}<\/strong><\/td><td><strong>${'${esc(item.backingNo || "-")}'}<\/strong><\/td>`,
    "Round2 separate Backing cell",
  );

  output = replaceUnique(
    output,
    `  await navigator.clipboard.writeText(rows.map((row) => row.pno).join("\\n"));`,
    `  await navigator.clipboard.writeText(rows.map((row) => \`${'${row.pno || ""}'}\\t${'${row.backingNo || ""}'}\`).join("\\n"));`,
    "Round2 copy Backing",
  );

  output = output.replace(
    `"\u0e40\u0e25\u0e02\u0e41\u0e1a\u0e47\u0e01\u0e01\u0e34\u0e49\u0e07": row.backingNo || ""`,
    `"Backing / Bagging": row.backingNo || ""`,
  );

  // Latest accepted v8 status labels.
  const classFn = `function pnoProgressClass(percent) {\n  if (percent >= 100) return "is-complete";\n  if (percent >= 90) return "is-green";\n  if (percent >= 60) return "is-amber";\n  return "is-red";\n}`;
  if (output.includes(classFn) && !output.includes("function pnoProgressStatus(percent)")) {
    output = output.replace(
      classFn,
      `${classFn}\n\nfunction pnoProgressStatus(percent) {\n  if (percent >= 100) return "\u0e40\u0e02\u0e49\u0e32\u0e04\u0e25\u0e31\u0e07\u0e04\u0e23\u0e1a";\n  if (percent >= 90) return "\u0e1c\u0e48\u0e32\u0e19\u0e40\u0e1b\u0e49\u0e32";\n  if (percent >= 60) return "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e40\u0e02\u0e49\u0e32\u0e04\u0e25\u0e31\u0e07";\n  return "\u0e15\u0e48\u0e33\u0e01\u0e27\u0e48\u0e32\u0e40\u0e1b\u0e49\u0e32";\n}`,
    );
  }
  output = output.replace(
    `<div class="pno-progress-head"><strong>${'${pnoDisplayPercent(percent)}'}<\/strong><span>\u0e40\u0e02\u0e49\u0e32\u0e04\u0e25\u0e31\u0e07\u0e41\u0e25\u0e49\u0e27<\/span><\/div>`,
    `<div class="pno-progress-head"><strong>${'${pnoDisplayPercent(percent)}'}<\/strong><span>${'${pnoProgressStatus(percent)}'} \u00b7 \u0e40\u0e1b\u0e49\u0e32 90%<\/span><\/div>`,
  );

  output = replaceUnique(output, `  background: #eceeeb;`, `  background: #e5e8ea;`, "Round2 v8 track");
  output = replaceUnique(output, `  background: #d7443e;`, `  background: linear-gradient(90deg, #b93a2f, #e46a5e);`, "Round2 v8 red");
  output = replaceUnique(output, `.ms-page .pno-summary.is-amber .pno-progress-fill { background: #d99a18; }`, `.ms-page .pno-summary.is-amber .pno-progress-fill { background: linear-gradient(90deg, #b87900, #f0b51c); }`, "Round2 v8 amber");
  output = replaceUnique(output, `.ms-page .pno-summary.is-green .pno-progress-fill { background: #75b47f; }`, `.ms-page .pno-summary.is-green .pno-progress-fill { background: linear-gradient(90deg, #3b8b58, #74bf8d); }`, "Round2 v8 green");
  output = replaceUnique(output, `.ms-page .pno-summary.is-complete .pno-progress-fill { background: #3d8d56; }`, `.ms-page .pno-summary.is-complete .pno-progress-fill { background: linear-gradient(90deg, #202428 0%, #30363a 58%, #3b4145 82%, #b48f00 94%, #ffd42f 100%); }`, "Round2 v8 complete");
  output = replaceUnique(output, `  background: #535953;`, `  background: #313638;`, "Round2 v8 marker");

  // Executable marker keeps idempotency explicit without depending on CSS formatting.
  output = replaceUnique(
    output,
    `function pnoProgressClass(percent) {`,
    `// ${FRONTEND_MARKER}: v8 palette + Backing/Bagging presentation.\nfunction pnoProgressClass(percent) {`,
    "Round2 frontend marker",
  );
  return output;
}
