const FRONTEND_MARKER = "PNO_MODAL_COPY_MULTIDROP_TRUTH_V27";
const WORKER_MARKER = "PNO_PREENTRY_MULTIDROP_SUM_V27";

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start)
    throw new Error(`${FRONTEND_MARKER}: ${label} anchors missing`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceUnique(source, from, to, label, marker = WORKER_MARKER) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${marker}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function aggregatePreEntryFixtureV27(rows) {
  const segmentSeen = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const proof = String(row?.proof_id || "").trim().toUpperCase();
    if (!proof) continue;
    const key = [
      proof,
      String(row?.line_id || row?.van_line_id || ""),
      String(row?.store_id || ""),
      String(row?.next_store_id || ""),
    ].join("|");
    if (!segmentSeen.has(key)) segmentSeen.set(key, row);
  }
  const grouped = new Map();
  for (const row of segmentSeen.values()) {
    const proof = String(row?.proof_id || "").trim().toUpperCase();
    const current = grouped.get(proof) || {
      proofId: proof,
      routeName: String(row?.line_name || ""),
      expectedParcels: 0,
      enteredParcels: 0,
      pendingParcels: 0,
      nextStoreName: String(row?.next_store_name || ""),
      segments: 0,
    };
    current.expectedParcels += Number(row?.total_num) || 0;
    current.enteredParcels += Number(row?.already_num) || 0;
    current.pendingParcels += Number(row?.no_entry_num) || 0;
    current.routeName ||= String(row?.line_name || "");
    current.nextStoreName ||= String(row?.next_store_name || "");
    current.segments += 1;
    grouped.set(proof, current);
  }
  return grouped;
}

