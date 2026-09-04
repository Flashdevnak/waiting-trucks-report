import fs from 'node:fs';

const file = process.argv[2] || 'src/tbr-shadow.js';
let source = fs.readFileSync(file, 'utf8');

const marker = 'TBR_ROUTE_DUPLICATE_ACTUAL_V1';
if (source.includes(marker)) {
  console.log('TBR_ROUTE_DEDUPE_PATCH=ALREADY_APPLIED');
  process.exit(0);
}

const oldMap = `  const routeByProof = new Map();\n  for (const route of live.rows) {\n    const proof = normalizeProof(route?.proofId);\n    if (proof && !routeByProof.has(proof)) routeByProof.set(proof, route);\n  }`;
const newMap = `  const routeByProof = new Map();\n  for (const route of live.rows) {\n    const proof = normalizeProof(route?.proofId);\n    if (!proof) continue;\n    // ${marker}: duplicate Route rows can exist for one proofId. Prefer a row\n    // with a real actualArrivalAt; if multiple arrived rows exist, keep the earliest.\n    const current = routeByProof.get(proof);\n    const currentActualMs = validTime(current?.actualArrivalAt);\n    const nextActualMs = validTime(route?.actualArrivalAt);\n    if (\n      !current ||\n      (currentActualMs === null && nextActualMs !== null) ||\n      (currentActualMs !== null && nextActualMs !== null && nextActualMs < currentActualMs)\n    ) {\n      routeByProof.set(proof, route);\n    }\n  }`;
if (!source.includes(oldMap)) throw new Error('routeByProof map anchor not found');
source = source.replace(oldMap, newMap);

const oldRouteSetup = `    const routeActualMs = validTime(route?.actualArrivalAt);\n    let record = state.records[id];`;
const newRouteSetup = `    const routeActualMs = validTime(route?.actualArrivalAt);\n    const routeSeen = Boolean(route);\n    let record = state.records[id];`;
if (!source.includes(oldRouteSetup)) throw new Error('routeSeen setup anchor not found');
source = source.replace(oldRouteSetup, newRouteSetup);

const oldNewRecord = `        routeActualArrivalAt: \"\",\n        leadMinutes: null,`;
const newNewRecord = `        routeActualArrivalAt: \"\",\n        routeSeen,\n        leadMinutes: null,`;
if (!source.includes(oldNewRecord)) throw new Error('new record routeSeen anchor not found');
source = source.replace(oldNewRecord, newNewRecord);

const oldPending = `    if (record.status !== \"pending\") continue;\n    const nextKit = iso(item?.scheduleKitArrivalAt);`;
const newPending = `    if (record.status === \"pending\" && record.routeSeen !== routeSeen) {\n      record.routeSeen = routeSeen;\n      changed = true;\n    }\n    if (record.status !== \"pending\") continue;\n    const nextKit = iso(item?.scheduleKitArrivalAt);`;
if (!source.includes(oldPending)) throw new Error('pending routeSeen anchor not found');
source = source.replace(oldPending, newPending);

const oldReport = `      routeActualArrivalAt: String(item?.routeActualArrivalAt || \"\"),`;
const newReport = `      routeActualArrivalAt: String(item?.routeActualArrivalAt || \"\"),\n      routeSeen: Boolean(item?.routeSeen),`;
if (!source.includes(oldReport)) throw new Error('report routeSeen anchor not found');
source = source.replace(oldReport, newReport);

const oldLabel = `          : item.status === \"expired\"\n            ? \"หมดเวลา/ต้องตรวจ\"\n            : \"รอ Route\";`;
const newLabel = `          : item.status === \"expired\"\n            ? \"หมดเวลา/ต้องตรวจ\"\n            : item.routeSeen\n              ? \"รอเวลามาถึงจริง\"\n              : \"รอ Route\";`;
if (!source.includes(oldLabel)) throw new Error('pending label anchor not found');
source = source.replace(oldLabel, newLabel);

fs.writeFileSync(file, source);
console.log('TBR_ROUTE_DEDUPE_PATCH=PASS');
