// Final DEV composition only: unchanged SQL, deadlines and physical retry limits.
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error('MS stall containment anchor mismatch: ' + before.slice(0, 90));
  return source.replace(before, after);
}
export function patchMsTursoStallAdapterV1(source) {
  if (source.includes('// MS_TURSO_STALL_ADAPTER_V1')) return source;
  source = replaceOnce(source,
    'async _pipeline(requests, { baseUrl = this.url, baton } = {}) {',
    '// MS_TURSO_STALL_ADAPTER_V1\n  async _pipeline(requests, { baseUrl = this.url, baton, signal } = {}) {');
  return replaceOnce(source, '        body: JSON.stringify(body),',
    '        body: JSON.stringify(body),\n        signal,');
}
export function patchMsTursoStallContainmentV1(source) {
  if (source.includes('// MS_TURSO_STALL_CONTAINMENT_V1')) return source;
  source = replaceOnce(source, '    const lateRollback = {};\n    let latePending = database._pipeline(...args);', `    const lateRollback = {};
    let transportController;
    const armTransport = () => {
      transportController = new AbortController();
      args[1] = { ...(args[1] || {}), signal: transportController.signal };
    };
    armTransport();
    let latePending = database._pipeline(...args);`);
  source = replaceOnce(source,
    '        timer = setTimeout(() => { expired = true; reject(timeoutError()); }, remaining);', `        timer = setTimeout(() => {
          expired = true;
          // The product deadline wins classification before transport rejection.
          reject(timeoutError());
          transportController.abort();
        }, remaining);`);
  source = replaceOnce(source, '        latePending = database._pipeline(...args);',
    '        armTransport();\n        latePending = database._pipeline(...args);');
  source = replaceOnce(source, '    let cache = await readMsLiveCache(env, branch, sourceHash);', `    const acceptedSource = msAcceptedSource.get(msAcceptedHub(branch));
    let sourceAccepted = false;
    let cache = acceptedSource
      ? { ...acceptedSource, sourceMatch: acceptedSource.sourceHash === sourceHash }
      : await readMsLiveCache(env, branch, sourceHash);`);
  source = replaceOnce(source, '    if (cache?.sourceMatch) {\n      sync = {',
    '    if (cache?.sourceMatch) {\n      sourceAccepted = true;\n      sync = {');
  source = replaceOnce(source, '        const currentCache = await readMsLiveCache(env, branch, sourceHash);',
    // DONE with the same hash and an unexpired ACTIVE lease cannot grant ownership.
    // The acquired publisher can use its initial cache/baseline without another read.
    '        const currentCache = cache;');
  source = replaceOnce(source, '        if (currentCache?.sourceMatch) {\n          cache = currentCache;',
    '        if (currentCache?.sourceMatch) {\n          sourceAccepted = true;\n          cache = currentCache;');
  source = replaceOnce(source, '        const settled = await waitForMsSourceCache(env, branch, sourceHash);',
    '        const settled = acceptedSource ? null : await waitForMsSourceCache(env, branch, sourceHash);');
  source = replaceOnce(source, '        if (settled?.sourceMatch) {\n          cache = settled;',
    '        if (settled?.sourceMatch) {\n          sourceAccepted = true;\n          cache = settled;');
  source = replaceOnce(source,
    '    result.rows = attachPnoViewMetadata(result.rows, mappedRows);\n    recentMsSync.set(branch,', `    result.rows = attachPnoViewMetadata(result.rows, mappedRows);
    if (sourceAccepted || (publishSource && cacheWrite)) msRememberAcceptedSource(branch, {
      sourceHash, rows: sync.rows, syncedAt: sync.syncedAt,
      format: 7, completedDay, completedRows,
    }, result);
    recentMsSync.set(branch,`);
  source = replaceOnce(source, '  hubSettingsCache.delete(String(branch || "").toUpperCase());',
    '  hubSettingsCache.delete(String(branch || "").toUpperCase());\n  msInvalidateRememberedSettings(branch);');
  source = replaceOnce(source, `    let settings, readError;
    try {
      // Only this idempotent snapshot settings read gets the live DB deadline.
      // The adapter below can retry one quick availability failure within it.
      settings = await msTraceSettingsRead(msLiveDatabaseEnv(this.env, branch), branch);
    } catch (error) { readError = error; }
    const remembered = this.lastSnapshotBranch === branch ? this.lastSnapshotPayload : null;`, `    let settings, readError;
    const remembered = this.lastSnapshotBranch === branch ? this.lastSnapshotPayload : null;
    if (Array.isArray(remembered?.standards)) {
      msWarmSettingsRefresh(this, branch);
      settings = { msVehicleLimits: remembered.standards };
    } else {
      try {
        settings = await msTraceSettingsRead(msLiveDatabaseEnv(this.env, branch), branch);
      } catch (error) { readError = error; }
    }`);
  source = replaceOnce(source, 'settingsReadAttempted: true, settingsReadOk: !readError, settingsErrorCode:',
    'settingsReadAttempted: !Array.isArray(remembered?.standards), settingsReadOk: !readError, settingsErrorCode:');
  return source + String.raw`
// MS_TURSO_STALL_CONTAINMENT_V1
const msAcceptedSource = new Map();
const msSettingsRevisions = new Map();
function msAcceptedHub(hub) { return String(hub || "").trim().toUpperCase(); }
function msRememberAcceptedSource(hub, entry, result) {
  if (result?.status !== "synced" || result?.errorCode || !Array.isArray(entry?.rows) || !entry.sourceHash) return;
  const key = msAcceptedHub(hub);
  if (!key) return;
  msAcceptedSource.delete(key);
  msAcceptedSource.set(key, entry);
  if (msAcceptedSource.size > 128) msAcceptedSource.delete(msAcceptedSource.keys().next().value);
}
function msInvalidateRememberedSettings(branch) {
  const key = msAcceptedHub(branch);
  msSettingsRevisions.delete(key);
  msSettingsRevisions.set(key, {});
  if (msSettingsRevisions.size > 128) msSettingsRevisions.delete(msSettingsRevisions.keys().next().value);
}
function msWarmSettingsRefresh(owner, branch) {
  const key = msAcceptedHub(branch), revision = msSettingsRevisions.get(key);
  const cached = hubSettingsCache.get(key);
  if (cached?.until > Date.now()) {
    if (owner.lastSnapshotBranch === branch)
      owner.lastSnapshotPayload.standards = cached.value.msVehicleLimits;
    return;
  }
  const previous = owner.msWarmSettings;
  if (previous?.branch === branch && (previous.pending ||
      (previous.revision === revision && previous.until > Date.now()))) return;
  // Remembered values remain usable without starting an unsupported detached task.
  if (typeof owner.ctx?.waitUntil !== "function") return;
  const state = { branch, revision, until: Date.now() + HUB_SETTINGS_CACHE_MS, pending: true };
  owner.msWarmSettings = state;
  const env = new Proxy(owner.env, { get: (target, name) => name === "MS_BACKGROUND_WAIT"
    ? task => owner.ctx.waitUntil(task) : target[name] });
  const task = Promise.resolve()
    .then(() => msTraceSettingsRead(msLiveDatabaseEnv(env, branch), branch))
    .then(settings => {
      if (msSettingsRevisions.get(key) !== revision) {
        // A save raced the read; an old response cannot mask the saved standards.
        hubSettingsCache.delete(key);
        state.until = 0;
        return;
      }
      if (owner.msWarmSettings === state && owner.lastSnapshotBranch === branch &&
          Array.isArray(settings?.msVehicleLimits))
        owner.lastSnapshotPayload = { ...owner.lastSnapshotPayload, standards: settings.msVehicleLimits };
    }, () => { /* A settings-only warm failure cannot degrade accepted MS rows. */ })
    .finally(() => { state.pending = false; });
  try { owner.ctx.waitUntil(task); } catch { task.catch(() => {}); }
}
`;
}
