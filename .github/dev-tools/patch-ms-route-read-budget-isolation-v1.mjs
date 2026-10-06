// DEV staging only: preserve deadlines and isolate route DB accounting.
export function patchMsRouteReadBudgetIsolationV1(source) {
  if (source.includes('// MS_ROUTE_READ_BUDGET_ISOLATION_V1')) return source;
  const replacements = [
    ['    const routeWrite = stage === "route_batch_write";\n    const remaining = routeWrite',
     '    // MS_ROUTE_READ_BUDGET_ISOLATION_V1\n    const routeScoped = stage === "route_state_read" || stage === "route_batch_write";\n    const remaining = routeScoped'],
    ['      if (routeWrite) routePersistenceBudget -= Math.max(0, Date.now() - started);',
     '      if (routeScoped) routePersistenceBudget -= Math.max(0, Date.now() - started);'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('MS_ROUTE_READ_BUDGET_ISOLATION_V1 anchor mismatch');
    source = source.replace(before, after);
  }
  return source;
}