export function patchPnoV27Frontend(source) {
  let output = String(source || "");
  if (output.includes(FRONTEND_MARKER)) return output;
  if (!output.includes("PNO_OWN_HUB_BACKING_SINGLE_TRUTH_V25"))
    throw new Error(`${FRONTEND_MARKER}: V25 truth prerequisite missing`);

  const renderSummary = `// ${FRONTEND_MARKER}: modal summary must use the same corrected V25 truth as the card.
function pnoV18RenderSummary() {
  const row = pnoV18SourceRow();
  const truth = typeof pnoOperationalSummaryForRow === "function"
    ? pnoOperationalSummaryForRow(row)
    : null;
  const total = pnoV18Number(truth?.expected ?? row?.expectedParcels);
  const entered = pnoV18Number(truth?.entered ?? row?.enteredParcels);
  const pending = pnoV18Number(truth?.pending ?? row?.pendingParcels);
  const values = [
    ["ทั้งหมด", "รายการพัสดุ", total ?? (pnoV18State.type === "total" ? pnoV18State.total : null)],
    ["เข้าคลังแล้ว", "สแกนเข้าแล้ว", entered],
    ["คงเหลือ", "ยังไม่เข้าคลัง", pending],
  ];
  el("pno-v18-summary").innerHTML = values.map((item) =>
    '<div class="pno-v18-summary-item"><div><div class="pno-v18-summary-label">' + item[0] +
    '</div><div class="pno-v18-summary-note">' + item[1] +
    '</div></div><div class="pno-v18-summary-value">' + (item[2] === null ? "-" : nf.format(item[2])) + '</div></div>'
  ).join("");
}

`;
  output = replaceBetween(
    output,
    "function pnoV18RenderSummary() {",
    "function pnoV18SetActive(type) {",
    renderSummary,
    "modal summary",
  );

  const bagSummary = `function pnoV18BagSummary(items) {
  const sourceRow = pnoV18SourceRow();
  // HUB ถัดไป is route-level next_store_name, never a mix of parcel final HUBs.
  const nextHub = pnoV18TextValue(
    sourceRow?.pnoNextStoreName || sourceRow?.nextStoreName || state.branch
  );
  return {
    status: pnoV18BagValue(items, (item) => item.status || item.lastAction, "หลายสถานะ"),
    latest: pnoV18BagLatest(items),
    hub: nextHub,
    branch: pnoV18BagValue(items, (item) => item.targetBranch, "หลายสาขา"),
  };
}

`;
  output = replaceBetween(
    output,
    "function pnoV18BagSummary(items) {",
    "function pnoV18RenderBags(rows) {",
    bagSummary,
    "bag route next HUB",
  );

  const copy = `async function pnoV18Copy() {
  let lines = [];
  let count = 0;
  if (pnoV18State.type === "bag") {
    const groups = pnoV18FilteredBagGroups();
    if (!groups.length) return toast("ยังไม่มีข้อมูลถุงตามฟิลเตอร์ให้คัดลอก", true);
    lines.push(["#", "เลขถุงแบ็กกิ้ง", "ล่าสุด", "จำนวนพัสดุ", "HUB ถัดไป", "สาขาถัดไป"].join("\\t"));
    groups.forEach(([bag, items], index) => {
      const summary = pnoV18BagSummary(items);
      lines.push([
        index + 1, bag, summary.latest, items.length, summary.hub, summary.branch,
      ].map(pnoV18TsvCell).join("\\t"));
    });
    count = groups.length;
    if (pnoV18State.expandedBag) {
      const match = groups.find(([bag]) => bag === pnoV18State.expandedBag);
      if (match) {
        lines.push("");
        lines.push(["รายการในถุง", match[0]].join("\\t"));
        lines.push(["#", "PNO", "ล่าสุด", "เวลา"].join("\\t"));
        match[1].forEach((item, index) => {
          lines.push([
            index + 1, item.pno || "", item.lastAction || "", item.lastActionAt || "",
          ].map(pnoV18TsvCell).join("\\t"));
        });
      }
    }
  } else {
    const entries = pnoV18FilteredParcelEntries();
    if (!entries.length) return toast("ยังไม่มีข้อมูลพัสดุตามฟิลเตอร์ให้คัดลอก", true);
    lines.push(["#", "PNO", "ล่าสุด", "HUB ปลายทาง", "สาขาปลายทาง", "เวลา"].join("\\t"));
    entries.forEach(({ item: row, sourceIndex }) => {
      lines.push([
        (pnoV18State.page - 1) * 200 + sourceIndex + 1,
        row.pno || "",
        row.lastAction || "",
        row.targetHub || "",
        row.targetBranch || "",
        row.lastActionAt || "",
      ].map(pnoV18TsvCell).join("\\t"));
    });
    count = entries.length;
  }
  const ok = await pnoV18WriteClipboard(lines.join("\\n"));
  if (!ok) return toast("คัดลอกไม่สำเร็จ กรุณาลองใหม่", true);
  toast("คัดลอกข้อมูล " + nf.format(count) + " รายการแล้ว พร้อมวางใน Excel/Sheets");
}

`;
  output = replaceBetween(
    output,
    "async function pnoV18Copy() {",
    "function pnoV18LineCell(value) {",
    copy,
    "plain copy",
  );

  const lineHeader = `function pnoV18LineHeader() {
  const row = pnoV18SourceRow();
  const truth = typeof pnoOperationalSummaryForRow === "function"
    ? pnoOperationalSummaryForRow(row)
    : null;
  const total = pnoV18Number(truth?.expected ?? row?.expectedParcels);
  const entered = pnoV18Number(truth?.entered ?? row?.enteredParcels);
  const pending = pnoV18Number(truth?.pending ?? row?.pendingParcels);
  const trip = [pnoV18State.proofId, pnoV18State.routeName].filter(Boolean).map(pnoV18LineCell).join(" · ");
  return [
    "📦 รายการพัสดุเข้าคลัง",
    trip ? "รถ: " + trip : "",
    "ทั้งหมด " + (total === null ? "-" : nf.format(total)) +
      " | เข้าแล้ว " + (entered === null ? "-" : nf.format(entered)) +
      " | คงเหลือ " + (pending === null ? "-" : nf.format(pending)),
  ].filter(Boolean);
}

`;
  output = replaceBetween(
    output,
    "function pnoV18LineHeader() {",
    "function pnoV18AppendLineLimited",
    lineHeader,
    "LINE header truth",
  );

  const copyLine = `async function pnoV18CopyLine() {
  const lines = pnoV18LineHeader();
  const filterText = pnoV18FilterSummaryText();
  let count = 0;

  if (pnoV18State.type === "bag") {
    const groups = pnoV18FilteredBagGroups()
      .map(([bag, items]) => ({ bag, items, summary: pnoV18BagSummary(items) }))
      .sort((a, b) =>
        a.summary.hub.localeCompare(b.summary.hub, "th") ||
        a.summary.status.localeCompare(b.summary.status, "th") ||
        a.bag.localeCompare(b.bag, "th")
      );
    if (!groups.length) return toast("ยังไม่มีข้อมูลถุงตามฟิลเตอร์สำหรับส่ง LINE", true);
    const pieces = groups.reduce((sum, group) => sum + group.items.length, 0);
    lines.push("หมวด: แบ็กกิ้ง");
    if (filterText) lines.push("ฟิลเตอร์: " + filterText);
    lines.push("สรุป: " + nf.format(groups.length) + " ถุง · " + nf.format(pieces) + " ชิ้น");
    lines.push("");
    // LINE bag copy intentionally has no 30-row cap: every filtered bag is shown.
    groups.forEach((group, index) => {
      lines.push(
        (index + 1) + ". " +
        pnoV18LineCell(group.summary.hub) + " | " +
        pnoV18LineCell(group.summary.status) + " | " +
        pnoV18LineCell(group.bag) + " | " +
        nf.format(group.items.length) + " ชิ้น"
      );
    });
    count = groups.length;

    if (pnoV18State.expandedBag) {
      const match = groups.find((group) => group.bag === pnoV18State.expandedBag);
      if (match) {
        lines.push("");
        lines.push("รายการในถุง " + pnoV18LineCell(match.bag) + " · " + nf.format(match.items.length) + " ชิ้น");
        pnoV18AppendLineLimited(lines, match.items, (item, index) =>
          (index + 1) + ". " + pnoV18LineCell(item.pno) +
          " | " + pnoV18LineCell(item.lastAction) +
          " | " + pnoV18LineCell(item.lastActionAt)
        );
      }
    }
  } else {
    const entries = pnoV18FilteredParcelEntries();
    if (!entries.length) return toast("ยังไม่มีข้อมูลพัสดุตามฟิลเตอร์สำหรับส่ง LINE", true);
    lines.push("หมวด: " + pnoV18TypeLabel(pnoV18State.type) + " | หน้า " + nf.format(pnoV18State.page));
    if (filterText) lines.push("ฟิลเตอร์: " + filterText);
    lines.push("พบ " + nf.format(entries.length) + " รายการในหน้านี้");
    lines.push("");
    pnoV18AppendLineLimited(lines, entries, ({ item: row, sourceIndex }) =>
      ((pnoV18State.page - 1) * 200 + sourceIndex + 1) + ". " + pnoV18LineCell(row.pno) +
      " | " + pnoV18LineCell(row.lastAction) +
      " | " + pnoV18LineCell(row.targetHub) + " > " + pnoV18LineCell(row.targetBranch) +
      " | " + pnoV18LineCell(row.lastActionAt)
    );
    count = entries.length;
  }

  const ok = await pnoV18WriteClipboard(lines.join("\\n"));
  if (!ok) return toast("คัดลอกสำหรับ LINE ไม่สำเร็จ กรุณาลองใหม่", true);
  toast("คัดลอกสำหรับ LINE " + nf.format(count) + " รายการแล้ว");
}

`;
  output = replaceBetween(
    output,
    "async function pnoV18CopyLine() {",
    "async function pnoV18Export() {",
    copyLine,
    "LINE copy",
  );

  return output;
}

