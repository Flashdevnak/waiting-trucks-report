// Local candidate: PNO modal ownership only. No new endpoint, timer or quota.
// Existing partial diagnostic VMs may omit the modal lifecycle helpers; the full
// staged product always includes the helpers below and is tested as composed.
export const PNO_ASYNC_LIFECYCLE_MARKER = 'WTR008_PNO_ASYNC_LIFECYCLE_V1';
const helpers = String.raw`
// WTR008_PNO_ASYNC_LIFECYCLE_V1: local modal generation/request ownership.
function pnoAsyncContext() {
  if (!pnoV18State.asyncLifecycle) pnoV18State.asyncLifecycle =
    { generation: 0, request: 0, open: false, opening: false, tail: Promise.resolve() };
  return pnoV18State.asyncLifecycle;
}
function pnoAsyncCapture() {
  const life = pnoV18State.asyncLifecycle;
  if (!life) return null; // Pure component diagnostics did not open a modal.
  const row = pnoV18SourceRow();
  return { generation: life.generation, request: life.request,
    hub: String(state.branch || ''), key: row ? pnoV18LocatorKey(row) : '' };
}
function pnoAsyncOwn(owner) {
  if (!owner) return true;
  const life = pnoV18State.asyncLifecycle, row = pnoV18SourceRow();
  return Boolean(life?.open && owner.generation === life.generation &&
    owner.request === life.request && owner.hub === String(state.branch || '') &&
    owner.key === (row ? pnoV18LocatorKey(row) : ''));
}
function pnoAsyncCancelled() {
  const error = new Error('PNO request no longer owns this modal');
  error.code = 'PNO_LOCAL_ASYNC_CANCELLED';
  return error;
}
function pnoAsyncInvalidate() {
  const life = pnoV18State.asyncLifecycle;
  if (!life) return;
  life.generation += 1; life.request += 1; life.open = false; life.opening = false;
  pnoV18State.busy = false; pnoV18State.filterPromise = null;
}
function pnoAsyncBeginOpen() {
  const life = pnoAsyncContext();
  life.generation += 1; life.request += 1; life.open = true; life.opening = true;
  pnoV18State.busy = false; pnoV18State.filterPromise = null;
}
function pnoAsyncBeginView() {
  const life = pnoV18State.asyncLifecycle;
  if (!life) return null;
  if (life.open) {
    life.request += 1; pnoV18State.busy = false; pnoV18State.filterPromise = null;
  }
  return pnoAsyncCapture();
}
function pnoAsyncHoldNoPrefetch() {
  const life = pnoAsyncContext();
  if (!life.noPrefetchCount) life.priorNoPrefetch = pnoReadOnlyExplicitNoPrefetch;
  life.noPrefetchCount = (life.noPrefetchCount || 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true; life.noPrefetchCount -= 1;
    if (!life.noPrefetchCount) pnoReadOnlyExplicitNoPrefetch = life.priorNoPrefetch;
  };
}
function pnoAsyncActionSignature() {
  return JSON.stringify([pnoV18State.type, pnoV18State.page, pnoV18State.filterPage,
    pnoV18State.selection, pnoV18State.segmentSignature, pnoV18State.expandedBag,
    pnoV18State.filters]);
}
async function pnoAsyncPage(row, type, page, force, owner) {
  if (!owner) return browserPnoPage(row, type, page, force);
  const life = pnoAsyncContext();
  // Serialize only existing explicit modal page acquisitions. Superseded queued
  // jobs stop before the original provider boundary; an in-flight request is not
  // claimed to be physically aborted. No retry, prefetch or polling is added.
  const task = life.tail.then(async () => {
    if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
    const result = await browserPnoPage(row, type, page, force);
    if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
    return result;
  });
  life.tail = task.then(() => undefined, () => undefined);
  return task;
}
`;
function replaceOne(source, from, to, label) {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + from.length) >= 0)
    throw Error(PNO_ASYNC_LIFECYCLE_MARKER + ': missing/duplicate ' + label);
  return source.slice(0, at) + to + source.slice(at + from.length);
}
export function patchPnoAsyncLifecycle(source) {
  let output = String(source || '');
  if (output.includes('// WTR008_PNO_ASYNC_LIFECYCLE_V1:')) return output;
  if (!output.includes('PNO_MOBILE_MODAL_SCOPE_V1: applied'))
    throw Error(PNO_ASYNC_LIFECYCLE_MARKER + ': final PNO prerequisites missing');
  const edit = (name, transform) => {
    const prefix = output.includes('async function ' + name + '(') ? 'async function ' + name + '(' : 'function ' + name + '(';
    const start = output.indexOf(prefix), end = output.indexOf('\n}\n', start) + 2;
    if (start < 0 || end <= start) throw Error('PNO function boundary: ' + name);
    const prior = output.slice(start, end), next = transform(prior);
    if (next === prior) throw Error('PNO unchanged transformation: ' + name);
    output = output.slice(0, start) + next + output.slice(end);
  };
  const capture = '  const owner = typeof pnoAsyncCapture === "function" ? pnoAsyncCapture() : null;\n';
  const staleReturn = '    if (owner && !pnoAsyncOwn(owner)) return;\n';
  const staleThrow = '    if (owner && !pnoAsyncOwn(owner)) throw pnoAsyncCancelled();\n';
  const view = body => body.replace('  if (pnoV18State.busy) return;',
    '  const owner = typeof pnoAsyncBeginView === "function" ? pnoAsyncBeginView() : null;\n' +
    '  if (owner && !pnoAsyncOwn(owner)) return;');
  edit('resetPendingParcelModal', body => body.replace('{\n', '{\n  if (typeof pnoAsyncInvalidate === "function") pnoAsyncInvalidate();\n'));
  edit('pnoV18EnsureUi', body => {
    body = replaceOne(body, '  el("pending-parcels-close").onclick = () => dialog.close();',
      '  const closeCurrentPno = () => {\n' +
      '    if (typeof pnoAsyncInvalidate === "function") pnoAsyncInvalidate();\n' +
      '    dialog.close();\n  };\n' +
      '  el("pending-parcels-close").onclick = closeCurrentPno;\n' +
      '  dialog.oncancel = event => { event?.preventDefault?.(); closeCurrentPno(); };\n' +
      '  dialog.onclose = () => {\n' +
      '    if (!dialog.open && !pnoV18State.asyncLifecycle?.opening &&\n' +
      '        typeof pnoAsyncInvalidate === "function") pnoAsyncInvalidate();\n  };', 'close handlers');
    return body;
  });
  edit('pnoV18OpenPendingParcels', body => {
    body = body.replace('  pnoV18EnsureUi();', '  pnoV18EnsureUi();\n  if (typeof pnoAsyncBeginOpen === "function") pnoAsyncBeginOpen();');
    body = body.replace('  pnoReadOnlyExplicitNoPrefetch = true;\n  try { await pnoOperationalResolve(args.row); }\n  finally { pnoReadOnlyExplicitNoPrefetch = false; }',
      capture +
      '  pendingParcelRows = [];\n' +
      '  el("pending-parcels-list").classList.add("hidden");\n' +
      '  el("pno-v18-pager").classList.add("hidden");\n' +
      '  el("pending-parcels-loading").textContent = "กำลังเตรียมรายการ…";\n' +
      '  el("pending-parcels-loading").classList.remove("hidden");\n' +
      '  const releaseNoPrefetch = typeof pnoAsyncHoldNoPrefetch === "function" ? pnoAsyncHoldNoPrefetch() :\n' +
      '    () => { pnoReadOnlyExplicitNoPrefetch = false; };\n' +
      '  pnoReadOnlyExplicitNoPrefetch = true;\n' +
      '  try { await pnoOperationalResolve(args.row); } catch (error) {\n' +
      staleReturn + '    toast("เตรียมรายการไม่สำเร็จ กรุณาลองใหม่", true); return;\n  }\n' +
      '  finally { releaseNoPrefetch(); }\n' +
      '  if (owner && !pnoAsyncOwn(owner)) return;');
    body = body.replace('  if (!dialog.open) dialog.showModal();', '  if (!dialog.open) dialog.showModal();\n  if (pnoV18State.asyncLifecycle) pnoV18State.asyncLifecycle.opening = false;');
    return body;
  });
  edit('pnoV18OpenMulti', body => body.replace('  pnoV18EnsureUi();',
    '  pnoV18EnsureUi();\n  if (typeof pnoAsyncBeginOpen === "function") pnoAsyncBeginOpen();\n' +
    '  pnoV18State.sourceRow = row; pnoV18State.proofId = row.proofId;\n' +
    '  pnoV18State.selection = null; pnoV18State.segmentSignature = JSON.stringify(segments);\n' +
    '  pnoV18State.type = type; pnoV18State.page = page; pnoV18State.total = 0;\n' +
    '  pnoV18State.rows = []; pnoV18State.bagRows = null; pendingParcelRows = [];\n' +
    '  pnoV18State.filterRows = null; pnoV18State.filterKey = ""; pnoV18State.filterError = "";\n' +
    '  pnoV18State.filterProgress = ""; pnoV18State.expandedBag = "";')
    .replace('  const dialog = el("pending-parcels-dialog");', capture + '  const dialog = el("pending-parcels-dialog");')
    .replace('    button.onclick = () => void openPendingParcels(row, type, page,\n      { selection: button.dataset.pnoUnion ? "union" : Number(button.dataset.pnoSegment) });',
      '    button.onclick = () => {\n' + staleReturn +
      '      void openPendingParcels(row, type, page,\n        { selection: button.dataset.pnoUnion ? "union" : Number(button.dataset.pnoSegment) });\n    };')
    .replace('  if (!dialog.open) dialog.showModal();', '  if (!dialog.open) dialog.showModal();\n  if (pnoV18State.asyncLifecycle) pnoV18State.asyncLifecycle.opening = false;'));
  edit('pnoV18Fetch', body => {
    body = body.replace('(type, page) {', '(type, page) {\n' + capture + staleThrow);
    // Union captures the same current owner before its first await.
    body = body.replace('await browserPnoPage(locator, type, page, force)',
      'await (typeof pnoAsyncPage === "function" ? pnoAsyncPage(locator, type, page, force, owner) : browserPnoPage(locator, type, page, force))');
    body = body.replace('  if (selected || selection === null)', staleThrow + '  if (selected || selection === null)');
    return body;
  });
  edit('pnoV18UnionPage', body => body.replace('(sourceRow, type, page, force) {',
    '(sourceRow, type, page, force) {\n' + capture + staleThrow)
    .replace('        const result = await browserPnoPage({ ...sourceRow, ...segment, id: "" }, type, index, force);',
      '        if (owner && !pnoAsyncOwn(owner)) throw pnoAsyncCancelled();\n' +
      '        const result = await (typeof pnoAsyncPage === "function"\n' +
      '          ? pnoAsyncPage({ ...sourceRow, ...segment, id: "" }, type, index, force, owner)\n' +
      '          : browserPnoPage({ ...sourceRow, ...segment, id: "" }, type, index, force));\n' +
      '        if (owner && !pnoAsyncOwn(owner)) throw pnoAsyncCancelled();'));
  for (const name of ['pnoV18Load','pnoV18LoadBags','pnoInboundLoad']) edit(name, body => {
    body = view(body);
    body = body.replace(/await pnoV18Fetch\(([^;]+)\);/g, 'await pnoV18Fetch($1);\n' + staleReturn);
    body = body.replace(/catch\s*\(error\)\s*\{/g, match => match + '\n' + staleReturn);
    body = body.replace('    pnoV18State.busy = false;', '    if (!owner || pnoAsyncOwn(owner)) pnoV18State.busy = false;')
      .replace('} finally { pnoV18State.busy=false; }', '} finally { if (!owner || pnoAsyncOwn(owner)) pnoV18State.busy=false; }');
    return body;
  });
  edit('pnoV18EnsureParcelFilterRows', body => {
    body = body.replace('{\n', '{\n' + capture + staleThrow);
    body = body.replace('    for (let page = 1; page <= pages; page += 1) {',
      '    for (let page = 1; page <= pages; page += 1) {\n      if (owner && !pnoAsyncOwn(owner)) throw pnoAsyncCancelled();');
    body = body.replace('await pnoV18Fetch(sourceType, page);', 'await pnoV18Fetch(sourceType, page);\n' + staleThrow);
    body = body.replace('    pnoV18State.filterRows = all;', staleThrow + '    pnoV18State.filterRows = all;');
    body = body.replace('    if (pnoV18State.filterKey === key) {', '    if ((!owner || pnoAsyncOwn(owner)) && pnoV18State.filterKey === key) {');
    body = body.replace('    if (pnoV18State.filterPromise === task)', '    if ((!owner || pnoAsyncOwn(owner)) && pnoV18State.filterPromise === task)');
    return body;
  });
  edit('pnoV18PrepareCurrentFilters', body => body.replace('{\n', '{\n' + capture)
    .replace('  void pnoV18EnsureParcelFilterRows().then(() => {', '  void pnoV18EnsureParcelFilterRows().then(() => {\n' + staleReturn)
    .replace('  }).catch(() => {', '  }).catch(() => {\n' + staleReturn));
  edit('pnoV18RenderFilters', body => body.replace('{\n', '{\n' + capture)
    .replace('      if (!complete) return;', '      if (owner && !pnoAsyncOwn(owner)) return;\n      if (!complete) return;')
    .replace('  el("pno-v18-filter-reset").onclick = () => {', '  el("pno-v18-filter-reset").onclick = () => {\n' + staleReturn));
  edit('pnoV18RenderBags', body => body.replace('{\n', '{\n' + capture)
    .replace('    button.onclick = () => {', '    button.onclick = () => {\n' + staleReturn));
  for (const name of ['pnoV18Copy','pnoV18CopyLine','pnoV18Export']) edit(name, body => {
    const at = body.indexOf('{\n'), content = body.slice(at + 2, -1);
    let guarded = content.replace('  const ok = await pnoV18WriteClipboard(lines.join("\\n"));',
      '  const ok = await pnoV18WriteClipboard(lines.join("\\n"));\n  if (!currentAction()) return;');
    guarded = guarded.replace('    await pnoV18EnsureParcelFilterRows();',
      '    await pnoV18EnsureParcelFilterRows();\n    if (!currentAction()) return;');
    guarded = guarded.replace('  XLSX.writeFile(', '  await XLSX.writeFile(');
    return body.slice(0, at + 2) + capture +
      '  const actionSignature = typeof pnoAsyncActionSignature === "function" ? pnoAsyncActionSignature() : "";\n' +
      '  const currentAction = () => (!owner || pnoAsyncOwn(owner)) &&\n' +
      '    (!actionSignature || actionSignature === pnoAsyncActionSignature());\n' +
      '  if (!currentAction()) return;\n  try {\n' + guarded +
      '  } catch (error) {\n    if (!currentAction() || error?.code === "PNO_LOCAL_ASYNC_CANCELLED") return;\n' +
      '    toast("ดำเนินการไม่สำเร็จ กรุณาลองใหม่", true);\n  }\n}';
  });
  output = replaceOne(output,
    "    const key = scopeKey();\n    try { const result = await fetchOriginal(...args); try { observe(key, result, Number(args[1])); } catch { coverage = null; } return result; }\n    catch (error) { if (key === scopeKey()) coverage = null; safeRender(); throw error; }",
    "    const key = scopeKey();\n" +
    '    const owner = args[2] || (typeof pnoAsyncCapture === "function" ? pnoAsyncCapture() : null);\n' +
    '    try { const result = await fetchOriginal(...args);\n' +
    '      if (!owner || pnoAsyncOwn(owner)) { try { observe(key, result, Number(args[1])); } catch { coverage = null; } }\n' +
    '      return result;\n    } catch (error) {\n' +
    '      if (!owner || pnoAsyncOwn(owner)) { if (key === scopeKey()) coverage = null; safeRender(); }\n' +
    '      throw error;\n    }', 'destination stale observer');
  return output + '\n' + helpers;
}
