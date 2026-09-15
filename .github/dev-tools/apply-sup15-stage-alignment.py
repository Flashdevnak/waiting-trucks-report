from pathlib import Path

path = Path('cloudflare-browser-test/scripts/patch-dev-tbr-shadow-split-v2.mjs')
source = path.read_text(encoding='utf-8')
start_marker = "  source = patchAsyncFunction(source, 'runMsRefresh', (body) => {"
end_marker = "\n\n  const cronConstant = 'const MS_CRON_ACTIVE_SKIP_MS = 45 * 1000;'"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('SUP15_STAGE_ALIGN=FAIL missing runMsRefresh patch block')

replacement = r'''  source = patchAsyncFunction(source, 'runMsRefresh', (body) => {
    const legacyTransientAnchor = `    const transient =\n      error?.code === \"UPSTREAM_TIMEOUT\" ||\n      error?.code === \"MS_HTTP_ERROR\" ||\n      error instanceof TypeError;`;
    const legacyTransientReplacement = `    const transient =\n      error?.code === \"UPSTREAM_TIMEOUT\" ||\n      error?.code === \"MS_HTTP_ERROR\" ||\n      error?.code === \"MS_SESSION_EXPIRED\" ||\n      error?.code === \"MS_ROUTE_SOURCE_ERROR\" ||\n      error?.code === \"MS_ROUTE_RATE_LIMIT\" ||\n      error instanceof TypeError;`;
    const recoveryTransientAnchor = `    const transient =\n      tursoAvailability ||\n      errorCode === \"UPSTREAM_TIMEOUT\" ||\n      errorCode === \"MS_HTTP_ERROR\" ||\n      error instanceof TypeError;`;
    const recoveryTransientReplacement = `    const transient =\n      tursoAvailability ||\n      errorCode === \"UPSTREAM_TIMEOUT\" ||\n      errorCode === \"MS_HTTP_ERROR\" ||\n      errorCode === \"MS_SESSION_EXPIRED\" ||\n      errorCode === \"MS_ROUTE_SOURCE_ERROR\" ||\n      errorCode === \"MS_ROUTE_RATE_LIMIT\" ||\n      error instanceof TypeError;`;
    let usesRecoveryErrorCode = false;
    if (body.includes(recoveryTransientAnchor)) {
      usesRecoveryErrorCode = true;
      body = body.replace(recoveryTransientAnchor, recoveryTransientReplacement);
    } else if (body.includes(legacyTransientAnchor)) {
      body = body.replace(legacyTransientAnchor, legacyTransientReplacement);
    } else if (body.includes('errorCode === \"MS_ROUTE_RATE_LIMIT\"')) {
      usesRecoveryErrorCode = body.includes('const errorCode = String(error?.code || \"\");');
    } else if (!body.includes('error?.code === \"MS_ROUTE_RATE_LIMIT\"')) {
      throw new Error('runMsRefresh transient anchor not found');
    }

    const degradedAnchor = `        const result = {\n          status: \"degraded\",\n          syncedAt: fallback.syncedAt || \"\",\n          changes: 0,`;
    if (body.includes(degradedAnchor)) {
      const errorCodeLine = usesRecoveryErrorCode
        ? `          errorCode: errorCode || \"MS_NETWORK_ERROR\",\n`
        : `          errorCode: error?.code || \"MS_NETWORK_ERROR\",\n`;
      body = body.replace(
        degradedAnchor,
        `        const result = {\n          status: \"degraded\",\n          syncedAt: fallback.syncedAt || \"\",\n${errorCodeLine}          changes: 0,`,
      );
    } else if (!body.includes('errorCode: errorCode || \"MS_NETWORK_ERROR\"') &&
               !body.includes('errorCode: error?.code || \"MS_NETWORK_ERROR\"')) {
      throw new Error('runMsRefresh degraded result anchor not found');
    }

    const legacyErrorAnchor = `    const result = {\n      status: \"error\",\n      error: error.message || \"เชื่อมต่อ MS ไม่สำเร็จ\",\n    };`;
    const legacyErrorReplacement = `    const result = {\n      status: \"error\",\n      errorCode: error?.code || \"MS_SYNC_FAILED\",\n      error: error.message || \"เชื่อมต่อ MS ไม่สำเร็จ\",\n    };`;
    if (body.includes(legacyErrorAnchor))
      return body.replace(legacyErrorAnchor, legacyErrorReplacement);
    if (body.includes('errorCode: errorCode || \"MS_SYNC_FAILED\"') ||
        body.includes('errorCode: error?.code || \"MS_SYNC_FAILED\"'))
      return body;
    throw new Error('runMsRefresh error result anchor not found');
  });'''

updated = source[:start] + replacement + source[end:]
if updated == source:
    raise SystemExit('SUP15_STAGE_ALIGN=FAIL no change')
path.write_text(updated, encoding='utf-8')
print('SUP15_STAGE_ALIGN=PATCHED')
