const MARKER = 'PNO_MODAL_LIFECYCLE_STABILITY_V1';
function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`${MARKER}: anchor mismatch: ${before.slice(0, 70)}`);
  return source.replace(before, after);
}
function transform(source, name, edit) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}\n', start) + 2;
  if (start < 0 || end < 2 || source.indexOf(`function ${name}(`, start + 1) >= 0)
    throw new Error(`${MARKER}: function boundary: ${name}`);
  return source.slice(0, start) + edit(source.slice(start, end)) + source.slice(end);
}

export function patchPnoModalLifecycleStabilityV1(source) {
  if (source.includes(`// ${MARKER}`)) return source;
  for (const [name, args] of [['pnoV18Load', 'type, page'], ['pnoV18LoadBags', ''], ['pnoInboundLoad', 'page']]) {
    source = transform(source, name, body => {
      body = once(body, `function ${name}(${args}) {\n  if (pnoV18State.busy) return;`,
        `function ${name}Owned(${args ? args + ', ' : ''}owner) {\n  pnoLifecycleAssert(owner);`);
      body = once(body, '  pnoV18State.busy = true;\n', '');
      body = once(body, '    pnoV18State.busy = false;', '    // Busy release belongs exclusively to the lifecycle scheduler.');
      // The outer scheduler boundary covers cached renders and all pre-try DOM work.
      body = body.replaceAll('pnoV18PrepareCurrentFilters();', 'await pnoV18PrepareCurrentFilters(owner);');
      body = body.replaceAll('await pnoV18Fetch(type, pnoV18State.page)', 'await pnoV18Fetch(type, pnoV18State.page, owner)');
      body = body.replaceAll('await pnoV18Fetch("total", pnoV18State.page)', 'await pnoV18Fetch("total", pnoV18State.page, owner)');
      body = body.replaceAll('await pnoV18Fetch("total", 1)', 'await pnoV18Fetch("total", 1, owner)');
      body = body.replaceAll('await pnoV18Fetch("total", page)', 'await pnoV18Fetch("total", page, owner)');
      body = body.replace(/(const (?:result|first) = await pnoV18Fetch\([^;]+;)/g, '$1\n    pnoLifecycleAssert(owner);');
      body = body.replaceAll('  } catch (error) {', '  } catch (error) {\n    if (!pnoLifecycleCurrent(owner)) return;');
      return body;
    });
  }
  source = transform(source, 'pnoV18Fetch', body => {
    body = once(body, 'function pnoV18Fetch(type, page) {', 'function pnoV18Fetch(type, page, owner = pnoLifecycleToken()) {\n  pnoLifecycleAssert(owner);');
    body = once(body, 'await pnoV18UnionPage(sourceRow, type, page, force)', 'await pnoV18UnionPage(sourceRow, type, page, force, owner)');
    return once(body, '  if (selected || selection === null) pnoPendingPropagatePositive(locator, result);',
      '  pnoLifecycleAssert(owner);\n  if (selected || selection === null) pnoPendingPropagatePositive(locator, result);');
  });
  source = transform(source, 'pnoV18UnionPage', body => {
    body = once(body, 'function pnoV18UnionPage(sourceRow, type, page, force) {',
      'function pnoV18UnionPage(sourceRow, type, page, force, owner = pnoLifecycleToken()) {\n  pnoLifecycleAssert(owner);');
    body = once(body, '        const result = await browserPnoPage', '        pnoLifecycleAssert(owner);\n        const result = await browserPnoPage');
    return once(body, '        if (result?.sourceValid !== true)', '        pnoLifecycleAssert(owner);\n        if (result?.sourceValid !== true)');
  });
  source = transform(source, 'pnoV18EnsureParcelFilterRows', body => {
    body = once(body, 'function pnoV18EnsureParcelFilterRows() {',
      'function pnoV18EnsureParcelFilterRows(owner = pnoLifecycleToken()) {\n  pnoLifecycleAssert(owner);');
    body = once(body, '      const resultNode = el(', '      pnoLifecycleAssert(owner);\n      const resultNode = el(');
    body = once(body, 'await pnoV18Fetch(sourceType, page);', 'await pnoV18Fetch(sourceType, page, owner);\n      pnoLifecycleAssert(owner);');
    body = once(body, '    pnoV18State.filterRows = all;', '    pnoLifecycleAssert(owner);\n    pnoV18State.filterRows = all;');
    body = once(body, '    if (pnoV18State.filterKey === key) {', '    if (pnoLifecycleCurrent(owner) && pnoV18State.filterKey === key) {');
    return once(body, '    if (pnoV18State.filterPromise === task)', '    if (pnoLifecycleCurrent(owner) && pnoV18State.filterPromise === task)');
  });
  source = transform(source, 'pnoV18PrepareCurrentFilters', body => {
    body = once(body, 'function pnoV18PrepareCurrentFilters() {',
      'function pnoV18PrepareCurrentFilters(owner = pnoLifecycleToken()) {\n  pnoLifecycleAssert(owner);');
    body = once(body, '  void pnoV18EnsureParcelFilterRows().then(() => {',
      '  return pnoV18EnsureParcelFilterRows(owner).then(() => {\n    if (!pnoLifecycleCurrent(owner)) return;');
    body = once(body, '  }).catch(() => {', '  }).catch((error) => {\n    if (!pnoLifecycleCurrent(owner)) return;');
    return once(body, '      pnoV18RenderFilters();\n  });',
      '      pnoLifecycleSafe(owner, () => pnoV18RenderFilters());\n  });');
  });
  for (const name of ['pnoV18Copy', 'pnoV18CopyLine', 'pnoV18Export']) {
    source = transform(source, name, body => {
      body = once(body, `function ${name}() {`, `function ${name}Owned(owner) {\n  pnoLifecycleAssert(owner);`);
      if (name === 'pnoV18Export') body = once(body, '    await pnoV18EnsureParcelFilterRows();',
        '    await pnoV18EnsureParcelFilterRows(owner);\n    pnoLifecycleAssert(owner);');
      else body = once(body, '  if (!ok) return toast(', '  pnoLifecycleAssert(owner);\n  if (!ok) return toast(');
      body = body.replaceAll('await pnoV18WriteClipboard(lines.join("\\n"))', 'await pnoV18WriteClipboard(lines.join("\\n"), owner)');
      return body;
    });
  }
  source = transform(source, 'pnoV18WriteClipboard', body => {
    body = once(body, 'function pnoV18WriteClipboard(text) {',
      'function pnoV18WriteClipboard(text, owner = pnoLifecycleToken()) {\n  pnoLifecycleAssert(owner);');
    return once(body, '  } catch (_) {', '  } catch (_) {\n    pnoLifecycleAssert(owner);');
  });
  // Boundaries at handler construction, including synchronous filter/bag render errors.
  for (const name of ['pnoV18RenderFilters', 'pnoV18RenderBags']) {
    source = transform(source, name, body => body.slice(0, -1) +
      '\n  pnoLifecycleBindHandlers(el("pending-parcels-dialog"));\n}');
  }
  source = transform(source, 'pnoV18OpenMulti', body => body.slice(0, -1) +
    '\n  pnoLifecycleBindHandlers(dialog);\n}');
  source = transform(source, 'pnoV18EnsureUi', body => body.slice(0, -1) +
    '\n  pnoLifecycleBindHandlers(dialog);\n}');
  // Repeated initialization still binds the close lifecycle when the card already exists.
  source = once(source, '  if (!card || card.dataset.pnoV18 === "1") return;',
    '  if (!card) return;\n  if (card.dataset.pnoV18 === "1") { pnoLifecycleBindHandlers(dialog); return; }');
  source = transform(source, 'pnoV18OpenPendingParcels', body => {
    body = once(body, 'function pnoV18OpenPendingParcels(', 'function pnoV18OpenPendingParcelsOwned(');
    body = once(body, '{ force = false, selection = null } = {}) {', '{ force = false, selection = null } = {}, openOwner) {');
    return once(body, '  finally { pnoReadOnlyExplicitNoPrefetch = false; }',
      '  finally { if (pnoLifecycleOpenCurrent(openOwner)) pnoReadOnlyExplicitNoPrefetch = false; }\n  if (!pnoLifecycleOpenCurrent(openOwner)) return;');
  });
  return once(source, '// DEV_PNO_DETAIL_DIAG_FINAL_HOOK_V1',
    '// ' + MARKER + '\n' + runtime + '\n// DEV_PNO_DETAIL_DIAG_FINAL_HOOK_V1');
}

const runtime = String.raw`
const pnoLifecycle = { open: 0, load: 0, active: false, busyOwner: null, latest: null, closeEvents: 0 };
function pnoLifecycleToken() { return { open: pnoLifecycle.open, load: pnoLifecycle.load }; }
function pnoLifecycleOpenCurrent(owner) { return pnoLifecycle.active && owner?.open === pnoLifecycle.open; }
function pnoLifecycleCurrent(owner) { return pnoLifecycleOpenCurrent(owner) && owner.load === pnoLifecycle.load; }
function pnoLifecycleAssert(owner) {
  if (!pnoLifecycleCurrent(owner)) throw Object.assign(new Error("Stale PNO modal work"), { pnoLifecycleStale: true });
}
function pnoLifecycleInvalidate(active = false) {
  pnoLifecycle.open++; pnoLifecycle.load++; pnoLifecycle.active = active;
  pnoLifecycle.busyOwner = null; pnoLifecycle.latest = null;
  pnoV18State.busy = false; pnoV18State.filterPromise = null;
  pnoReadOnlyExplicitNoPrefetch = false;
}
function pnoLifecycleError(owner, error) {
  if (!pnoLifecycleCurrent(owner) || error?.pnoLifecycleStale) return;
  // A broken error renderer must not escape this PNO-local boundary either.
  try { toast("ดำเนินการ PNO ไม่สำเร็จ กรุณาลองใหม่", true); } catch (_) {}
}
function pnoLifecycleSafe(owner, action) {
  try { return Promise.resolve(action()).catch(error => pnoLifecycleError(owner, error)); }
  catch (error) { pnoLifecycleError(owner, error); return Promise.resolve(); }
}
async function pnoLifecycleRun(intent) {
  const owner = intent.owner;
  if (!pnoLifecycleCurrent(owner)) return;
  pnoV18State.filterPromise = null;
  pnoLifecycle.busyOwner = owner; pnoV18State.busy = true;
  try {
    if (intent.view === "bag") await pnoV18LoadBagsOwned(owner);
    else if (intent.view === "scan_gap") await pnoInboundLoadOwned(intent.page, owner);
    else await pnoV18LoadOwned(intent.view, intent.page, owner);
  } catch (error) { pnoLifecycleError(owner, error); }
  finally {
    if (pnoLifecycle.busyOwner === owner) {
      pnoLifecycle.busyOwner = null; pnoV18State.busy = false;
      const next = pnoLifecycle.latest; pnoLifecycle.latest = null;
      if (next && pnoLifecycleCurrent(next.owner)) await pnoLifecycleRun(next);
    }
  }
}
function pnoLifecycleRequest(view, page = 1) {
  if (!pnoLifecycle.active) return Promise.resolve();
  const intent = { owner: { open: pnoLifecycle.open, load: ++pnoLifecycle.load },
    view, page: Math.max(1, Number(page) || 1) };
  if (pnoLifecycle.busyOwner) {
    pnoLifecycle.latest = intent;
    return pnoLifecycleSafe(intent.owner, () => pnoV18SetActive(view));
  }
  return pnoLifecycleRun(intent);
}
async function pnoV18Load(type, page) {
  return pnoLifecycleRequest(type, page);
}
async function pnoV18LoadBags() {
  return pnoLifecycleRequest("bag", 1);
}
async function pnoInboundLoad(page) {
  return pnoLifecycleRequest("scan_gap", page);
}
async function pnoV18Copy() {
  const owner = pnoLifecycleToken(); return pnoLifecycleSafe(owner, () => pnoV18CopyOwned(owner));
}
async function pnoV18CopyLine() {
  const owner = pnoLifecycleToken(); return pnoLifecycleSafe(owner, () => pnoV18CopyLineOwned(owner));
}
async function pnoV18Export() {
  const owner = pnoLifecycleToken(); return pnoLifecycleSafe(owner, () => pnoV18ExportOwned(owner));
}
const pnoLifecycleOpenImpl = openPendingParcels;
openPendingParcels = async function(row, type, page, options) {
  pnoLifecycleInvalidate(true);
  const owner = pnoLifecycleToken();
  return pnoLifecycleSafe(owner, () => pnoLifecycleOpenImpl(row, type, page, options, owner));
};
function pnoLifecycleBindHandlers(dialog) {
  if (!dialog) return;
  const close = el("pending-parcels-close");
  // Invalidate synchronously, before native close queues its event. That event
  // must not invalidate a new open which is still resolving its source row.
  if (typeof dialog.close === "function" && !dialog.close.pnoLifecycleBound) {
    const nativeClose = dialog.close;
    const wrappedClose = function(...args) {
      if (this.open) pnoLifecycle.closeEvents++;
      pnoLifecycleInvalidate();
      return nativeClose.apply(this, args);
    };
    wrappedClose.pnoLifecycleBound = true; dialog.close = wrappedClose;
  }
  if (close) close.onclick = () => pnoLifecycleSafe(pnoLifecycleToken(), () => dialog.close());
  dialog.onclose = () => {
    if (pnoLifecycle.closeEvents > 0) { pnoLifecycle.closeEvents--; return; }
    if (!dialog.open) pnoLifecycleInvalidate();
  };
  dialog.oncancel = () => {
    if (dialog.open) pnoLifecycle.closeEvents++;
    pnoLifecycleInvalidate();
  };
  for (const node of dialog.querySelectorAll("button,select")) {
    for (const key of ["onclick", "onchange"]) {
      const handler = node[key];
      if (typeof handler !== "function" || handler.pnoLifecycleBound || node === close) continue;
      const wrapped = function(...args) {
        const owner = pnoLifecycleToken();
        return pnoLifecycleSafe(owner, () => handler.apply(this, args));
      };
      wrapped.pnoLifecycleBound = true; node[key] = wrapped;
    }
  }
}
`;
