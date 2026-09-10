import { readFileSync, writeFileSync } from 'node:fs';

const stylePath = 'style.css';
const htmlPath = 'ms.html';
let style = readFileSync(stylePath, 'utf8');
let html = readFileSync(htmlPath, 'utf8');

for (const marker of [
  '/* MS_TABLE_DENSITY_V2: compact desktop columns and aligned mobile cards. */',
  '/* MS_TABLE_DENSITY_V3: balanced desktop table and dense aligned mobile cards. */',
]) {
  if (style.includes(marker)) style = style.split(marker, 1)[0].trimEnd() + '\n';
}

const block = String.raw`
/* MS_TABLE_DENSITY_V3: balanced desktop table and dense aligned mobile cards. */
@media (min-width: 1025px) {
  .ms-page .ms-table {
    min-width: 1200px;
    table-layout: fixed;
  }
  .ms-page .ms-table col.col-route { width: 20%; }
  .ms-page .ms-table col.col-meta { width: 9%; }
  .ms-page .ms-table col.col-work { width: 8%; }
  .ms-page .ms-table col.col-schedule { width: 21%; }
  .ms-page .ms-table col.col-status { width: 32%; }
  .ms-page .ms-table col.col-company { width: 10%; }

  .ms-page .ms-table thead th {
    padding: 7px 6px;
    font-size: 11px;
    line-height: 1.2;
    text-align: center;
    white-space: normal;
  }
  .ms-page .ms-table tbody td {
    padding: 7px 6px;
    line-height: 1.25;
  }
  .ms-page .route-summary { text-align: center; }
  .ms-page .route-title { font-size: 12px; line-height: 1.3; }
  .ms-page .route-code strong { font-size: 13px; }
  .ms-page .attendance-cell { gap: 4px; }
  .ms-page .attendance-cell .row-muted { font-size: 10px; line-height: 1.2; }
  .ms-page .type-badge { min-width: 74px; padding: 4px 7px; font-size: 10px; }

  .ms-page .schedule-stack.single { border-radius: 6px; }
  .ms-page .schedule-stack.single .schedule-section.arrival { padding-bottom: 5px; }
  .ms-page .schedule-stack.single .schedule-heading {
    padding: 5px 6px 3px;
    font-size: 10px;
    line-height: 1.15;
  }
  .ms-page .schedule-stack.single .schedule-values {
    gap: 4px;
    padding: 4px 5px 1px;
  }
  .ms-page .schedule-stack.single .schedule-values:after { top: 5px; bottom: 2px; }
  .ms-page .schedule-stack.single .schedule-values b {
    margin-bottom: 2px;
    font-size: 9px;
    line-height: 1.15;
  }
  .ms-page .schedule-stack.single .schedule-values strong {
    font-size: 11px;
    line-height: 1.2;
  }
  .ms-page .schedule-stack.single .timing-chip {
    margin-top: 4px;
    padding: 3px 7px;
    font-size: 9px;
    line-height: 1.15;
  }
  .ms-page .arrival-system-row > div {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 3px 2px 4px;
  }
  .ms-page .arrival-system-row > div span {
    gap: 2px;
    padding: 3px 2px;
    font-size: 9px;
  }
  .ms-page .arrival-system-row em { font-size: 9px; }
  .ms-page .arrival-source-value {
    font-size: 10px;
    line-height: 1.2;
    white-space: normal;
  }

  .ms-page .operation-compact { gap: 4px; }
  .ms-page .classic-operation-center .classic-status-chip {
    min-height: 23px;
    padding: 4px 8px;
    font-size: 10px;
    line-height: 1.1;
  }
  .ms-page .classic-operation-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    border-radius: 6px;
  }
  .ms-page .classic-operation-fact {
    min-height: 34px;
    padding: 4px 5px;
    gap: 1px;
  }
  .ms-page .classic-operation-fact.is-wide {
    grid-column: 1 / -1;
    min-height: 32px;
  }
  .ms-page .classic-operation-fact > span {
    font-size: 9px;
    line-height: 1.1;
  }
  .ms-page .classic-operation-fact > strong {
    font-size: 11px;
    line-height: 1.18;
    overflow-wrap: normal;
  }
  .ms-page .classic-operation-summary.compact-summary {
    display: grid;
    grid-template-columns: minmax(68px, .65fr) minmax(0, 1.35fr);
    align-items: center;
    min-height: 30px;
    gap: 5px;
    padding: 4px 7px;
  }
  .ms-page .classic-operation-summary.compact-summary > span {
    font-size: 9px;
    line-height: 1.1;
  }
  .ms-page .classic-operation-summary.compact-summary > strong {
    font-size: 10px;
    line-height: 1.15;
  }
  .ms-page .ms-table tbody td:last-child {
    font-size: 11px;
    line-height: 1.25;
  }
}

@media (max-width: 1024px) {
  .ms-page #mobile-cards {
    gap: 7px;
    padding: 6px;
  }
  .ms-page .compact-card {
    width: 100%;
    margin: 0;
    padding: 0;
    border-radius: 9px;
    overflow: hidden;
  }
  .ms-page .compact-card-head {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    column-gap: 6px;
    row-gap: 4px;
    padding: 9px 9px 8px;
  }
  .ms-page .compact-card-tags {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    gap: 6px;
    width: 100%;
  }
  .ms-page .compact-card-tags .vehicle-chip,
  .ms-page .compact-card-tags .compact-work-type,
  .ms-page .compact-card-tags .type-badge {
    width: 100%;
    min-width: 0;
  }
  .ms-page .compact-card-tags .vehicle-chip,
  .ms-page .compact-card-tags .type-badge {
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 7px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.1;
  }
  .ms-page .compact-work-type { gap: 2px; }
  .ms-page .compact-work-type > small {
    font-size: 9px;
    line-height: 1.05;
  }
  .ms-page .compact-card-head h2,
  .ms-page .compact-card-head p,
  .ms-page .compact-card-head > small {
    grid-column: 1 / -1;
    width: 100%;
    margin: 0;
    text-align: center;
  }
  .ms-page .compact-card-head h2 {
    font-size: 18px;
    line-height: 1.2;
  }
  .ms-page .compact-card-head p {
    font-size: 11px;
    line-height: 1.25;
  }
  .ms-page .compact-card-head > small {
    font-size: 10px;
    line-height: 1.2;
  }
  .ms-page .compact-card-head .expected-parcels-badge {
    grid-column: 1;
    width: 100%;
    min-height: 35px;
    margin: 2px 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 7px;
    font-size: 11px;
    line-height: 1.1;
  }
  .ms-page .compact-card-head .local-route-barcode {
    grid-column: 1 / -1;
    width: min(100%, 180px);
    margin: 2px auto 0;
  }
  .ms-page .compact-card-head:has(.expected-parcels-badge) .local-route-barcode {
    grid-column: 2;
    width: 100%;
    margin: 2px 0 0;
  }
  .ms-page .local-barcode-toggle {
    width: 100%;
    min-height: 35px;
    padding: 5px 7px;
    font-size: 11px;
    line-height: 1.1;
  }

  .ms-page .compact-meta {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }
  .ms-page .compact-meta span {
    min-width: 0;
    min-height: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 5px 3px;
    font-size: 10px;
    line-height: 1.1;
    text-align: center;
  }
  .ms-page .compact-meta span b {
    font-size: 9px;
    line-height: 1.05;
  }

  .ms-page .compact-schedule {
    width: calc(100% - 16px);
    margin: 7px 8px 0;
    padding: 0 !important;
    border-radius: 8px;
    overflow: hidden;
  }
  .ms-page .schedule-stack.single .schedule-section.arrival { padding-bottom: 6px; }
  .ms-page .schedule-stack.single .schedule-heading {
    padding: 6px 6px 4px;
    font-size: 11px;
    line-height: 1.1;
  }
  .ms-page .schedule-stack.single .schedule-values {
    gap: 4px;
    padding: 6px 5px 1px;
  }
  .ms-page .schedule-stack.single .schedule-values b {
    margin-bottom: 2px;
    font-size: 9px;
    line-height: 1.1;
  }
  .ms-page .schedule-stack.single .schedule-values strong {
    font-size: 12px;
    line-height: 1.2;
  }
  .ms-page .schedule-stack.single .timing-chip {
    margin-top: 5px;
    padding: 4px 7px;
    font-size: 10px;
    line-height: 1.1;
  }
  .ms-page .arrival-system-row > div {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 3px 2px 5px;
  }
  .ms-page .arrival-system-row > div span {
    min-width: 0;
    gap: 2px;
    padding: 4px 2px;
    font-size: 9px;
    line-height: 1.1;
  }
  .ms-page .arrival-system-row em { font-size: 9px; }
  .ms-page .arrival-source-value {
    font-size: 10px;
    line-height: 1.15;
    white-space: normal;
  }

  .ms-page .compact-card .operation-compact {
    width: calc(100% - 16px);
    margin: 7px 8px 0;
    gap: 5px;
    padding: 0;
  }
  .ms-page .classic-operation-center .classic-status-chip {
    width: 100%;
    min-height: 34px;
    padding: 6px 8px;
    border-radius: 7px;
    font-size: 11px;
    line-height: 1.1;
  }
  .ms-page .classic-operation-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-radius: 7px;
  }
  .ms-page .classic-operation-fact {
    min-height: 39px;
    padding: 5px 4px;
    gap: 1px;
  }
  .ms-page .classic-operation-fact.is-wide {
    grid-column: 1 / -1;
    min-height: 37px;
  }
  .ms-page .classic-operation-fact > span {
    font-size: 9px;
    line-height: 1.05;
  }
  .ms-page .classic-operation-fact > strong {
    font-size: 11px;
    line-height: 1.15;
    overflow-wrap: normal;
  }
  .ms-page .classic-operation-summary.compact-summary {
    display: grid;
    grid-template-columns: minmax(66px, .65fr) minmax(0, 1.35fr);
    align-items: center;
    min-height: 38px;
    gap: 5px;
    padding: 5px 7px;
  }
  .ms-page .classic-operation-summary.compact-summary > span {
    font-size: 9px;
    line-height: 1.05;
  }
  .ms-page .classic-operation-summary.compact-summary > strong {
    font-size: 11px;
    line-height: 1.12;
  }

  .ms-page .compact-party {
    width: calc(100% - 16px);
    margin: 7px 8px 8px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px 7px;
    padding: 8px;
    border-radius: 8px;
  }
  .ms-page .compact-party > div {
    min-width: 0;
    padding: 2px 3px;
    text-align: center;
  }
  .ms-page .compact-party span {
    font-size: 9px;
    line-height: 1.05;
  }
  .ms-page .compact-party strong {
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .ms-page .compact-phone,
  .ms-page .compact-cancel-route {
    grid-column: 1 / -1;
    width: 100%;
    min-height: 38px;
    margin: 1px 0 0;
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1.1;
  }
}

@media (max-width: 430px) {
  .ms-page #mobile-cards { padding: 5px; gap: 6px; }
  .ms-page .compact-card-head { padding: 8px 7px 7px; column-gap: 5px; row-gap: 3px; }
  .ms-page .compact-card-tags { gap: 5px; }
  .ms-page .compact-card-tags .vehicle-chip,
  .ms-page .compact-card-tags .type-badge { min-height: 34px; font-size: 11px; }
  .ms-page .compact-card-head h2 { font-size: 17px; }
  .ms-page .compact-card-head p { font-size: 10px; }
  .ms-page .compact-card-head > small { font-size: 9px; }
  .ms-page .compact-card-head .expected-parcels-badge,
  .ms-page .local-barcode-toggle { min-height: 34px; font-size: 10px; }
  .ms-page .compact-meta span { min-height: 41px; padding: 4px 2px; }
  .ms-page .compact-schedule,
  .ms-page .compact-card .operation-compact,
  .ms-page .compact-party { width: calc(100% - 12px); margin-left: 6px; margin-right: 6px; }
  .ms-page .schedule-stack.single .schedule-values strong { font-size: 11px; }
  .ms-page .classic-operation-fact { min-height: 37px; padding: 4px 3px; }
  .ms-page .classic-operation-fact > strong { font-size: 10.5px; }
  .ms-page .classic-operation-summary.compact-summary {
    grid-template-columns: 62px minmax(0, 1fr);
    min-height: 36px;
    padding: 5px 6px;
  }
  .ms-page .compact-party { padding: 7px 6px; }
}
`;

style = style.trimEnd() + '\n\n' + block.trim() + '\n';
html = html.replace(/style\.css\?v=[^\"']+/g, 'style.css?v=20260910-08-table-density-v3');

writeFileSync(stylePath, style);
writeFileSync(htmlPath, html);
