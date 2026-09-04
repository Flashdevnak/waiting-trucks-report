import fs from 'node:fs';

const indexFile = process.argv[2] || 'src/index.js';
const shadowFile = process.argv[3] || 'src/tbr-shadow.js';
let indexSource = fs.readFileSync(indexFile, 'utf8');
let shadowSource = fs.readFileSync(shadowFile, 'utf8');

const MARKER = 'TBR_INBOUND_QUOTA_V1';

if (!indexSource.includes(MARKER)) {
  const oldSync = `async function sendConnectorSync(env, hub, connectorToken) {\n  return mainApiFetch(env, { action: \"connectorSync\", hub, connectorToken });\n}`;
  const newSync = `// ${MARKER}: Browser TEST requests the DEV read-only shadow snapshot only.\nasync function sendConnectorSync(env, hub, connectorToken) {\n  return mainApiFetch(env, {\n    action: \"connectorSync\",\n    hub,\n    connectorToken,\n    shadowOnly: true,\n  });\n}`;
  if (!indexSource.includes(oldSync)) throw new Error('Browser connectorSync service-binding anchor not found');
  indexSource = indexSource.replace(oldSync, newSync);
}

if (!shadowSource.includes(MARKER)) {
  if (!shadowSource.includes('const SHADOW_VERSION = 1;')) throw new Error('Shadow version anchor not found');
  shadowSource = shadowSource.replace(
    'const SHADOW_VERSION = 1;',
    `// ${MARKER}: only inbound destination/drop routes are observed.\nconst SHADOW_VERSION = 2;`,
  );

  const proofAnchor = `function normalizeProof(value) {\n  return String(value || \"\").trim().toUpperCase().replace(/\\s+/g, \"\");\n}`;
  const proofBlock = `${proofAnchor}\n\nfunction normalizeShadowAttendance(value) {\n  const text = String(value || \"\").trim();\n  if (text.includes(\"จุดดร\")) return \"จุดดรอป\";\n  if (text.includes(\"ปลายทาง\")) return \"ปลายทาง\";\n  if (text.includes(\"ต้นทาง\")) return \"ต้นทาง\";\n  return text;\n}\n\nfunction isInboundShadowRoute(value) {\n  const type = normalizeShadowAttendance(value);\n  return type === \"ปลายทาง\" || type === \"จุดดรอป\";\n}`;
  if (!shadowSource.includes(proofAnchor)) throw new Error('normalizeProof anchor not found');
  shadowSource = shadowSource.replace(proofAnchor, proofBlock);

  const stateAnchor = `    lastSkip: \"\",\n    records: {},`;
  const stateBlock = `    lastSkip: \"\",\n    shadowQuota: null,\n    records: {},`;
  if (!shadowSource.includes(stateAnchor)) throw new Error('freshState quota anchor not found');
  shadowSource = shadowSource.replace(stateAnchor, stateBlock);

  const reportAnchor = `      routeSeen: Boolean(item?.routeSeen),\n      leadMinutes:`;
  const reportBlock = `      routeSeen: Boolean(item?.routeSeen),\n      attendanceType: normalizeShadowAttendance(item?.attendanceType),\n      leadMinutes:`;
  if (!shadowSource.includes(reportAnchor)) throw new Error('report attendance anchor not found');
  shadowSource = shadowSource.replace(reportAnchor, reportBlock);

  const returnAnchor = `    lastSkip: String(state.lastSkip || \"\"),\n    startedAt:`;
  const returnBlock = `    lastSkip: String(state.lastSkip || \"\"),\n    shadowQuota: state.shadowQuota && typeof state.shadowQuota === \"object\" ? state.shadowQuota : null,\n    startedAt:`;
  if (!shadowSource.includes(returnAnchor)) throw new Error('report quota return anchor not found');
  shadowSource = shadowSource.replace(returnAnchor, returnBlock);

  const countAnchor = `  const rowCount = rowsAvailable ? live.rows.length : null;\n  const previousHealthAt`;
  const countBlock = `  const rowCount = rowsAvailable ? live.rows.length : null;\n  const shadowQuota =\n    live?.shadowQuota && typeof live.shadowQuota === \"object\"\n      ? live.shadowQuota\n      : null;\n  const previousHealthAt`;
  if (!shadowSource.includes(countAnchor)) throw new Error('shadowQuota observe anchor not found');
  shadowSource = shadowSource.replace(countAnchor, countBlock);

  const healthAnchor = `    state.rowCount !== rowCount ||\n    String(state.lastSkip || \"\") !== (sourceAvailable ? \"\" : \"source_unavailable\");`;
  const healthBlock = `    state.rowCount !== rowCount ||\n    JSON.stringify(state.shadowQuota || null) !== JSON.stringify(shadowQuota || null) ||\n    String(state.lastSkip || \"\") !== (sourceAvailable ? \"\" : \"source_unavailable\");`;
  if (!shadowSource.includes(healthAnchor)) throw new Error('health quota compare anchor not found');
  shadowSource = shadowSource.replace(healthAnchor, healthBlock);

  const assignAnchor = `  state.rowCount = rowCount;\n  state.lastSkip = sourceAvailable ? \"\" : \"source_unavailable\";`;
  const assignBlock = `  state.rowCount = rowCount;\n  state.shadowQuota = shadowQuota;\n  state.lastSkip = sourceAvailable ? \"\" : \"source_unavailable\";`;
  if (!shadowSource.includes(assignAnchor)) throw new Error('health quota assign anchor not found');
  shadowSource = shadowSource.replace(assignAnchor, assignBlock);

  const routeLoopAnchor = `  for (const route of live.rows) {\n    const proof = normalizeProof(route?.proofId);\n    if (!proof) continue;`;
  const routeLoopBlock = `  for (const route of live.rows) {\n    if (!isInboundShadowRoute(route?.attendanceType)) continue;\n    const proof = normalizeProof(route?.proofId);\n    if (!proof) continue;`;
  if (!shadowSource.includes(routeLoopAnchor)) throw new Error('routeByProof inbound anchor not found');
  shadowSource = shadowSource.replace(routeLoopAnchor, routeLoopBlock);

  const routeAnchor = `    const id = await shadowId(proof);\n    const route = routeByProof.get(proof);`;
  const routeBlock = `    const id = await shadowId(proof);\n    const route = routeByProof.get(proof);\n    // BusTime alone does not carry a trustworthy attendance type. Require a\n    // matching inbound Route schedule row so origin trips can never enter Shadow.\n    if (!route) continue;\n    const attendanceType = normalizeShadowAttendance(route?.attendanceType);`;
  if (!shadowSource.includes(routeAnchor)) throw new Error('candidate inbound route anchor not found');
  shadowSource = shadowSource.replace(routeAnchor, routeBlock);

  const recordAnchor = `        routeSeen,\n        leadMinutes: null,`;
  const recordBlock = `        routeSeen,\n        attendanceType,\n        leadMinutes: null,`;
  if (!shadowSource.includes(recordAnchor)) throw new Error('record attendance anchor not found');
  shadowSource = shadowSource.replace(recordAnchor, recordBlock);

  const pendingAnchor = `    if (record.status === \"pending\" && record.routeSeen !== routeSeen) {\n      record.routeSeen = routeSeen;\n      changed = true;\n    }`;
  const pendingBlock = `    if (record.status === \"pending\" && record.routeSeen !== routeSeen) {\n      record.routeSeen = routeSeen;\n      changed = true;\n    }\n    if (record.status === \"pending\" && record.attendanceType !== attendanceType) {\n      record.attendanceType = attendanceType;\n      changed = true;\n    }`;
  if (!shadowSource.includes(pendingAnchor)) throw new Error('pending attendance anchor not found');
  shadowSource = shadowSource.replace(pendingAnchor, pendingBlock);

  const rowsAnchor = `return \`<tr><td><code>\${escapeHtml(item.id)}</code></td><td>\${escapeHtml(label)}</td><td>\${escapeHtml(displayTime(item.tbrAt))}</td><td>\${escapeHtml(displayTime(item.kitAt))}</td><td>\${escapeHtml(displayTime(item.confirmedAt || item.expiredAt))}</td><td>\${item.leadMinutes == null ? \"-\" : \`\${escapeHtml(item.leadMinutes)} นาที\`}</td></tr>\`;`;
  const rowsBlock = `return \`<tr><td><code>\${escapeHtml(item.id)}</code></td><td>\${escapeHtml(item.attendanceType || \"-\")}</td><td>\${escapeHtml(label)}</td><td>\${escapeHtml(displayTime(item.tbrAt))}</td><td>\${escapeHtml(displayTime(item.kitAt))}</td><td>\${escapeHtml(displayTime(item.confirmedAt || item.expiredAt))}</td><td>\${item.leadMinutes == null ? \"-\" : \`\${escapeHtml(item.leadMinutes)} นาที\`}</td></tr>\`;`;
  if (!shadowSource.includes(rowsAnchor)) throw new Error('table row attendance anchor not found');
  shadowSource = shadowSource.replace(rowsAnchor, rowsBlock);

  shadowSource = shadowSource.replace(
    `const body = rows || '<tr><td colspan=\"6\" class=\"empty\">ยังไม่มี TBR candidate ที่ต้องบันทึกใน Shadow</td></tr>';`,
    `const body = rows || '<tr><td colspan=\"7\" class=\"empty\">ยังไม่มี TBR candidate ปลายทาง/จุดดรอปที่ต้องบันทึกใน Shadow</td></tr>';`,
  );

  shadowSource = shadowSource.replace(
    `ทดลองจับคิวจาก TBR ก่อน Route · ไม่กระทบคิวจริง`,
    `ทดลองจับ TBR รถเข้า: ปลายทาง + จุดดรอป · ไม่เอาต้นทาง · ไม่กระทบคิวจริง`,
  );

  const tableHeadOld = `<th>Shadow ID</th><th>สถานะ</th><th>TBR</th><th>KIT</th><th>ยืนยัน/หมดเวลา</th><th>รู้เร็วขึ้น</th>`;
  const tableHeadNew = `<th>Shadow ID</th><th>ประเภทงาน</th><th>สถานะ</th><th>TBR</th><th>KIT</th><th>ยืนยัน/หมดเวลา</th><th>รู้เร็วขึ้น</th>`;
  if (!shadowSource.includes(tableHeadOld)) throw new Error('table header anchor not found');
  shadowSource = shadowSource.replace(tableHeadOld, tableHeadNew);

  const safeOld = `<div class=\"safe\">Turso Read 0 · Write 0 สำหรับหน้ารายงานนี้</div>`;
  const safeNew = `<div class=\"safe\">Shadow report Turso 0/0 · Source \${escapeHtml(report?.shadowQuota?.mode || \"-\")} · point read/cron \${escapeHtml(report?.shadowQuota?.tursoPointReadsPerCron ?? \"-\")} · write/cron \${escapeHtml(report?.shadowQuota?.tursoWritesPerCron ?? \"-\")}</div>`;
  if (!shadowSource.includes(safeOld)) throw new Error('quota badge anchor not found');
  shadowSource = shadowSource.replace(safeOld, safeNew);
}

fs.writeFileSync(indexFile, indexSource);
fs.writeFileSync(shadowFile, shadowSource);
console.log('TBR_INBOUND_QUOTA_PATCH=PASS');
