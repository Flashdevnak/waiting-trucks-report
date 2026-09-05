from pathlib import Path

p = Path('ms.js')
s = p.read_text()
if 'LOCAL_ROUTE_BARCODE_V1' in s:
    print('already patched')
    raise SystemExit(0)

old = '''    const cancelButton = event.target.closest("[data-cancel-ms-route]");\n    if (cancelButton) openCancelMsRoute(cancelButton.dataset.cancelMsRoute);'''
new = '''    const barcodeButton = event.target.closest("[data-local-barcode-toggle]");\n    if (barcodeButton) toggleLocalRouteBarcode(barcodeButton);\n    const cancelButton = event.target.closest("[data-cancel-ms-route]");\n    if (cancelButton) openCancelMsRoute(cancelButton.dataset.cancelMsRoute);'''
if old not in s:
    raise SystemExit('click hook anchor missing')
s = s.replace(old, new, 1)

anchor = 'function tableRow(row) {'
if anchor not in s:
    raise SystemExit('tableRow anchor missing')
block = r'''// LOCAL_ROUTE_BARCODE_V1: destination/drop only. Pure client-side Code 128; no API, MS, or database request.
const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"
];

function localBarcodeEligible(row) {
  return Boolean(String(row?.proofId || "").trim()) && (isDestination(row) || isDrop(row));
}

function localBarcodeButton(row) {
  if (!localBarcodeEligible(row)) return "";
  const value = encodeURIComponent(String(row.proofId).trim());
  return `<div class="local-route-barcode"><button type="button" class="local-barcode-toggle" data-local-barcode-toggle data-barcode-value="${esc(value)}" aria-expanded="false">▥ ดูบาร์โค้ด</button><div class="local-barcode-panel hidden" aria-label="บาร์โค้ดรถ"></div></div>`;
}

function code128Svg(value) {
  const text = String(value || "").trim();
  if (!text || [...text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126))
    return `<div class="local-barcode-error">เลขบาร์รถนี้สร้างบาร์โค้ดไม่ได้</div>`;
  const codes = [104, ...[...text].map((ch) => ch.charCodeAt(0) - 32)];
  let checksum = 104;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103, 106);
  const quiet = 10, module = 2, barHeight = 58, labelHeight = 22;
  let x = quiet, rects = "";
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) rects += `<rect x="${x * module}" y="0" width="${width * module}" height="${barHeight}"/>`;
      x += width;
    }
  }
  const total = (x + quiet) * module;
  return `<svg class="local-barcode-svg" viewBox="0 0 ${total} ${barHeight + labelHeight}" role="img" aria-label="บาร์โค้ด ${esc(text)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${rects}<text x="${total/2}" y="${barHeight + 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#111">${esc(text)}</text></svg>`;
}

function toggleLocalRouteBarcode(button) {
  const wrap = button.closest(".local-route-barcode");
  const panel = wrap?.querySelector(".local-barcode-panel");
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  if (opening && !panel.dataset.ready) {
    panel.innerHTML = code128Svg(decodeURIComponent(button.dataset.barcodeValue || ""));
    panel.dataset.ready = "1";
  }
  panel.classList.toggle("hidden", !opening);
  button.setAttribute("aria-expanded", opening ? "true" : "false");
  button.textContent = opening ? "ซ่อนบาร์โค้ด" : "▥ ดูบาร์โค้ด";
}

function installLocalBarcodeStyle() {
  if (document.getElementById("local-route-barcode-style")) return;
  const style = document.createElement("style");
  style.id = "local-route-barcode-style";
  style.textContent = `.local-route-barcode{margin-top:9px}.local-barcode-toggle{appearance:none;border:1px solid #c7a000;background:#ffd53d;color:#161616;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:800;cursor:pointer}.local-barcode-toggle:hover{background:#ffcb05}.local-barcode-panel{margin-top:8px;padding:8px;background:#fff;border:1px solid #cfd5d9;border-radius:8px;max-width:390px}.local-barcode-svg{display:block;width:100%;height:auto;max-height:96px}.local-barcode-error{font-size:12px;color:#a51f1f;font-weight:700}.compact-card-head .local-route-barcode{display:flex;flex-direction:column;align-items:center}.compact-card-head .local-barcode-panel{width:min(100%,390px)}@media(max-width:700px){.local-barcode-toggle{min-height:38px;font-size:13px}.local-barcode-panel{max-width:100%}}`;
  document.head.appendChild(style);
}
installLocalBarcodeStyle();

'''
s = s.replace(anchor, block + anchor, 1)

old1 = '${expectedParcelsBadge(row)}</div></td>'
new1 = '${expectedParcelsBadge(row)}${localBarcodeButton(row)}</div></td>'
if old1 not in s:
    raise SystemExit('desktop barcode anchor missing')
s = s.replace(old1, new1, 1)

old2 = '${expectedParcelsBadge(row)}</header>'
new2 = '${expectedParcelsBadge(row)}${localBarcodeButton(row)}</header>'
if old2 not in s:
    raise SystemExit('mobile barcode anchor missing')
s = s.replace(old2, new2, 1)

p.write_text(s)
print('patched ms.js')
