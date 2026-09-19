const MARKER = "PNO_NOENTRY_DISPLAY_BAG_ACTION_V20";

function replaceUnique(source, from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`${MARKER}: ${label} anchor missing or non-unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

export function patchPnoNoEntryBagActionV20(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_GLOBAL_FILTER_V19"))
    throw new Error(`${MARKER}: V19 prerequisite missing`);

  output = replaceUnique(
    output,
    `// PNO_GLOBAL_FILTER_V19: exact all-page filtering is triggered only by an explicit filter change.`,
    `// PNO_GLOBAL_FILTER_V19: exact all-page filtering is triggered only by an explicit filter change.
// ${MARKER}: no_entry uses its authoritative category for contradictory inbound action display; Backing adds latest-action filter.`,
    "marker",
  );

  output = replaceUnique(
    output,
    `    bagStatus: "",
    bagHub: "",`,
    `    bagStatus: "",
    bagAction: "",
    bagHub: "",`,
    "bag action state",
  );

  output = replaceUnique(
    output,
    `function pnoV18ParcelAction(item) {
  return pnoV18TextValue(item?.lastAction);
}`,
    `function pnoV20NoEntryDisplayAction(item, type = pnoV18State.type) {
  const raw = pnoV18TextValue(item?.lastAction);
  if (type !== "no_entry") return raw;
  if (!raw) return "ยังไม่เข้าคลัง";
  if (/สแกน\\s*เข้าคลัง|scan.*(?:warehouse|hub|inbound)/i.test(raw))
    return "ยังไม่เข้าคลัง";
  return raw;
}

function pnoV18ParcelAction(item) {
  return pnoV20NoEntryDisplayAction(item, pnoV18State.type);
}`,
    "no-entry display action",
  );

  output = replaceUnique(
    output,
    `function pnoV18FilteredBagGroups(rows = pnoV18State.bagRows || []) {
  const status = pnoV18State.filters.bagStatus;
  const hub = pnoV18State.filters.bagHub;
  const branch = pnoV18State.filters.bagBranch;
  return pnoV18BagGroups(rows).filter(([, items]) => {
    const summary = pnoV18BagSummary(items);
    return (!status || summary.status === status) &&
      (!hub || summary.hub === hub) &&
      (!branch || summary.branch === branch);
  });
}`,
    `function pnoV18FilteredBagGroups(rows = pnoV18State.bagRows || []) {
  const status = pnoV18State.filters.bagStatus;
  const action = pnoV18State.filters.bagAction;
  const hub = pnoV18State.filters.bagHub;
  const branch = pnoV18State.filters.bagBranch;
  return pnoV18BagGroups(rows).filter(([, items]) => {
    const summary = pnoV18BagSummary(items);
    return (!status || summary.status === status) &&
      (!action || summary.latest === action) &&
      (!hub || summary.hub === hub) &&
      (!branch || summary.branch === branch);
  });
}`,
    "bag action predicate",
  );

  output = replaceUnique(
    output,
    `  if (pnoV18State.type === "bag") return Boolean(f.bagStatus || f.bagHub || f.bagBranch);`,
    `  if (pnoV18State.type === "bag") return Boolean(f.bagStatus || f.bagAction || f.bagHub || f.bagBranch);`,
    "bag active filter",
  );

  output = replaceUnique(
    output,
    `    if (f.bagStatus) parts.push("สถานะ=" + f.bagStatus);
    if (f.bagHub) parts.push("HUB=" + f.bagHub);`,
    `    if (f.bagStatus) parts.push("สถานะ=" + f.bagStatus);
    if (f.bagAction) parts.push("ล่าสุด=" + f.bagAction);
    if (f.bagHub) parts.push("HUB=" + f.bagHub);`,
    "bag filter summary",
  );

  output = replaceUnique(
    output,
    `    const statuses = pnoV18UniqueValues(summaries.map((item) => item.status));
    const hubs = pnoV18UniqueValues(summaries.map((item) => item.hub));`,
    `    const statuses = pnoV18UniqueValues(summaries.map((item) => item.status));
    const actions = pnoV18UniqueValues(summaries.map((item) => item.latest));
    const hubs = pnoV18UniqueValues(summaries.map((item) => item.hub));`,
    "bag action options",
  );

  output = replaceUnique(
    output,
    `    pnoV18State.filters.bagStatus = pnoV18ValidateFilter(pnoV18State.filters.bagStatus, statuses);
    pnoV18State.filters.bagHub = pnoV18ValidateFilter(pnoV18State.filters.bagHub, hubs);`,
    `    pnoV18State.filters.bagStatus = pnoV18ValidateFilter(pnoV18State.filters.bagStatus, statuses);
    pnoV18State.filters.bagAction = pnoV18ValidateFilter(pnoV18State.filters.bagAction, actions);
    pnoV18State.filters.bagHub = pnoV18ValidateFilter(pnoV18State.filters.bagHub, hubs);`,
    "bag action validate",
  );

  output = replaceUnique(
    output,
    `      ["pno-v18-filter-bag-status", "สถานะถุง", statuses, pnoV18State.filters.bagStatus, "bagStatus"],
      ["pno-v18-filter-bag-hub", "HUB ถัดไป", hubs, pnoV18State.filters.bagHub, "bagHub"],`,
    `      ["pno-v18-filter-bag-status", "สถานะถุง", statuses, pnoV18State.filters.bagStatus, "bagStatus"],
      ["pno-v18-filter-bag-action", "การดำเนินการล่าสุด", actions, pnoV18State.filters.bagAction, "bagAction"],
      ["pno-v18-filter-bag-hub", "HUB ถัดไป", hubs, pnoV18State.filters.bagHub, "bagHub"],`,
    "bag action field",
  );

  output = replaceUnique(
    output,
    `      pnoV18State.filters.bagStatus = "";
      pnoV18State.filters.bagHub = "";`,
    `      pnoV18State.filters.bagStatus = "";
      pnoV18State.filters.bagAction = "";
      pnoV18State.filters.bagHub = "";`,
    "bag action reset",
  );

  const statusReturn = `    const status = pnoV18ParcelStatus(item, type);
    return `;
  const actionReturn = `    const status = pnoV18ParcelStatus(item, type);
    const action = pnoV18ParcelAction(item);
    return `;
  const occurrences = output.split(statusReturn).length - 1;
  if (occurrences !== 2)
    throw new Error(`${MARKER}: parcel render status anchors expected 2 got ${occurrences}`);
  output = output.split(statusReturn).join(actionReturn);

  const rawActionRender = `pnoV18ActionClass(item.lastAction) + '">' + esc(item.lastAction || "-")`;
  const renderCount = output.split(rawActionRender).length - 1;
  if (renderCount !== 2)
    throw new Error(`${MARKER}: raw parcel action render anchors expected 2 got ${renderCount}`);
  output = output.split(rawActionRender).join(`pnoV18ActionClass(action) + '">' + esc(action || "-")`);

  output = replaceUnique(
    output,
    `        pnoV18ParcelStatus(row),
        row.lastAction || "",`,
    `        pnoV18ParcelStatus(row),
        pnoV18ParcelAction(row),`,
    "copy derived action",
  );

  output = replaceUnique(
    output,
    `      " | " + pnoV18LineCell(pnoV18ParcelStatus(row)) +
      " | " + pnoV18LineCell(row.lastAction) +`,
    `      " | " + pnoV18LineCell(pnoV18ParcelStatus(row)) +
      " | " + pnoV18LineCell(pnoV18ParcelAction(row)) +`,
    "LINE derived action",
  );

  output = replaceUnique(
    output,
    `    "การดำเนินการล่าสุด": row.lastAction || "",`,
    `    "การดำเนินการล่าสุด": pnoV18ParcelAction(row),`,
    "export derived action",
  );

  output = replaceUnique(
    output,
    `.ms-page .pno-v18-filter-field{min-width:0}.ms-page .pno-v18-filter-result`,
    `.ms-page .pno-v18-filter-field{min-width:0}.ms-page .pno-v18-filter-field select{width:100%;min-width:0}.ms-page .pno-v18-filter-result`,
    "mobile filter select width",
  );

  output = replaceUnique(
    output,
    `  pnoV18State.filters.bagStatus = "";
  pnoV18State.filters.bagHub = "";`,
    `  pnoV18State.filters.bagStatus = "";
  pnoV18State.filters.bagAction = "";
  pnoV18State.filters.bagHub = "";`,
    "open bag action reset",
  );

  return output;
}
