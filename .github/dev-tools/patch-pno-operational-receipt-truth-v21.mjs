const MARKER = "PNO_OPERATIONAL_RECEIPT_TRUTH_V21";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1)
    throw new Error(`${MARKER}: ${label} expected 1 match got ${matches.length}`);
  return source.replace(pattern, replacement);
}

export function patchPnoOperationalReceiptTruthV21(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_NOENTRY_DISPLAY_BAG_ACTION_V20"))
    throw new Error(`${MARKER}: V20 prerequisite missing`);

  output = replaceUnique(
    output,
    `// PNO_NOENTRY_DISPLAY_BAG_ACTION_V20: no_entry uses its authoritative category for contradictory inbound action display; Backing adds latest-action filter.`,
    `// PNO_NOENTRY_DISPLAY_BAG_ACTION_V20: Backing latest-action filter + mobile width compatibility.\n// ${MARKER}: correct receipt counts only from concrete own-HUB Backing rows whose real MS lastAction is สแกนเข้าคลัง; never rename MS actions.`,
    "marker",
  );

  output = replaceUnique(
    output,
    `function pnoV20NoEntryDisplayAction(item, type = pnoV18State.type) {\n  const raw = pnoV18TextValue(item?.lastAction);\n  if (type !== "no_entry") return raw;\n  if (!raw) return "ยังไม่เข้าคลัง";\n  if (/สแกน\\s*เข้าคลัง|scan.*(?:warehouse|hub|inbound)/i.test(raw))\n    return "ยังไม่เข้าคลัง";\n  return raw;\n}\n\nfunction pnoV18ParcelAction(item) {\n  return pnoV20NoEntryDisplayAction(item, pnoV18State.type);\n}`,
    `function pnoV18ParcelAction(item) {\n  return pnoV18TextValue(item?.lastAction);\n}`,
    "restore raw MS action",
  );

  const operationalRuntime = String.raw`
const PNO_OPERATIONAL_TRUTH_CACHE_MS = 60 * 1000;
const pnoOperationalTruthCache = new Map();
const pnoOperationalTruthActive = new Map();
const pnoOperationalEnteredRowsCache = new Map();
let pnoOperationalObserver = null;
let pnoOperationalObserveQueued = false;

function pnoOperationalNormalizePno(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function pnoOperationalHubMatches(targetHub, currentHub) {
  const target = String(targetHub ?? "").trim().toUpperCase();
  const hub = String(currentHub ?? "").trim().toUpperCase();
  if (!hub || !/^[A-Z0-9]{2,12}$/.test(hub)) return false;
  return new RegExp("(^|[^A-Z0-9])" + hub + "(?=_(?:B?HUB)\\b|[^A-Z0-9]|$)").test(target);
}

function pnoOperationalCandidate(item, row) {
  return Boolean(
    pnoOperationalNormalizePno(item?.pno) &&
    String(item?.backingNo || "").trim() &&
    String(item?.lastAction || "").trim() === "สแกนเข้าคลัง" &&
    pnoOperationalHubMatches(item?.targetHub, state.branch || row?.hub)
  );
}

function pnoOperationalRawSummary(row) {
  const expected = pnoCountForType(row, "total");
  const entered = pnoCountForType(row, "already");
  const pending = pnoCountForType(row, "no_entry");
  const valid = [expected, entered, pending].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0) &&
    Number(entered) + Number(pending) === Number(expected);
  return {
    expected: expected === null ? null : Number(expected),
    entered: entered === null ? null : Number(entered),
    pending: pending === null ? null : Number(pending),
    percent: valid && Number(expected) > 0 ? Number(entered) / Number(expected) * 100 : 0,
    correction: 0,
    candidateRows: [],
    candidatePnos: new Set(),
    remainingRows: null,
    valid,
  };
}

function pnoOperationalKey(row) {
  const raw = pnoOperationalRawSummary(row);
  return [
    pnoBrowserBaseKey(row, "no_entry"),
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

function pnoOperationalBuildTruth(row, noEntryRows) {
  const raw = pnoOperationalRawSummary(row);
  if (!raw.valid) return raw;
  const seen = new Set();
  const uniqueRows = [];
  const candidates = [];
  for (const item of Array.isArray(noEntryRows) ? noEntryRows : []) {
    const pno = pnoOperationalNormalizePno(item?.pno);
    if (!pno || seen.has(pno)) continue;
    seen.add(pno);
    uniqueRows.push(item);
    if (pnoOperationalCandidate(item, row)) candidates.push(item);
  }
  const correction = Math.min(
    candidates.length,
    raw.pending,
    Math.max(0, raw.expected - raw.entered),
  );
  const candidateRows = candidates.slice(0, correction);
  const candidatePnos = new Set(candidateRows.map((item) => pnoOperationalNormalizePno(item?.pno)));
  const correctedEntered = Math.min(raw.expected, raw.entered + correction);
  const correctedPending = Math.max(0, raw.expected - correctedEntered);
  return {
    expected: raw.expected,
    entered: correctedEntered,
    pending: correctedPending,
    percent: raw.expected > 0 ? correctedEntered / raw.expected * 100 : 0,
    correction,
    candidateRows,
    candidatePnos,
    remainingRows: uniqueRows.filter((item) => !candidatePnos.has(pnoOperationalNormalizePno(item?.pno))),
    valid: true,
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
  return { rows: total > 0 ? all.slice(0, total) : all, total, pageSize };
}

async function pnoOperationalResolve(row) {
  const raw = pnoOperationalRawSummary(row);
  if (!raw.valid || raw.pending <= 0 || row?.pnoEnabled !== true || row?.pnoState !== "OK") return raw;
  const key = pnoOperationalKey(row);
  const cached = pnoOperationalTruthCache.get(key);
  if (cached && Date.now() - cached.at < PNO_OPERATIONAL_TRUTH_CACHE_MS) return cached.truth;
  if (pnoOperationalTruthActive.has(key)) return pnoOperationalTruthActive.get(key);
  const task = (async () => {
    const loaded = await pnoOperationalLoadAllRaw(row, "no_entry");
    const truth = pnoOperationalBuildTruth(row, loaded.rows);
    if (pnoOperationalTruthCache.size >= 120) pnoOperationalTruthCache.clear();
    pnoOperationalTruthCache.set(key, { at: Date.now(), truth });
    return truth;
  })().finally(() => pnoOperationalTruthActive.delete(key));
  pnoOperationalTruthActive.set(key, task);
  return task;
}

function pnoOperationalPaginate(row, type, rows, page, pageSize = 200) {
  const current = Math.max(1, Number(page) || 1);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (Math.min(current, pages) - 1) * pageSize;
  return {
    proofId: row?.proofId || "",
    routeName: row?.routeName || "",
    type,
    page: Math.min(current, pages),
    pages,
    pageSize,
    total,
    parcels: rows.slice(start, start + pageSize),
    operationalTruth: true,
  };
}

async function pnoOperationalVirtualPage(row, type, page) {
  const truth = await pnoOperationalResolve(row);
  if (!truth?.valid || truth.correction <= 0) return null;
  if (type === "no_entry")
    return pnoOperationalPaginate(row, type, truth.remainingRows || [], page);
  if (type !== "already") return null;
  const key = pnoOperationalKey(row);
  let enteredRows = pnoOperationalEnteredRowsCache.get(key);
  if (!enteredRows) {
    const loaded = await pnoOperationalLoadAllRaw(row, "already");
    const merged = [];
    const seen = new Set();
    for (const item of [...loaded.rows, ...(truth.candidateRows || [])]) {
      const pno = pnoOperationalNormalizePno(item?.pno);
      if (!pno || seen.has(pno)) continue;
      seen.add(pno);
      merged.push(item);
    }
    enteredRows = merged;
    if (pnoOperationalEnteredRowsCache.size >= 80) pnoOperationalEnteredRowsCache.clear();
    pnoOperationalEnteredRowsCache.set(key, enteredRows);
  }
  return pnoOperationalPaginate(row, type, enteredRows, page);
}

function pnoOperationalRefreshCard(rowId, key) {
  const current = findPnoRowById(rowId);
  if (!current || pnoOperationalKey(current) !== key) return;
  render();
}

function pnoOperationalQueueResolve(row) {
  if (!row?.id) return;
  const raw = pnoOperationalRawSummary(row);
  if (!raw.valid || raw.pending <= 0 || row.pnoEnabled !== true || row.pnoState !== "OK") return;
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

  output = replaceRegexOnce(
    output,
    /function expectedParcelsBadge\(row\) \{[\s\S]*?\n\}\n\nfunction findPnoRowById/,
    `${operationalRuntime}\nfunction expectedParcelsBadge(row) {\n  if (row.pnoState === "UNAVAILABLE")\n    return '<div class="expected-parcels-badge pno-summary pno-empty"><strong>ไม่มีข้อมูลเข้าคลัง</strong><span>ไม่พบเที่ยวที่ตรงกับ Barcode จากแหล่งข้อมูลที่อ่านสำเร็จ</span></div>';\n  const truth = pnoOperationalSummaryForRow(row);\n  const expected = truth.expected;\n  const entered = truth.entered;\n  const pending = truth.pending;\n  if (expected === null || entered === null || pending === null)\n    return '<div class="expected-parcels-badge pno-summary pno-empty"><strong>ไม่มีข้อมูลเข้าคลัง</strong><span>ข้อมูล PreEntry ไม่ครบ จึงไม่คำนวณเปอร์เซ็นต์</span></div>';\n  const countsMatch = entered + pending === expected;\n  if (row.pnoState === "COUNT_MISMATCH" || !countsMatch)\n    return \`<div class="expected-parcels-badge pno-summary pno-warning"><div class="pno-metrics"><span><small>พัสดุทั้งหมด</small><b>\${nf.format(expected)}</b></span><span><small>เข้าคลังแล้ว</small><b>\${nf.format(entered)}</b></span><span><small>คงเหลือ</small><b>\${nf.format(pending)}</b></span></div><strong>ข้อมูลจำนวนไม่สมบูรณ์</strong><span>ยังไม่คำนวณเปอร์เซ็นต์และไม่เปิด PNO</span></div>\`;\n  const percent = Math.max(0, Math.min(100, Number(truth.percent) || 0));\n  const rowId = esc(row.id || "");\n  const enabled = row.pnoEnabled === true && rowId;\n  if (enabled && pending > 0 && !pnoOperationalTruthFresh(row)) pnoOperationalObserveSoon();\n  const alreadyButton = enabled && entered > 0\n    ? \`<button type="button" data-pno-row="\${rowId}" data-pno-type="already" aria-label="ดู PNO ที่เข้าคลังแล้ว"><small>เข้าคลังแล้ว</small><b>\${nf.format(entered)}</b></button>\`\n    : \`<span><small>เข้าคลังแล้ว</small><b>\${nf.format(entered)}</b></span>\`;\n  const pendingButton = enabled && pending > 0\n    ? \`<button type="button" data-pno-row="\${rowId}" data-pno-type="no_entry" aria-label="ดู PNO คงเหลือ"><small>คงเหลือ</small><b>\${nf.format(pending)}</b></button>\`\n    : \`<span><small>คงเหลือ</small><b>\${nf.format(pending)}</b></span>\`;\n  const scale = Math.max(0, Math.min(1, percent / 100)).toFixed(4);\n  const attr = enabled ? ' data-pno-operational-row="' + rowId + '"' : "";\n  return \`<div class="expected-parcels-badge pno-summary \${pnoProgressClass(percent)}"\${attr}><div class="pno-metrics"><span><small>พัสดุทั้งหมด</small><b>\${nf.format(expected)}</b></span>\${alreadyButton}\${pendingButton}</div><div class="pno-progress-head"><strong>\${pnoDisplayPercent(percent)}</strong><span>\${pnoProgressStatus(percent)} · เป้า 90%</span></div><div class="pno-progress-track" aria-label="เข้าคลังแล้ว \${pnoDisplayPercent(percent)}"><span class="pno-progress-fill" style="--pno-progress:\${scale}"></span><i class="pno-progress-marker" title="เป้าหมาย 90%"></i></div></div>\`;\n}\n\nfunction findPnoRowById`,
    "operational card truth",
  );

  output = replaceUnique(
    output,
    `function pnoV18RenderSummary() {\n  const row = pnoV18SourceRow();\n  const total = pnoV18Number(row?.expectedParcels);\n  const entered = pnoV18Number(row?.enteredParcels);\n  const pending = pnoV18Number(row?.pendingParcels);`,
    `function pnoV18RenderSummary() {\n  const row = pnoV18SourceRow();\n  const truth = pnoOperationalSummaryForRow(row);\n  const total = truth.expected;\n  const entered = truth.entered;\n  const pending = truth.pending;`,
    "modal summary truth",
  );

  output = replaceUnique(
    output,
    `  const result = await browserPnoPage(sourceRow, type, page, force);\n  return pnoV18CacheSet(pnoV18ViewCache, cacheKey, result, 120);`,
    `  const virtual = !force && (type === "already" || type === "no_entry")\n    ? await pnoOperationalVirtualPage(sourceRow, type, page)\n    : null;\n  const result = virtual || await browserPnoPage(sourceRow, type, page, force);\n  return pnoV18CacheSet(pnoV18ViewCache, cacheKey, result, 120);`,
    "modal virtual truth page",
  );

  return output;
}