export function patchPnoV27Worker(source) {
  let output = String(source || "");
  if (output.includes(WORKER_MARKER)) return output;
  if (!output.includes("PNO_FBI_SOURCE_CONTRACT_V23"))
    throw new Error(`${WORKER_MARKER}: V23 worker prerequisite missing`);

  output = replaceUnique(
    output,
    `const PNO_VIEW_FIELDS = [
  "pnoState", "pnoEnabled", "pnoPercent", "pnoSourceDay",
  "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId", "pnoCanReport",
];`,
    `const PNO_VIEW_FIELDS = [
  "pnoState", "pnoEnabled", "pnoPercent", "pnoSourceDay",
  "pnoLineId", "pnoVanLineId", "pnoStoreId", "pnoNextStoreId", "pnoNextStoreName", "pnoCanReport",
];`,
    "PNO view next-store name",
  );

  output = replaceUnique(
    output,
    `    pnoNextStoreId: text(row.next_store_id, 160),
    pnoCanReport: row?.__pnoCanReport === true || Number(row?.can_report) === 1,`,
    `    pnoNextStoreId: text(row.next_store_id, 160),
    pnoNextStoreName: text(row.next_store_name, 300),
    pnoCanReport: row?.__pnoCanReport === true || Number(row?.can_report) === 1,`,
    "PNO view next-store name mapping",
  );

  const oldCounts = `    const counts = new Map();
    for (const row of rows) {
      const key = normalizeProofId(row.proof_id);
      if (!key) continue;
      const value = {
        proofId: text(row.proof_id, 100),
        routeName: text(row.line_name, 300),
        expectedParcels: numberOrNull(row.total_num),
        enteredParcels: numberOrNull(row.already_num),
        pendingParcels: numberOrNull(row.no_entry_num),
      };
      setEnrichmentAliases(counts, value, row.proof_id, row.line_name, row.plate_number);
    }
    return counts;`;

  const newCounts = `    // ${WORKER_MARKER}: one proof/trip may contain multiple pickup/drop segments.
    // Deduplicate repeated source rows, then sum unique segments for the same proof.
    // This reuses the already-fetched PreEntry pages: upstream calls remain unchanged.
    const uniqueSegments = new Map();
    for (const row of rows) {
      const proofId = normalizeProofId(row.proof_id);
      if (!proofId) continue;
      const segmentKey = [
        proofId,
        text(row.line_id || row.van_line_id, 160),
        text(row.store_id, 160),
        text(row.next_store_id, 160),
      ].join("|");
      if (!uniqueSegments.has(segmentKey)) uniqueSegments.set(segmentKey, row);
    }

    const grouped = new Map();
    for (const row of uniqueSegments.values()) {
      const proofId = normalizeProofId(row.proof_id);
      const current = grouped.get(proofId) || {
        proofId: text(row.proof_id, 100),
        routeName: text(row.line_name, 300),
        expectedParcels: 0,
        enteredParcels: 0,
        pendingParcels: 0,
        pnoSegmentCount: 0,
        aliases: [],
      };
      const expected = numberOrNull(row.total_num);
      const entered = numberOrNull(row.already_num);
      const pending = numberOrNull(row.no_entry_num);
      if (expected === null || entered === null || pending === null) {
        current.invalidCounts = true;
      } else {
        current.expectedParcels += expected;
        current.enteredParcels += entered;
        current.pendingParcels += pending;
      }
      current.pnoSegmentCount += 1;
      current.aliases.push([row.proof_id, row.line_name, row.plate_number]);
      grouped.set(proofId, current);
    }

    const counts = new Map();
    for (const value of grouped.values()) {
      if (value.invalidCounts) {
        value.expectedParcels = null;
        value.enteredParcels = null;
        value.pendingParcels = null;
      }
      const aliases = value.aliases;
      delete value.aliases;
      delete value.invalidCounts;
      for (const alias of aliases)
        setEnrichmentAliases(counts, value, alias[0], alias[1], alias[2]);
    }
    return counts;`;

  const preEntryStart = output.indexOf("async function readPreEntryCounts(");
  const countsStart = output.indexOf("    const counts = new Map();", preEntryStart);
  const countsEndMarker = "    return counts;";
  const countsEnd = output.indexOf(countsEndMarker, countsStart);
  if (preEntryStart < 0 || countsStart < 0 || countsEnd <= countsStart)
    throw new Error(`${WORKER_MARKER}: multi-drop PreEntry bounded block missing`);
  output = output.slice(0, countsStart) + newCounts +
    output.slice(countsEnd + countsEndMarker.length);

  return output;
}


