function replaceUnique(output, from, to, label) {
  const first = output.indexOf(from);
  const last = output.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`MS completed view stability patch failed: ${label}`);
  return output.replace(from, to);
}

const FRONTEND_MARKER = "const preserveObservedCompletion =";

export function patchMsCompletedViewStabilityFrontend(source) {
  const output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;

  return replaceUnique(
    output,
    `function mergeLatest(archive, current) {\n  const latest = new Map(\n    (archive || []).map((row) => [row.id || row.proofId, row]),\n  );\n  for (const row of current || []) latest.set(row.id || row.proofId, row);\n  return [...latest.values()];\n}`,
    `function mergeLatest(archive, current) {\n  const latest = new Map(\n    (archive || []).map((row) => [row.id || row.proofId, row]),\n  );\n  for (const row of current || []) {\n    const key = row.id || row.proofId;\n    const previous = latest.get(key);\n    const sameCompletionObservation =\n      !row?.unloadingCompletedAt ||\n      !previous?.unloadingCompletedAt ||\n      String(row.unloadingCompletedAt) === String(previous.unloadingCompletedAt);\n    const preserveObservedCompletion =\n      previous?.completionObservedLive === true &&\n      Number(previous?.unloadingState) === 2 &&\n      Number(row?.unloadingState) === 2 &&\n      sameCompletionObservation;\n    latest.set(\n      key,\n      preserveObservedCompletion\n        ? {\n            ...row,\n            unloadingCompletedAt:\n              row?.unloadingCompletedAt || previous?.unloadingCompletedAt,\n            completionObservedLive: true,\n          }\n        : row,\n    );\n  }\n  return [...latest.values()];\n}`,
    "live polling must not erase an already-observed daily completion",
  );
}
