// DEV-only visual stability and destination tables. No fetching, DB writes or source changes.
const MARKER = 'PNO_DESTINATION_TABLES_STABILITY_V1';

export function pnoDestinationTableMarkup(summary, scopeLabel, stateLabel = '') {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf = new Intl.NumberFormat('th-TH');
  const title = '<header><h3>สรุปปลายทางพัสดุ</h3><p>' + esc(scopeLabel) + '</p></header>';
  if (summary.status !== 'COMPLETE')
    return title + '<p class="pno-destination-state" role="status">' + esc(stateLabel || 'ข้อมูลยังไม่ครบทุกหน้า · ยังไม่แสดงยอดปลายทาง') + '</p>';
  const section = (heading, name, entries, total, footerLabel) => {
    const rows = entries.map((row, index) => {
      const percentage = total > 0 ? (row.count * 100 / total).toFixed(1) : '0.0';
      return '<tr><td class="pno-destination-index">' + nf.format(index + 1) + '</td>' +
        '<td class="pno-destination-name" title="' + esc(row.identity) + '">' + esc(row.label) + '</td>' +
        '<td class="pno-destination-number">' + nf.format(row.count) + '</td>' +
        '<td class="pno-destination-percent">' + percentage + '%</td></tr>';
    }).join('');
    return '<section class="pno-destination-section"><h4>' + esc(heading) + '</h4>' +
      '<div class="pno-destination-table-scroll" role="region" tabindex="0" aria-label="' + esc(heading) + '">' +
      '<table class="pno-destination-table"><thead><tr><th scope="col">#</th><th scope="col">' + esc(name) +
      '</th><th scope="col">จำนวน (ชิ้น)</th><th scope="col">สัดส่วน</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="pno-destination-empty">ไม่พบรายการในขอบเขตนี้</td></tr>') +
      '</tbody></table></div><footer><span>' + esc(footerLabel) + ' · ' + nf.format(entries.length) + ' รายการ</span>' +
      '<b>' + nf.format(total) + ' ชิ้น</b></footer></section>';
  };
  return title + '<div class="pno-destination-columns">' +
    section('สาขาปลายทางใน HUB ของเรา · ' + summary.currentHub, 'สาขาปลายทาง', summary.own, summary.ownTotal,
      'รวมส่งสาขาภายใน ' + summary.currentHub) +
    section('ฮับปลายทางอื่น', 'HUB ปลายทาง', summary.other, summary.otherTotal, 'รวมฮับปลายทางอื่น') + '</div>' +
    (summary.unclassified ? '<p class="pno-destination-unknown"><span>ไม่สามารถจำแนกปลายทางได้</span><b>' + nf.format(summary.unclassified) + ' ชิ้น</b></p>' : '') +
    '<p class="pno-destination-total">รวมพัสดุตามขอบเขตและตัวกรองนี้ <b>' + nf.format(summary.total) + ' ชิ้น</b></p>';
}

export const PNO_DESTINATION_UX_STYLE = `
.ms-page .pno-destination-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
.ms-page .pno-destination-columns .pno-destination-section{min-width:0;overflow:hidden;border:1px solid #d9dfe4;border-radius:8px}
.ms-page .pno-destination-columns .pno-destination-section h4{font-size:14px;line-height:1.45;padding:10px 12px;background:#f2f5f7;border-bottom:1px solid #dce1e5}
.ms-page .pno-destination-table-scroll{max-height:292px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.ms-page .pno-destination-table-scroll:focus-visible{outline:2px solid #edc600;outline-offset:-2px}
.ms-page .pno-destination-table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;font-size:12.5px}
.ms-page .pno-destination-table th{position:sticky;top:0;z-index:1;background:#252525;color:#fff;text-align:left;padding:9px 8px;white-space:nowrap;font-size:11px;font-weight:800}
.ms-page .pno-destination-table td{padding:9px 8px;border-bottom:1px solid #e7eaed;vertical-align:middle;line-height:1.4}
.ms-page .pno-destination-table tbody tr:nth-child(even){background:#f7f9fa}
.ms-page .pno-destination-table tbody tr:hover{background:#fff7d8}
.ms-page .pno-destination-table th:nth-child(1),.ms-page .pno-destination-table td:nth-child(1){width:38px;text-align:center}
.ms-page .pno-destination-table th:nth-child(3),.ms-page .pno-destination-table td:nth-child(3){width:100px;text-align:right}
.ms-page .pno-destination-table th:nth-child(4),.ms-page .pno-destination-table td:nth-child(4){width:72px;text-align:right}
.ms-page .pno-destination-table .pno-destination-name{overflow-wrap:anywhere;font-weight:650}
.ms-page .pno-destination-table .pno-destination-number{font-size:14px;font-weight:900;font-variant-numeric:tabular-nums}
.ms-page .pno-destination-table .pno-destination-percent{font-size:12px;font-variant-numeric:tabular-nums;color:#59616b}
.ms-page .pno-destination-columns footer{position:relative;background:#f4f6f8}
.ms-page .pno-destination-summary header>p{line-height:1.45;margin-bottom:10px;max-height:48px;overflow:auto}
.ms-page .pno-destination-verified-note{color:#725309;font-size:12px;font-weight:800;margin:4px 0 10px;padding:7px 10px;background:#fff9e8;border:1px solid #f2dc9b;border-radius:5px}
@media(max-width:820px){.ms-page .pno-destination-columns{grid-template-columns:1fr}.ms-page .pno-destination-table-scroll{max-height:250px}}
@media(max-width:420px){.ms-page .pno-destination-table th:nth-child(3),.ms-page .pno-destination-table td:nth-child(3){width:79px}.ms-page .pno-destination-table th:nth-child(4),.ms-page .pno-destination-table td:nth-child(4){width:58px}}
`;

