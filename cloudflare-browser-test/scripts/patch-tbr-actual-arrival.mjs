import fs from 'node:fs';

const file = process.argv[2] || 'src/tbr-shadow.js';
let source = fs.readFileSync(file, 'utf8');

const marker = 'TBR_ROUTE_ACTUAL_ARRIVAL_V2';
if (!source.includes(marker)) {
  const oldRouteSetup = `    const id = await shadowId(proof);\n    const route = routeByProof.get(proof);\n    let record = state.records[id];`;
  const newRouteSetup = `    const id = await shadowId(proof);\n    const route = routeByProof.get(proof);\n    // ${marker}: a scheduled Route row is not proof that the truck has arrived.\n    // Only actualArrivalAt closes the TBR-before-Route observation.\n    const routeActualMs = validTime(route?.actualArrivalAt);\n    let record = state.records[id];`;
  if (!source.includes(oldRouteSetup)) throw new Error('route setup anchor not found');
  source = source.replace(oldRouteSetup, newRouteSetup);

  const oldNewRecord = `    if (!record) {\n      if (route || now - tbrMs > SHADOW_PENDING_MS) continue;`;
  const newNewRecord = `    if (!record) {\n      if (routeActualMs !== null || now - tbrMs > SHADOW_PENDING_MS) continue;`;
  if (!source.includes(oldNewRecord)) throw new Error('new record route anchor not found');
  source = source.replace(oldNewRecord, newNewRecord);

  const oldConfirm = `    if (route) {\n      const actualMs = validTime(route?.actualArrivalAt);\n      const routeMs = actualMs === null ? now : actualMs;\n      record.status = \"confirmed\";\n      record.confirmedAt = nowIso;\n      record.routeActualArrivalAt =\n        actualMs === null ? \"\" : new Date(actualMs).toISOString();\n      record.leadMinutes = Math.round((routeMs - tbrMs) / 60000);\n      changed = true;\n    }`;
  const newConfirm = `    if (routeActualMs !== null) {\n      const routeMs = routeActualMs;\n      record.status = \"confirmed\";\n      record.confirmedAt = nowIso;\n      record.routeActualArrivalAt = new Date(routeActualMs).toISOString();\n      record.leadMinutes = Math.round((routeMs - tbrMs) / 60000);\n      changed = true;\n    }`;
  if (!source.includes(oldConfirm)) throw new Error('confirmation route anchor not found');
  source = source.replace(oldConfirm, newConfirm);

  const oldHealth = ` · ตรวจ source ล่าสุด \${escapeHtml(displayTime(report?.lastAttemptAt))} · รับข้อมูลสำเร็จล่าสุด \${escapeHtml(displayTime(report?.lastObservedAt))}`;
  const newHealth = ` · Cron ทุก 1 นาที · Heartbeat KV ล่าสุด \${escapeHtml(displayTime(report?.lastObservedAt))}`;
  if (!source.includes(oldHealth)) throw new Error('health label anchor not found');
  source = source.replace(oldHealth, newHealth);

  const oldFoot = ` · หน้านี้รีเฟรชทุก 60 วินาที · ID ถูก hash ไม่แสดงบาร์โค้ดจริง`;
  const newFoot = ` · หน้านี้รีเฟรชทุก 60 วินาที · Heartbeat KV ถูก throttle สูงสุด 5 นาทีเพื่อลด quota · รายการ TBR เปลี่ยนจะบันทึกทันที · ID ถูก hash ไม่แสดงบาร์โค้ดจริง`;
  if (!source.includes(oldFoot)) throw new Error('footer anchor not found');
  source = source.replace(oldFoot, newFoot);
}

const leadMarker = 'TBR_LEAD_NULL_V1';
if (!source.includes(leadMarker)) {
  const oldLead = `      leadMinutes: Number.isFinite(Number(item?.leadMinutes))\n        ? Number(item.leadMinutes)\n        : null,`;
  const newLead = `      // ${leadMarker}: pending/expired records with null lead must stay null.\n      // Number(null) is 0, which incorrectly rendered \"0 นาที\" before Route confirmation.\n      leadMinutes:\n        item?.leadMinutes === null || item?.leadMinutes === undefined || item?.leadMinutes === \"\"\n          ? null\n          : Number.isFinite(Number(item.leadMinutes))\n            ? Number(item.leadMinutes)\n            : null,`;
  if (!source.includes(oldLead)) throw new Error('leadMinutes null anchor not found');
  source = source.replace(oldLead, newLead);
}

fs.writeFileSync(file, source);
console.log('TBR_ACTUAL_ARRIVAL_PATCH=PASS');
console.log('TBR_LEAD_NULL_PATCH=PASS');
