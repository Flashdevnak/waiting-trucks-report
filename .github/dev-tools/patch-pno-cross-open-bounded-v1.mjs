// Local-only reviewed proposal, never apply directly to the current Target branch.
const MARKER = 'WTR009_CROSS_OPEN_BOUNDED_LIFECYCLE_V1';
function uniqueReplace(source, oldText, newText, context) {
  if (source.split(oldText).length !== 2) throw Error(`${MARKER}: wrong anchor ${context}`);
  return source.replace(oldText, newText);
}
export function patchPnoCrossOpenBoundedV1(source) {
  if (source.includes(`// ${MARKER}`)) return source;
  source = uniqueReplace(source,
    'function pnoAsyncInvalidate() {\n  pnoTruckQrClearV1();',
    'function pnoAsyncInvalidate() {\n  pnoAsyncCancelWaitingPages();\n  pnoTruckQrClearV1();',
    'close invalidation');
  source = uniqueReplace(source,
    'function pnoAsyncBeginOpen() {\n  pnoTruckQrClearV1();',
    'function pnoAsyncBeginOpen() {\n  pnoAsyncCancelWaitingPages();\n  pnoTruckQrClearV1();',
    'new open invalidation');
  source = uniqueReplace(source,
    '  life.generation += 1; life.request += 1; life.open = true; life.opening = true;',
    '  life.generation += 1; life.request += 1; life.open = true; life.opening = true;\n' +
    '  life.tail = Promise.resolve(); // Separate generations; keep each generation serial.',
    'new generation queue');
  const oldPage = `  const task = life.tail.then(async () => {
    if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
    const result = await browserPnoPage(row, type, page, force);
    if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
    pnoQrValidatePage009(result,row,{hub:state.branch,type,page});
    return result;
  });`;
  const newPage = `  const task = life.tail.then(async () => {
    if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
    const release = await pnoAsyncAcquirePageSlot(owner);
    try {
      if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
      const result = await browserPnoPage(row, type, page, force);
      if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
      pnoQrValidatePage009(result,row,{hub:state.branch,type,page});
      return result;
    } catch (error) {
      if (!pnoAsyncOwn(owner)) throw pnoAsyncCancelled();
      throw error;
    } finally { release(); }
  });`;
  source = uniqueReplace(source,oldPage,newPage,'bounded page acquisition');
  const helper = `// ${MARKER}: max two in-flight explicit modal pages across generations, no poll/retry.
function pnoAsyncCancelWaitingPages() {
  const slots = pnoV18State.asyncLifecycle?.pageSlots;
  if (!slots) return;
  for (const waiter of slots.waiting.splice(0)) waiter.reject(pnoAsyncCancelled());
}
function pnoAsyncReleasePageSlot(slots) {
  slots.active -= 1;
  while (slots.active < 2 && slots.waiting.length) {
    const waiter = slots.waiting.shift();
    if (!pnoAsyncOwn(waiter.owner)) { waiter.reject(pnoAsyncCancelled()); continue; }
    slots.active += 1;
    waiter.resolve(() => pnoAsyncReleasePageSlot(slots));
  }
}
function pnoAsyncAcquirePageSlot(owner) {
  if (!pnoAsyncOwn(owner)) return Promise.reject(pnoAsyncCancelled());
  const life = pnoAsyncContext();
  if (!life.pageSlots) life.pageSlots = {active: 0, waiting: []};
  const slots = life.pageSlots;
  if (slots.active < 2 && slots.waiting.length === 0) {
    slots.active += 1;
    return Promise.resolve(() => pnoAsyncReleasePageSlot(slots));
  }
  return new Promise((resolve,reject) => slots.waiting.push({owner,resolve,reject}));
}
`;
  source = uniqueReplace(source,
    'async function pnoAsyncPage(row, type, page, force, owner) {',
    helper + '\nasync function pnoAsyncPage(row, type, page, force, owner) {',
    'helper placement');
  return source;
}
