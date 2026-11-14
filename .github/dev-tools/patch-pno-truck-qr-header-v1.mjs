// WTR009_TRUCK_PROOF_QR_HEADER_V1 — additive UI-only header QR, local proposal.
// Barcode payload is exactly the active proofId; never routeName or a URL.
const marker = 'WTR009_TRUCK_PROOF_QR_HEADER_V1';
const render = String.raw`
// WTR009_TRUCK_PROOF_QR_HEADER_V1: read-only barcode for the current opened truck.
function pnoTruckQrRenderV1() {
  const dialog = el('pending-parcels-dialog');
  const head = dialog?.querySelector('.pno-v18-head');
  if (!head || typeof PnoQr009 === 'undefined') return;
  let slot = head.querySelector('#pno-truck-qr-v1');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'pno-truck-qr-v1';
    slot.className = 'pno-truck-qr-v1';
    head.append(slot);
  }
  // Never carry an image over from the previously opened truck.
  slot.replaceChildren();
  const code = pnoV18State.proofId;
  const fromRow = pnoV18State.sourceRow?.proofId;
  if (typeof code !== 'string' || code !== fromRow || !PnoQr009.valid(code)) {
    slot.hidden = true;
    return;
  }
  try {
    const img = document.createElement('img');
    img.alt = 'QR บาร์รถ ' + code;
    img.src = pnoQrUri009(code); // Reuse existing offline QR generator/cache.
    const label = document.createElement('span');
    label.textContent = code;
    slot.append(img, label);
    slot.hidden = false;
  } catch (_) {
    slot.replaceChildren();
    slot.hidden = true; // No fake QR if encoding failed.
  }
  if (!document.getElementById('pno-truck-qr-v1-style')) {
    const style = document.createElement('style');
    style.id = 'pno-truck-qr-v1-style';
    style.textContent = '.ms-page #pending-parcels-dialog .pno-v18-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px;padding:12px 42px 10px 16px}' +
      '.ms-page #pending-parcels-dialog .pno-v18-head>div:first-child{min-width:0;overflow-wrap:anywhere}' +
      '.ms-page .pno-truck-qr-v1{display:flex;flex:none;width:88px;max-width:100%;box-sizing:border-box;align-items:center;flex-direction:column;gap:2px;padding:3px;border:1px solid #e2e8f0;border-radius:6px;background:#fff}' +
      '.ms-page .pno-truck-qr-v1[hidden]{display:none}' +
      '.ms-page .pno-truck-qr-v1 img{display:block;width:80px;height:80px;max-width:100%;aspect-ratio:1;object-fit:contain;image-rendering:pixelated}' +
      '.ms-page .pno-truck-qr-v1 span{max-width:100%;font-size:11px;line-height:1.3;font-weight:800;color:#20252b;letter-spacing:.1px;overflow-wrap:anywhere;text-align:center}' +
      '@media(max-width:560px){.ms-page #pending-parcels-dialog .pno-v18-head{padding:10px 36px 10px 12px;gap:8px}.ms-page .pno-truck-qr-v1{width:80px}.ms-page .pno-truck-qr-v1 img{width:72px;height:72px}.ms-page .pno-truck-qr-v1 span{font-size:10px}}';
    document.head.append(style);
  }
}
`;

export function patchPnoTruckQrHeaderV1(source) {
  if (typeof source !== 'string') throw Error('TRUCK_QR_SOURCE_NOT_STRING');
  if (source.includes(marker)) return source;
  for (const required of [
    'function pnoQrUri009(', 'scope.PnoQr009=Object.freeze(',
    'openPendingParcels = async function pnoV18OpenPendingParcels('
  ]) if (!source.includes(required)) throw Error('TRUCK_QR_MISSING_DEPENDENCY: ' + required);

  const begin = source.indexOf('openPendingParcels = async function pnoV18OpenPendingParcels(');
  const end = source.indexOf('\n}\n', begin);
  if (end < 0) throw Error('TRUCK_QR_OPEN_FUNCTION_NOT_FOUND');
  let open = source.slice(begin, end + 2);
  const anchor = '  const owner = typeof pnoAsyncCapture === "function" ? pnoAsyncCapture() : null;';
  const occurrences = open.split(anchor).length - 1;
  if (occurrences !== 1 || !open.includes('pnoV18State.proofId = args.proofId;') ||
      !open.includes('el("pending-parcels-trip").textContent'))
    throw Error('TRUCK_QR_OPEN_ANCHOR_CHANGED');
  open = open.replace(anchor, '  pnoTruckQrRenderV1();\n' + anchor);
  return source.slice(0, begin) + open + source.slice(end + 2) + '\n' + render;
}
