const MARKER = "PNO_SCAN_EVIDENCE_TRUTH_UX_V2";

// Labels describe only action codes already accepted by the evidence contract.
// A missing name/code never creates a stage or changes classification.
function pnoV18ParcelAction(item) {
  const labels = {
    ARRIVAL_GOODS_VAN_CHECK_SCAN: "รถถึงสาขา",
    ARRIVAL_WAREHOUSE_SCAN: "สแกนเข้าคลัง",
    SHIPMENT_WAREHOUSE_SCAN: "สแกนออกคลัง",
    SEAL: "ปิดผนึก",
    DRIVER_SIGN: "คนขับลงชื่อรับ",
    DEPARTURE_GOODS_VAN_CK_SCAN: "รถออกจากสาขา",
    RECEIVE_WAREHOUSE_SCAN: "สแกนรับเข้าคลัง",
    RECEIVED: "รับพัสดุ",
  };
  const name = String(item?.lastAction || "").trim();
  const code = String(item?.lastActionCode || "").trim();
  if (labels[name]) return labels[name];
  if (name && name !== "-") return name;
  return labels[code] || "การดำเนินการล่าสุดยังไม่พร้อม";
}

export function patchPnoScanEvidenceUx(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  if (!output.includes("PNO_ALL_PAGE_FILTER_TRUTH_V1"))
    throw new Error(`${MARKER}: complete filter staging required`);
  const start = output.indexOf("function pnoV18ParcelAction(");
  const end = output.indexOf("\n}\n", start) + 2;
  if (start < 0 || end < 2) throw new Error(`${MARKER}: action projection missing`);
  output = output.slice(0, start) + pnoV18ParcelAction.toString() + output.slice(end);
  const before = `      el("pno-v18-filter-result").textContent = "ทั้งหมด " + nf.format(pnoV18State.filterRows.length) +
        " · ผลกรอง " + nf.format(entries.length) + " · แสดงหน้านี้ " + nf.format(visible.length);`;
  if (output.split(before).length !== 2) throw new Error(`${MARKER}: evidence count scope missing`);
  output = output.replace(before,
    `      el("pno-v18-filter-result").textContent = "ข้อมูลพัสดุผู้ให้บริการ " + nf.format(pnoV18State.total) +
        " · รายการตรวจสแกนเข้าตามตัวกรอง " + nf.format(entries.length) + " · แสดงหน้านี้ " + nf.format(visible.length);`);
  return output + `\n// ${MARKER}: current-page truth, explicit unknowns, no acquisition.\n`;
}
