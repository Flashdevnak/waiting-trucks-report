const MARKER = "PNO_OWN_HUB_BACKING_SINGLE_TRUTH_V24";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoOwnHubSingleTruthV24(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_PENDING_TOTAL_INTERSECTION_V23"))
    throw new Error(`${MARKER}: V23 prerequisite missing`);

  output = replaceUnique(
    output,
    `// PNO_PENDING_TOTAL_INTERSECTION_V23: pending PNO membership is authoritative; when no_entry omits Backing metadata, enrich only those pending PNOs from total before correction.`,
    `// ${MARKER}: one clean operational-truth authority. MS total is the universe, MS already is the baseline entered set, and only own-HUB Backing rows with real lastAction=สแกนเข้าคลัง can correct receipt counts.`,
    "replace V23 correction authority marker",
  );

  const start = output.indexOf("const PNO_OPERATIONAL_TRUTH_CACHE_MS = 60 * 1000;");
  const end = output.indexOf("\nfunction expectedParcelsBadge", start);
  if (start < 0 || end < 0)
    throw new Error(`${MARKER}: operational runtime boundary missing`);

  const runtime = String.raw`const PNO_OPERATIONAL_TRUTH_CACHE_MS = 60 * 1000;
const pnoOperationalTruthCache = new Map();
const pnoOperationalTruthActive = new Map();
const pnoOperationalEnteredRowsCache = new Map();
let pnoOperationalObserver = null;
let pnoOperationalObserveQueued = false;

function pnoOperationalInboundEligible(row) {
  return Boolean(row && (isDestination(row) || isDrop(row)));
}

function pnoOperationalNormalizePno(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function pnoOperationalCanonicalHub(value) {
  let text = String(value ?? "").trim().toUpperCase();
  if (!text) return "";
  const named = text.match(/(?:^|[\s-])([A-Z0-9]+)_(?:B?HUB)\b/);
  if (named?.[1]) return named[1];
  text = text.replace(/^\d+\s+/, "");
  const simple = text.match(/^([A-Z0-9]+)/);
  return simple?.[1] || "";
}

function pnoOperationalCurrentHub() {
  const hub = pnoOperationalCanonicalHub(state.branch);
  if (!hub || hub === "ALL" || hub === "ทั้งหมด") return "";
  return hub;
}

function pnoOperationalHubMatches(targetHub) {
  const current = pnoOperationalCurrentHub();
  if (!current) return false;
  return pnoOperationalCanonicalHub(targetHub) === current;
}

function pnoOperationalCandidate(item) {
  return Boolean(
    pnoOperationalNormalizePno(item?.pno) &&
    String(item?.backingNo || "").trim() &&
    String(item?.lastAction || "").trim() === "สแกนเข้าคลัง" &&
    pnoOperationalHubMatches(item?.targetHub)
  );
}

function pnoOperationalRawSummary(row) {
  const expected = pnoCountForType(row, "total");
  const entered = pnoCountForType(row, "already");
  const pending = pnoCountForType(row, "no_entry");
  const valid = [expected, entered, pending].every((value) =>
    Number.isFinite(Number(value)) && Number(value) >= 0
  ) && Number(entered) + Number(pending) === Number(expected);
  return {
    expected: expected === null ? null : Number(expected),
    entered: entered === null ? null : Number(entered),
    pending: pending === null ? null : Number(pending),
    percent: valid && Number(expected) > 0 ? Number(entered) / Number(expected) * 100 : 0,
    correction: 0,
    candidateRows: [],
    candidatePnos: new Set(),
    enteredRows: null,
    remainingRows: null,
    valid,
    verified: false,
    reason: valid ? "RAW_ONLY" : "RAW_SUMMARY_INVALID",
  };
}

function pnoOperationalKey(row) {
  const raw = pnoOperationalRawSummary(row);
  return [
    pnoBrowserBaseKey(row, "total"),
    pnoOperationalCurrentHub(),
    raw.expected, raw.entered, raw.pending,
  ].join("|");
}

function pnoOperationalTruthEntry(row) {
  return pnoOperationalTruthCache.get(pnoOperationalKey(row)) || null;
}

function pnoOperationalTruthFresh(row) {
  const entry = pnoOperationalTruthEntry(row);
  return Boolean(entry && Date.now() - entry.at < PNO_OPERATIONAL_TRUTH_CACHE_MS);
}

function pnoOperationalSummaryForRow(row) {
  const entry = pnoOperationalTruthEntry(row);
  return entry?.truth || pnoOperationalRawSummary(row);
}

function pnoOperationalUniqueMap(rows) {
  const map = new Map();
  for (const item of Array.isArray(rows) ? rows : []) {
    const pno = pnoOperationalNormalizePno(item?.pno);
    if (!pno || map.has(pno)) continue;
    map.set(pno, item);
  }
  return map;
}

function pnoOperationalBuildTruth(row, totalRows, alreadyRows) {
  const raw = pnoOperationalRawSummary(row);
  if (!raw.valid || !pnoOperationalInboundEligible(row)) return raw;

  const currentHub = pnoOperationalCurrentHub();
  if (!currentHub) return { ...raw, reason: "CURRENT_HUB_UNRESOLVED" };

  const totalMap = pnoOperationalUniqueMap(totalRows);
  const alreadyMap = pnoOperationalUniqueMap(alreadyRows);

  if (totalMap.size !== raw.expected)
    return { ...raw, reason: "TOTAL_DETAIL_COUNT_MISMATCH" };
  if (alreadyMap.size !== raw.entered)
    return { ...raw, reason: "ALREADY_DETAIL_COUNT_MISMATCH" };

  for (const pno of alreadyMap.keys()) {
    if (!totalMap.has(pno))
      return { ...raw, reason: "ALREADY_NOT_SUBSET_OF_TOTAL" };
  }

  const candidates = [];
  for (const [pno, item] of totalMap.entries()) {
    if (alreadyMap.has(pno)) continue;
    if (pnoOperationalCandidate(item)) candidates.push(item);
  }

  const correction = Math.min(
    candidates.length,
    raw.pending,
    Math.max(0, raw.expected - raw.entered),
  );
  const candidateRows = candidates.slice(0, correction);
  const candidatePnos = new Set(
    candidateRows.map((item) => pnoOperationalNormalizePno(item?.pno))
  );

  const enteredRows = [];
  const remainingRows = [];
  for (const [pno, item] of totalMap.entries()) {
    if (alreadyMap.has(pno) || candidatePnos.has(pno)) enteredRows.push(item);
    else remainingRows.push(item);
  }

  const correctedEntered = enteredRows.length;
  const correctedPending = remainingRows.length;

  if (
    correctedEntered !== raw.entered + correction ||
    correctedPending !== raw.expected - correctedEntered ||
    correctedEntered + correctedPending !== raw.expected
  ) {
    return { ...raw, reason: "CORRECTED_DETAIL_COUNT_MISMATCH" };
  }

  return {
    expected: raw.expected,
    entered: correctedEntered,
    pending: correctedPending,
    percent: raw.expected > 0 ? correctedEntered / raw.expected * 100 : 0,
    correction,
    candidateRows,
    candidatePnos,
    enteredRows,
    remainingRows,
    valid: true,
    verified: true,
    reason: correction > 0 ? "OWN_HUB_BACKING_CORRECTED" : "MS_COUNTS_CONFIRMED",
    currentHub,
  };
}

async function pnoOperationalLoadAllRaw(row, type, firstResult = null) {
  const first = firstResult || await browserPnoPage(row, type, 1, false);
  const total = Math.max(0, Number(first?.total) || (first?.parcels || []).length);
  const pageSize = Math.max(1, Number(first?.pageSize) || 200);
  const pages = Math.max(1, Number(first?.pages) || Math.ceil(total / pageSize) || 1);
  const all = [...(Array.isArray(first?.parcels) ? first.parcels : [])];
  for (let page = 2; page <= pages; page += 1) {
    const result = await browserPnoPage(row, type, page, false);
    all.push(...(Array.isArray(result?.parcels) ? result.parcels : []));
  }
  return { rows: total > 0 ? all.slice(0, total) : all, total, pageSize, pages };
}

async function pnoOperationalResolve(row) {
  const raw = pnoOperationalRawSummary(row);
  if (
    !pnoOperationalInboundEligible(row) ||
    !raw.valid ||
    raw.pending <= 0 ||
    row?.pnoEnabled !== true ||
    row?.pnoState !== "OK" ||
    !pnoOperationalCurrentHub()
  ) return raw;

  const key = pnoOperationalKey(row);
  const cached = pnoOperationalTruthCache.get(key);
  if (cached && Date.now() - cached.at < PNO_OPERATIONAL_TRUTH_CACHE_MS)
    return cached.truth;
  if (pnoOperationalTruthActive.has(key))
    return pnoOperationalTruthActive.get(key);

  const task = (async () => {
    const total = await pnoOperationalLoadAllRaw(row, "total");
    const totalMap = pnoOperationalUniqueMap(total.rows);

    if (totalMap.size !== raw.expected) {
      const truth = { ...raw, reason: "TOTAL_DETAIL_COUNT_MISMATCH" };
      pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
      return truth;
    }

    const ownHubCandidatesExist = [...totalMap.values()].some((item) =>
      pnoOperationalCandidate(item)
    );

    if (!ownHubCandidatesExist) {
      const truth = {
        ...raw,
        verified: true,
        reason: "NO_OWN_HUB_BACKING_EXCEPTION",
        enteredRows: null,
        remainingRows: null,
      };
      pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
      return truth;
    }

    const already = await pnoOperationalLoadAllRaw(row, "already");
    const truth = pnoOperationalBuildTruth(row, total.rows, already.rows);
    if (pnoOperationalTruthCache.size >= 120) pnoOperationalTruthCache.clear();
    pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
    if (truth.verified && Array.isArray(truth.enteredRows))
      pnoOperationalEnteredRowsCache.set(key, truth.enteredRows);
    return truth;
  })().finally(() => pnoOperationalTruthActive.delete(key));

  pnoOperationalTruthActive.set(key, task);
  return task;
}

function pnoOperationalPaginate(row, type, rows, page, pageSize = 200) {
  const current = Math.max(1, Number(page) || 1);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(current, pages));
  const start = (safePage - 1) * pageSize;
  return {
    proofId: row?.proofId || "",
    routeName: row?.routeName || "",
    type,
    page: safePage,
    pages,
    pageSize,
    total,
    parcels: rows.slice(start, start + pageSize),
    operationalTruth: true,
  };
}

async function pnoOperationalVirtualPage(row, type, page) {
  const truth = await pnoOperationalResolve(row);
  if (!truth?.verified || truth.correction <= 0) return null;
  if (type === "no_entry")
    return pnoOperationalPaginate(row, type, truth.remainingRows || [], page);
  if (type === "already")
    return pnoOperationalPaginate(row, type, truth.enteredRows || [], page);
  return null;
}

function pnoOperationalRefreshCard(rowId, key) {
  const current = findPnoRowById(rowId);
  if (!current || pnoOperationalKey(current) !== key) return;
  render();
}

function pnoOperationalQueueResolve(row) {
  if (!row?.id || !pnoOperationalInboundEligible(row)) return;
  const raw = pnoOperationalRawSummary(row);
  if (
    !raw.valid ||
    raw.pending <= 0 ||
    row.pnoEnabled !== true ||
    row.pnoState !== "OK" ||
    !pnoOperationalCurrentHub()
  ) return;
  const key = pnoOperationalKey(row);
  if (pnoOperationalTruthFresh(row) || pnoOperationalTruthActive.has(key)) return;
  void pnoOperationalResolve(row)
    .then(() => pnoOperationalRefreshCard(String(row.id), key))
    .catch(() => {});
}

function pnoOperationalObserveCards() {
  pnoOperationalObserveQueued = false;
  const nodes = [...document.querySelectorAll("[data-pno-operational-row]")];
  if (!nodes.length) return;
  if (typeof IntersectionObserver !== "function") {
    nodes.forEach((node) => {
      const row = findPnoRowById(node.dataset.pnoOperationalRow);
      if (row) pnoOperationalQueueResolve(row);
    });
    return;
  }
  if (!pnoOperationalObserver) {
    pnoOperationalObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        pnoOperationalObserver.unobserve(entry.target);
        const row = findPnoRowById(entry.target.dataset.pnoOperationalRow);
        if (row) pnoOperationalQueueResolve(row);
      });
    }, { rootMargin: "120px 0px" });
  }
  nodes.forEach((node) => pnoOperationalObserver.observe(node));
}

function pnoOperationalObserveSoon() {
  if (pnoOperationalObserveQueued) return;
  pnoOperationalObserveQueued = true;
  queueMicrotask(pnoOperationalObserveCards);
}
`;

  output = output.slice(0, start) + runtime + output.slice(end);
  return output;
}