const PENDING_INTERSECTION_MARKER = "PNO_PENDING_MEMBERSHIP_INTERSECTION_V28";
const TBR_FIELD_MARKER = "BUS_TIME_TBR_FIELD_TRUTH_V28";

function v28FixtureMap(rows) {
  const map = new Map();
  for (const item of Array.isArray(rows) ? rows : []) {
    const pno = String(item?.pno || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!pno || map.has(pno)) continue;
    map.set(pno, item);
  }
  return map;
}

export function correctPendingFixtureV28(raw, totalRows, pendingRows) {
  const expected = Number(raw?.expected);
  const entered = Number(raw?.entered);
  const pending = Number(raw?.pending);
  const totalMap = v28FixtureMap(totalRows);
  const pendingMap = v28FixtureMap(pendingRows);
  if (![expected, entered, pending].every(Number.isFinite) || entered + pending !== expected)
    return { valid: false, reason: "RAW_SUMMARY_INVALID" };
  if (totalMap.size !== expected)
    return { valid: false, reason: "TOTAL_DETAIL_COUNT_MISMATCH" };
  if (pendingMap.size !== pending)
    return { valid: false, reason: "PENDING_DETAIL_COUNT_MISMATCH" };
  for (const pno of pendingMap.keys())
    if (!totalMap.has(pno)) return { valid: false, reason: "PENDING_NOT_SUBSET_OF_TOTAL" };
  let correction = 0;
  for (const pno of pendingMap.keys())
    if (totalMap.get(pno)?.ownHubBacking === true) correction += 1;
  return { valid: true, expected, entered: entered + correction, pending: pending - correction, correction };
}

