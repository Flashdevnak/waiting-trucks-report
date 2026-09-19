const MARKER = "PNO_INBOUND_SCOPE_AND_EAGER_TRUTH_V22";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoInboundScopeAndEagerTruthV22(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_OPERATIONAL_RECEIPT_TRUTH_V21"))
    throw new Error(`${MARKER}: V21 prerequisite missing`);

  output = replaceUnique(
    output,
    `// PNO_OPERATIONAL_RECEIPT_TRUTH_V21: correct receipt counts only from concrete own-HUB Backing rows whose real MS lastAction is สแกนเข้าคลัง; never rename MS actions.`,
    `// PNO_OPERATIONAL_RECEIPT_TRUTH_V21: correct receipt counts only from concrete own-HUB Backing rows whose real MS lastAction is สแกนเข้าคลัง; never rename MS actions.\n// ${MARKER}: inbound PNO is destination/drop only, and explicit modal open resolves corrected truth before rendering any tab.`,
    "marker",
  );

  output = replaceUnique(
    output,
    `function pnoOperationalNormalizePno(value) {`,
    `function pnoOperationalInboundEligible(row) {\n  return Boolean(row && (isDestination(row) || isDrop(row)));\n}\n\nfunction pnoOperationalNormalizePno(value) {`,
    "inbound helper",
  );

  output = replaceUnique(
    output,
    `async function pnoOperationalResolve(row) {\n  const raw = pnoOperationalRawSummary(row);\n  if (!raw.valid || raw.pending <= 0 || row?.pnoEnabled !== true || row?.pnoState !== "OK") return raw;`,
    `async function pnoOperationalResolve(row) {\n  const raw = pnoOperationalRawSummary(row);\n  if (!pnoOperationalInboundEligible(row) || !raw.valid || raw.pending <= 0 || row?.pnoEnabled !== true || row?.pnoState !== "OK") return raw;`,
    "resolver inbound scope",
  );

  output = replaceUnique(
    output,
    `function pnoOperationalQueueResolve(row) {\n  if (!row?.id) return;`,
    `function pnoOperationalQueueResolve(row) {\n  if (!row?.id || !pnoOperationalInboundEligible(row)) return;`,
    "observer inbound scope",
  );

  output = replaceUnique(
    output,
    `function expectedParcelsBadge(row) {\n  if (row.pnoState === "UNAVAILABLE")`,
    `function expectedParcelsBadge(row) {\n  if (!pnoOperationalInboundEligible(row)) return "";\n  if (row.pnoState === "UNAVAILABLE")`,
    "origin badge suppression",
  );

  output = replaceUnique(
    output,
    `openPendingParcels = async function pnoV18OpenPendingParcels(row, type = "no_entry", page = 1, { force = false } = {}) {\n  const args = pnoV18ResolveOpenArgs(row, type, page, { force });\n  if (!args.row || args.row.pnoState !== "OK" || args.row.pnoEnabled !== true) {`,
    `openPendingParcels = async function pnoV18OpenPendingParcels(row, type = "no_entry", page = 1, { force = false } = {}) {\n  const args = pnoV18ResolveOpenArgs(row, type, page, { force });\n  if (!args.row || !pnoOperationalInboundEligible(args.row) || args.row.pnoState !== "OK" || args.row.pnoEnabled !== true) {`,
    "modal inbound scope",
  );

  output = replaceUnique(
    output,
    `  el("pending-parcels-trip").textContent = [pnoV18State.proofId, pnoV18State.routeName].filter(Boolean).join(" · ");\n  pnoV18RenderSummary();\n  el("pending-parcels-dialog").showModal();`,
    `  el("pending-parcels-trip").textContent = [pnoV18State.proofId, pnoV18State.routeName].filter(Boolean).join(" · ");\n  await pnoOperationalResolve(args.row);\n  pnoV18RenderSummary();\n  el("pending-parcels-dialog").showModal();`,
    "eager truth before modal render",
  );

  return output;
}
