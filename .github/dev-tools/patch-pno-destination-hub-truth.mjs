const MARKER = "PNO_AUTHORITATIVE_DESTINATION_HUB_V1";

function replaceUnique(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0)
    throw new Error(`${MARKER}: ${label} anchor missing or repeated`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchPnoDestinationHubWorker(source) {
  const output = String(source || "");
  if (output.includes(MARKER)) return output;
  const staged = replaceUnique(output,
    "      targetHub: cleanStoreName(row.next_hub_name || row.target_hub_name || row.dst_hub_name || row.destination_hub_name || row.ticket_delivery_hub_name || row.end_hub_name || row.next_store_name || row.hub_name || row.targetHub),",
    "      targetHub: cleanStoreName(row.dst_hub_name),",
    "PNO detail projection");
  return `${staged}\n// ${MARKER}: PNO detail destination from dst_hub_name only.\n`;
}

export function patchPnoDestinationHubFrontend(source) {
  let output = String(source || "");
  if (output.includes(MARKER)) return output;
  const neutralLabel = "จุดที่ระบุในข้อมูลพัสดุ";
  const count = output.split(neutralLabel).length - 1;
  if (count !== 5) throw new Error(`${MARKER}: expected five parcel destination labels, found ${count}`);
  output = output.replaceAll(neutralLabel, "ฮับปลายทาง");
  output = replaceUnique(output,
    `function pnoV18BagSummary(items) {
  const sourceRow = pnoV18SourceRow();
  // HUB ถัดไป is route-level next_store_name, never a mix of parcel final HUBs.
  const nextHub = pnoV18TextValue(
    sourceRow?.pnoNextStoreName || sourceRow?.nextStoreName || state.branch
  );
  return {
    status: pnoV18BagValue(items, (item) => item.status || item.lastAction, "หลายสถานะ"),
    latest: pnoV18BagLatest(items),
    hub: nextHub,
    branch: pnoV18BagValue(items, (item) => item.targetBranch, "หลายสาขา"),
  };
}`,
    `function pnoV18BagSummary(items) {
  return {
    status: pnoV18BagValue(items, (item) => item.status || item.lastAction, "หลายสถานะ"),
    latest: pnoV18BagLatest(items),
    hub: pnoV18BagValue(items, (item) => item.targetHub, "หลาย HUB"),
    branch: pnoV18BagValue(items, (item) => item.targetBranch, "หลายสาขา"),
  };
}`,
    "bag destination HUB aggregation");
  return `${output}\n// ${MARKER}: PNO parcel destination from dst_hub_name; bag HUB from parcel targetHub.\n`;
}