function pnoV28TruthBuilder(row, totalRows, pendingRows) {
  const raw = pnoOperationalRawSummary(row);
  if (!raw.valid || !pnoOperationalInboundEligible(row)) return raw;
  const currentHub = pnoOperationalCurrentHub();
  if (!currentHub) return { ...raw, reason: "CURRENT_HUB_UNRESOLVED" };
  const totalMap = pnoOperationalUniqueMap(totalRows);
  const pendingMap = pnoOperationalUniqueMap(pendingRows);
  if (totalMap.size !== raw.expected) return { ...raw, reason: "TOTAL_DETAIL_COUNT_MISMATCH" };
  if (pendingMap.size !== raw.pending) return { ...raw, reason: "PENDING_DETAIL_COUNT_MISMATCH" };
  for (const pno of pendingMap.keys())
    if (!totalMap.has(pno)) return { ...raw, reason: "PENDING_NOT_SUBSET_OF_TOTAL" };
  const candidateRows = [];
  const candidatePnos = new Set();
  for (const [pno] of pendingMap.entries()) {
    const totalItem = totalMap.get(pno);
    if (!pnoOperationalCandidate(totalItem)) continue;
    candidateRows.push(totalItem);
    candidatePnos.add(pno);
  }
  const remainingRows = [];
  const remainingPnos = new Set();
  for (const [pno, pendingItem] of pendingMap.entries()) {
    if (candidatePnos.has(pno)) continue;
    remainingPnos.add(pno);
    remainingRows.push(totalMap.get(pno) || pendingItem);
  }
  const enteredRows = [];
  for (const [pno, item] of totalMap.entries())
    if (!remainingPnos.has(pno)) enteredRows.push(item);
  const correction = candidatePnos.size;
  const correctedEntered = enteredRows.length;
  const correctedPending = remainingRows.length;
  if (correctedEntered !== raw.entered + correction || correctedPending !== raw.pending - correction || correctedEntered + correctedPending !== raw.expected)
    return { ...raw, reason: "CORRECTED_DETAIL_COUNT_MISMATCH" };
  return {
    expected: raw.expected, entered: correctedEntered, pending: correctedPending,
    percent: raw.expected > 0 ? correctedEntered / raw.expected * 100 : 0,
    correction, candidateRows, candidatePnos, enteredRows, remainingRows,
    valid: true, verified: true,
    reason: correction > 0 ? "OWN_HUB_PENDING_BACKING_CORRECTED" : "MS_COUNTS_CONFIRMED",
    currentHub,
  };
}