function replaceExactlyOne(source, from, to, label) {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + from.length) >= 0)
    throw Error(MARKER + ': missing or duplicate ' + label);
  return source.slice(0, at) + to + source.slice(at + from.length);
}

export function patchPnoDestinationTablesStability(source) {
  let output = String(source || '');
  if (output.includes('// ' + MARKER + ': applied')) return output;
  if (!output.includes('PNO_DESTINATION_SUMMARY_REV73') || !output.includes('PNO_ALL_PAGE_FILTER_TRUTH_V1'))
    throw Error(MARKER + ': original verified all-page summary missing');
  // Replace display-only function after verified base aggregation; rows and identities are untouched.
  const start = output.indexOf('function pnoDestinationMarkup(');
  const end = output.indexOf('\n}\n', start) + 2;
  if (start < 0 || end < 2) throw Error(MARKER + ': summary markup boundary missing');
  output = output.slice(0, start) + pnoDestinationTableMarkup.toString().replace('function pnoDestinationTableMarkup(', 'function pnoDestinationMarkup(') + output.slice(end);
  const anchor = '(function pnoDestinationRuntime() {';
  output = replaceExactlyOne(output, anchor,
    '// ' + MARKER + ': applied; same validated totals, dual destination tables, stable rendering.\n' +
    'const PNO_DESTINATION_UX_STYLE = ' + JSON.stringify(PNO_DESTINATION_UX_STYLE) + ';\n' + anchor,
    'style preamble');
  output = replaceExactlyOne(output,
    'style.textContent = PNO_DESTINATION_STYLE; document.head.append(style);',
    'style.textContent = PNO_DESTINATION_STYLE + PNO_DESTINATION_UX_STYLE; document.head.append(style);', 'destination CSS');
  output = replaceExactlyOne(output, '  let coverage = null;\n  function scopeKey()',
    '  let coverage = null;\n  let lastAcceptedKey = "", lastAcceptedSummary = null;\n  function scopeKey()',
    'accepted exact-scope summary');
  output = replaceExactlyOne(output,
    '    const summary = pnoDestinationAggregate(rows, state.branch, complete);',
    `    const summary = pnoDestinationAggregate(rows, state.branch, complete);
    const detailKey = key + '|' + pnoV18FilterSummaryText();
    if (complete && summary.status === 'COMPLETE') {
      lastAcceptedKey = detailKey;
      lastAcceptedSummary = summary;
    }`,
    'commit summary only once validated');
  output = replaceExactlyOne(output,
    '    panel.innerHTML = pnoDestinationMarkup(summary, scope, status);',
    `    // Do not erase a verified SAME-SCOPE table during a transient view rebuild.
    // Label retained values clearly; never reuse across changed HUB, trip, counts, tab or filter error.
    const retained = !complete && !pnoV18State.filterError && coverage?.valid !== false &&
      lastAcceptedKey === detailKey && lastAcceptedSummary && type !== 'bag';
    const next = retained ? lastAcceptedSummary : summary;
    const note = retained ? '<p class="pno-destination-verified-note" role="status">ข้อมูลล่าสุดที่ยืนยันครบแล้ว · กำลังตรวจข้อมูลรอบใหม่ (ไม่ใช่ยอดสด)</p>' : '';
    const keyChanged = Boolean(lastAcceptedKey) && lastAcceptedKey !== detailKey;
    const displayStatus = keyChanged && type !== 'bag' && !pnoV18State.filterPromise && !pnoV18State.filterError
      ? 'ข้อมูลเที่ยวรถหรือตัวกรองเปลี่ยนแล้ว · เปิดรายการนี้ใหม่เพื่อยืนยันข้อมูลทุกหน้า'
      : status;
    const markup = pnoDestinationMarkup(next, scope, displayStatus) + note;
    // Avoid resetting scroll and reflow on each unrelated MS live refresh.
    if (panel.innerHTML !== markup) panel.innerHTML = markup;`,
    'nonflicker display');
  output = replaceExactlyOne(output,
    'coverage = null; safeRender(); return result; };',
    'coverage = null; lastAcceptedKey = ""; lastAcceptedSummary = null; safeRender(); return result; };',
    'modal reset');
  return output;
}
