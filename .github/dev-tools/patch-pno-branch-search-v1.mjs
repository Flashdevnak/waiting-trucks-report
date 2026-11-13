// DEV-only UX: search large destination/next-branch pickers without touching parcel identity or data.
const MARKER = 'PNO_BRANCH_SEARCH_V1';

export function pnoBranchSearchChoices(values, query, chosen, limit = 15) {
  const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('th-TH').trim();
  const needle = normalize(query);
  const source = Array.isArray(values) ? values : [];
  const matches = source.filter((value) =>
    normalize(value).includes(needle) ||
    normalize(String(value).replace(/^\(TH[^)]*\)\s*/i, '')).includes(needle));
  const visible = matches.slice(0, limit);
  // Preserve the exact selected R-column value even when its display prefix is removed.
  if (chosen && source.includes(chosen) && !visible.includes(chosen)) visible.push(chosen);
  return { visible, matches, matchCount: matches.length, total: source.length };
}

function replaceExactlyOne(s, from, to, description) {
  const pos = s.indexOf(from);
  if (pos < 0 || s.indexOf(from, pos + from.length) !== -1)
    throw new Error(`${MARKER}: ${description} anchor missing or duplicated`);
  return s.slice(0, pos) + to + s.slice(pos + from.length);
}

export function patchPnoBranchSearchFrontend(source) {
  let output = String(source ?? '');
  if (output.includes(`// ${MARKER}: searchable`)) return output;
  if (!output.includes('PNO_SEGMENT_DESTINATION_FRONTEND_V1'))
    throw new Error(`${MARKER}: PNO segment destination prerequisite missing`);
  const start = output.indexOf('function pnoV18RenderFilters() {');
  const end = output.indexOf('\n}\n', start) + 2;
  if (start < 0 || end < 2) throw new Error(`${MARKER}: final filter function unavailable`);
  let fn = output.slice(start, end);
  fn = replaceExactlyOne(fn, 'function pnoV18RenderFilters() {',
    'function pnoV18RenderFilters() {\n  ' + pnoBranchSearchChoices.toString().replaceAll('\n', '\n  '), 'scoped helper for UI tests');
  fn = replaceExactlyOne(fn,
    '  const type = pnoV18State.type;',
    '  const type = pnoV18State.type;\n  if (pnoV18State.branchSearchType !== type) {\n    pnoV18State.branchSearchQuery = \"\";\n    pnoV18State.branchSearchType = type;\n  }',
    'reset search on view switch');
  fn = replaceExactlyOne(fn,
    '  const fields = [["status", "สถานะ", statuses]',
    '  const branchChoices = pnoBranchSearchChoices(branches, pnoV18State.branchSearchQuery || "", filters.branch);\n' +
    '  const fields = [["status", "สถานะ", statuses]',
    'branch selection limit');
  fn = replaceExactlyOne(fn,
    "'<label class=\"pno-v18-filter-field\"><span>' + esc(label) + '</span><select id=\"pno-v18-filter-' + key +",
    "'<label class=\"pno-v18-filter-field\"><span>' + esc(label) + '</span>' +\n" +
    "    (key === 'branch' ? '<input id=\"pno-v18-branch-search\" class=\"pno-v18-branch-search\" type=\"search\" autocomplete=\"off\" placeholder=\"พิมพ์รหัสหรือชื่อสาขา…\" aria-label=\"ค้นหาสาขาปลายทาง\" value=\"' + esc(pnoV18State.branchSearchQuery || '') + '\"' + (complete ? '' : ' disabled') + '>' : '') +\n" +
    "    '<select id=\"pno-v18-filter-' + key +",
    'search input insertion');
  fn = replaceExactlyOne(fn,
    'values.map((value) => key === "branch"',
    '(key === "branch" ? branchChoices.visible : values).map((value) => key === "branch"',
    'limited visible suggestions');
  fn = replaceExactlyOne(fn, "'</select></label>'",
    "'</select>' + (key === 'branch' ? '<small id=\"pno-v18-branch-count\" aria-live=\"polite\"></small>' : '') + '</label>'",
    'branch match count');
  fn = replaceExactlyOne(fn, '  bar.classList.remove("hidden");', `  bar.classList.remove("hidden");
  if (typeof document !== "undefined" && !document.getElementById("pno-v18-branch-search-style")) {
    const style = document.createElement("style");
    style.id = "pno-v18-branch-search-style";
    style.textContent = '.ms-page .pno-v18-filter-field .pno-v18-branch-search{height:36px;width:100%;min-width:0;padding:6px 9px;border:1px solid #b7bec4;border-radius:6px;background:#fff;color:#202124;font-size:13px}.ms-page .pno-v18-filter-field .pno-v18-branch-search:focus{outline:2px solid #f6cb12;outline-offset:1px}.ms-page .pno-v18-filter-field #pno-v18-branch-count{color:#667078;font-size:10px;line-height:1.4}.ms-page .pno-v18-filter-field:has(.pno-v18-branch-search){min-width:220px;max-width:280px}';
    document.head.appendChild(style);
  }
  const branchSearch = typeof bar.querySelector === "function" ? bar.querySelector("#pno-v18-branch-search") : null;
  const branchSelect = typeof bar.querySelector === "function" ? bar.querySelector("#pno-v18-filter-branch") : null;
  const branchCount = typeof bar.querySelector === "function" ? bar.querySelector("#pno-v18-branch-count") : null;
  function refreshBranchSearch(query) {
    const choice = pnoBranchSearchChoices(branches, query, filters.branch);
    if (branchSelect && complete) {
      branchSelect.innerHTML = '<option value="">ทั้งหมด</option>' + choice.visible.map((value) =>
        '<option value="' + esc(value) + '"' + (value === filters.branch ? ' selected' : '') + '>' +
        esc(type === "bag" ? value : pnoV18DisplayBranch(value)) + '</option>').join('') +
        (choice.matchCount > 15 ? '<option disabled>พิมพ์เพื่อค้นหารายการอื่น…</option>' : '');
    }
    if (branchCount) branchCount.textContent = 'พบ ' + nf.format(choice.matchCount) +
      ' จาก ' + nf.format(choice.total) + ' สาขา' + (choice.matchCount > 15 ? ' · แสดง 15 รายการแรก' : '');
    return choice;
  }
  refreshBranchSearch(pnoV18State.branchSearchQuery || "");
  if (branchSearch && complete) {
    branchSearch.oninput = () => {
      pnoV18State.branchSearchQuery = branchSearch.value;
      refreshBranchSearch(branchSearch.value);
    };
    branchSearch.onkeydown = (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); branchSelect?.focus(); }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const matches = pnoBranchSearchChoices(branches, branchSearch.value, filters.branch).matches;
      if (matches.length === 1) {
        filters.branch = matches[0];
        pnoV18State.filterPage = 1;
        pnoV18RenderFilters();
        pnoV18RenderCurrentFilteredView();
      } else branchSelect?.focus();
    };
  }`, 'search input behavior');
  fn = replaceExactlyOne(fn,
    '      filters[field] = select.value;',
    '      filters[field] = select.value;\n      if (field === "hub") pnoV18State.branchSearchQuery = "";',
    'hub cascade query reset');
  fn = replaceExactlyOne(fn,
    '    filters.branch = "";\n    pnoV18State.filterPage = 1;',
    '    filters.branch = "";\n    pnoV18State.branchSearchQuery = "";\n    pnoV18State.filterPage = 1;',
    'clear query with reset');
  output = output.slice(0, start) + fn + output.slice(end);
  output = output.slice(0, start) + '// '+ MARKER + ': searchable; bounded list; exact branch identity.\n' + output.slice(start);
  const opened = output.indexOf('openPendingParcels = async function pnoV18OpenPendingParcels(');
  if (opened > 0) {
    const before = output.slice(0, opened), after = output.slice(opened);
    output = before + replaceExactlyOne(after, '  pnoV18EnsureUi();', '  pnoV18EnsureUi();\n  pnoV18State.branchSearchQuery = "";', 'new modal search reset');
  }
  return output;
}