async function pnoV28Resolver(row) {
  const raw = pnoOperationalRawSummary(row);
  if (!pnoOperationalInboundEligible(row) || !raw.valid || raw.pending <= 0 || row?.pnoEnabled !== true || row?.pnoState !== "OK" || !pnoOperationalCurrentHub()) return raw;
  const key = pnoOperationalKey(row);
  const cached = pnoOperationalTruthCache.get(key);
  if (cached && Date.now() - cached.at < PNO_OPERATIONAL_TRUTH_CACHE_MS) return cached.truth;
  if (pnoOperationalTruthActive.has(key)) return pnoOperationalTruthActive.get(key);
  const task = (async () => {
    const total = await pnoOperationalLoadAllRaw(row, "total");
    const totalMap = pnoOperationalUniqueMap(total.rows);
    if (totalMap.size !== raw.expected) {
      const truth = { ...raw, reason: "TOTAL_DETAIL_COUNT_MISMATCH" };
      pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
      return truth;
    }
    const ownHubCandidatesExist = [...totalMap.values()].some((item) => pnoOperationalCandidate(item));
    if (!ownHubCandidatesExist) {
      const truth = { ...raw, verified: true, reason: "NO_OWN_HUB_BACKING_EXCEPTION", enteredRows: null, remainingRows: null };
      pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
      return truth;
    }
    const pending = await pnoOperationalLoadAllRaw(row, "no_entry");
    const truth = pnoOperationalBuildTruth(row, total.rows, pending.rows);
    if (pnoOperationalTruthCache.size >= 120) pnoOperationalTruthCache.clear();
    pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
    if (truth.verified && Array.isArray(truth.enteredRows)) pnoOperationalEnteredRowsCache.set(key, truth.enteredRows);
    return truth;
  })().finally(() => pnoOperationalTruthActive.delete(key));
  pnoOperationalTruthActive.set(key, task);
  return task;
}

export function patchPnoV28PendingIntersection(source) {
  let output = String(source || "");
  if (output.includes(PENDING_INTERSECTION_MARKER)) return output;
  if (!output.includes(FRONTEND_MARKER)) throw new Error(PENDING_INTERSECTION_MARKER + ": V27 prerequisite missing");
  const builder = "// " + PENDING_INTERSECTION_MARKER + ": provider no_entry membership is the pending authority.\n" +
    "// Own-HUB Backing may correct only PNOs that MS still reports as pending.\n" +
    pnoV28TruthBuilder.toString().replace("pnoV28TruthBuilder", "pnoOperationalBuildTruth") + "\n\n";
  output = replaceBetween(output, "function pnoOperationalBuildTruth(row, totalRows, alreadyRows) {", "async function pnoOperationalLoadAllRaw(row, type, firstResult = null) {", builder, "V28 truth builder");
  const resolver = pnoV28Resolver.toString().replace("pnoV28Resolver", "pnoOperationalResolve") + "\n\n";
  output = replaceBetween(output, "async function pnoOperationalResolve(row) {", "function pnoOperationalPaginate(row, type, rows, page, pageSize = 200) {", resolver, "V28 resolver");
  return output;
}

export function patchTbrSeedV28Frontend(source) {
  let output = String(source || "");
  if (output.includes(TBR_FIELD_MARKER)) return output;
  output = replaceUnique(output, "fleet_sign_info: compactBusHarField(item?.fleet_sign_info, 2),", "fleet_sign_info: compactBusHarField(item?.fleet_sign_info, 6),", "preserve bounded TBR field candidates in HAR seed", TBR_FIELD_MARKER);
  output = replaceUnique(output, "// BUS_TIME_HAR_SEED_TRUTH_V26: a successful BusTime HAR response is already source data.", "// " + TBR_FIELD_MARKER + ": preserve up to 6 bounded fleet_sign_info values so labelled/later TBR data is not discarded.\n// BUS_TIME_HAR_SEED_TRUTH_V26: a successful BusTime HAR response is already source data.", "frontend TBR field marker", TBR_FIELD_MARKER);
  return output;
}

export function patchTbrSeedV28Worker(source) {
  let output = String(source || "");
  if (output.includes(TBR_FIELD_MARKER)) return output;
  output = replaceUnique(output, "fleet_sign_info: compactBusSeedField(item?.fleet_sign_info, 2),", "fleet_sign_info: compactBusSeedField(item?.fleet_sign_info, 6),", "preserve bounded TBR field candidates on Worker", TBR_FIELD_MARKER);
  output = replaceUnique(output, "// BUS_TIME_HAR_SEED_TRUTH_V26: explicit HAR upload is already a successful", "// " + TBR_FIELD_MARKER + ": retain bounded fleet_sign_info candidates for TBR parsing.\n// BUS_TIME_HAR_SEED_TRUTH_V26: explicit HAR upload is already a successful", "worker TBR field marker", TBR_FIELD_MARKER);
  return output;
}
