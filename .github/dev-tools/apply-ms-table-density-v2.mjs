import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../../style.css', import.meta.url);
let style = readFileSync(path, 'utf8');
const marker = '/* MS_TABLE_DENSITY_V2: compact desktop columns and aligned mobile cards. */';
if (style.includes(marker)) style = style.split(marker, 1)[0].trimEnd() + '\n';

const block = String.raw`
/* MS_TABLE_DENSITY_V2: compact desktop columns and aligned mobile cards. */
@media (min-width: 1025px) {
  .ms-page .ms-table {
    min-width: 1180px;
    table-layout: fixed;
  }
  .ms-page .ms-table col.col-route { width: 18%; }
  .ms-page .ms-table col.col-meta { width: 8%; }
  .ms-page .ms-table col.col-work { width: 8%; }
  .ms-page .ms-table col.col-schedule { width: 24%; }
  .ms-page .ms-table col.col-status { width: 31%; }
  .ms-page .ms-table col.col-company { width: 11%; }

  .ms-page .ms-table thead th {
    padding: 8px 6px;
    font-size: 11px;
    line-height: 1.25;
    white-space: normal;
  }
  .ms-page .ms-table tbody td {
    padding: 8px 7px;
    line-height: 1.3;
  }
  .ms-page .route-title { font-size: 12px; line-height: 1.3; }
  .ms-page .route-code strong { font-size: 13px; }
  .ms-page .attendance-cell { gap: 4px; }
  .ms-page .attendance-cell .row-muted { font-size: 10px; line-height: 1.25; }
  .ms-page .type-badge { min-width: 76px; padding: 5px 7px; font-size: 10px; }

  .ms-page .schedule-stack.single { border-radius: 7px; }
  .ms-page .schedule-stack.single .schedule-section.arrival { padding-bottom: 7px; }
  .ms-page .schedule-stack.single .schedule-heading {
    padding: 6px 7px 4px;
    font-size: 11px;
    line-height: 1.2;
  }
  .ms-page .schedule-stack.single .schedule-values {
    gap: 6px;
    padding: 5px 6px 1px;
  }
  .ms-page .schedule-stack.single .schedule-values:after { top: 6px; bottom: 2px; }
  .ms-page .schedule-stack.single .schedule-values b { margin-bottom: 2px; font-size: 10px; }
  .ms-page .schedule-stack.single .schedule-values strong { font-size: 12px; line-height: 1.25; }
  .ms-page .schedule-stack.single .timing-chip { margin-top: 5px; padding: 4px 7px; font-size: 10px; }
  .ms-page .arrival-system-row > div { padding: 3px 4px 5px; }
  .ms-page .arrival-system-row > div span { gap: 2px; padding: 3px 4px; font-size: 10px; }
  .ms-page .arrival-system-row em { font-size: 10px; }
  .ms-page .arrival-source-value { font-size: 11px; line-height: 1.2; white-space: normal; }

  .ms-page .operation-compact { gap: 4px; }
  .ms-page .classic-operation-center .classic-status-chip {
    min-height: 24px;
    padding: 4px 7px;
    font-size: 10px;
  }
  .ms-page .classic-operation-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ms-page .classic-operation-fact { min-height: 40px; padding: 5px; }
  .ms-page .classic-operation-fact.is-wide { min-height: 38px; }
  .ms-page .classic-operation-fact > span { font-size: 9px; }
  .ms-page .classic-operation-fact > strong { font-size: 11px; line-height: 1.22; }
  .ms-page .classic-operation-summary.compact-summary {
    grid-template-columns: minmax(82px, .65fr) minmax(0, 1.35fr);
    gap: 5px;
    padding: 5px 7px;
  }
  .ms-page .classic-operation-summary.compact-summary span { font-size: 10px; }
  .ms-page .classic-operation-summary.compact-summary strong { font-size: 11px; line-height: 1.25; }
  .ms-page .compact-party strong,
  .ms-page .compact-party span,
  .ms-page .ms-table td:last-child { overflow-wrap: anywhere; }
}

@media (max-width: 1024px) {
  .ms-page #mobile-cards {
    padding: 6px;
    gap: 8px;
  }
  .ms-page .compact-card {
    border-radius: 8px;
    margin: 0;
    width: 100%;
    min-width: 0;
  }
  .ms-page .compact-card-head {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
    padding: 10px 9px 8px;
    text-align: center;
  }
  .ms-page .compact-card-tags {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    justify-content: stretch;
    gap: 6px;
    width: 100%;
  }
  .ms-page .compact-card-tags > *,
  .ms-page .compact-card-tags .vehicle-chip,
  .ms-page .compact-card-tags .compact-work-type,
  .ms-page .compact-card-tags .type-badge {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }
  .ms-page .compact-card-tags .vehicle-chip,
  .ms-page .compact-card-tags .type-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 30px;
    padding: 5px 6px;
    white-space: normal;
    text-align: center;
    line-height: 1.2;
  }
  .ms-page .compact-work-type { gap: 2px; }
  .ms-page .compact-work-type > small { min-height: 12px; font-size: 9px; }
  .ms-page .compact-card-head h2,
  .ms-page .compact-card-head p,
  .ms-page .compact-card-head > small {
    width: 100%;
    max-width: 100%;
    margin-left: 0;
    margin-right: 0;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .ms-page .compact-card-head h2 { font-size: 15px; line-height: 1.25; }
  .ms-page .compact-card-head p { font-size: 11px; line-height: 1.3; }

  .ms-page .compact-meta {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }
  .ms-page .compact-meta span {
    min-width: 0;
    padding: 7px 4px;
    font-size: 10px;
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .ms-page .compact-meta b { margin-bottom: 2px; font-size: 9px; }

  .ms-page .compact-card .compact-schedule,
  .ms-page .compact-card .operation-compact,
  .ms-page .compact-card .compact-party {
    width: calc(100% - 16px);
    max-width: calc(100% - 16px);
    margin-left: 8px;
    margin-right: 8px;
  }
  .ms-page .compact-card .compact-schedule {
    margin-top: 8px;
    margin-bottom: 8px;
    padding: 0;
    border-radius: 7px;
  }
  .ms-page .schedule-stack.single .schedule-section.arrival { padding-bottom: 7px; }
  .ms-page .schedule-stack.single .schedule-heading { padding: 6px 6px 4px; font-size: 11px; }
  .ms-page .schedule-stack.single .schedule-values { gap: 4px; padding: 5px 5px 1px; }
  .ms-page .schedule-stack.single .schedule-values b { margin-bottom: 2px; font-size: 9px; }
  .ms-page .schedule-stack.single .schedule-values strong { font-size: 12px; line-height: 1.2; }
  .ms-page .schedule-stack.single .timing-chip { margin-top: 5px; padding: 4px 7px; font-size: 10px; }
  .ms-page .arrival-system-row > div { grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 3px 2px 5px; }
  .ms-page .arrival-system-row > div span { min-width: 0; gap: 2px; padding: 3px 2px; font-size: 9px; }
  .ms-page .arrival-system-row em { font-size: 9px; }
  .ms-page .arrival-source-value {
    max-width: 100%;
    font-size: 10px;
    line-height: 1.15;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .ms-page .compact-card .operation-compact {
    margin-top: 0;
    margin-bottom: 8px;
    gap: 5px;
  }
  .ms-page .classic-operation-center .classic-status-chip {
    width: 100%;
    min-height: 29px;
    padding: 5px 6px;
    justify-content: center;
    font-size: 10px;
  }
  .ms-page .classic-operation-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }
  .ms-page .classic-operation-fact {
    min-height: 41px;
    padding: 5px 4px;
  }
  .ms-page .classic-operation-fact.is-wide { min-height: 38px; }
  .ms-page .classic-operation-fact > span { font-size: 9px; line-height: 1.15; }
  .ms-page .classic-operation-fact > strong {
    width: 100%;
    font-size: 11px;
    line-height: 1.2;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .ms-page .classic-operation-summary.compact-summary {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 2px;
    min-height: 42px;
    padding: 5px 6px;
    text-align: center;
  }
  .ms-page .classic-operation-summary.compact-summary > span,
  .ms-page .classic-operation-summary.compact-summary > strong {
    width: 100%;
    text-align: center;
  }
  .ms-page .classic-operation-summary.compact-summary > span { font-size: 9px; line-height: 1.15; }
  .ms-page .classic-operation-summary.compact-summary > strong { font-size: 11px; line-height: 1.2; overflow-wrap: anywhere; }

  .ms-page .compact-card .compact-party {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: stretch;
    justify-items: stretch;
    gap: 6px;
    margin-top: 0;
    margin-bottom: 8px;
    padding: 7px;
    border: 1px solid #d9dcd8;
    border-radius: 7px;
  }
  .ms-page .compact-party > div {
    display: flex;
    min-width: 0;
    min-height: 44px;
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 5px 4px;
    text-align: center;
  }
  .ms-page .compact-party span { font-size: 9px; line-height: 1.15; }
  .ms-page .compact-party strong { width: 100%; font-size: 11px; line-height: 1.2; overflow-wrap: anywhere; }
  .ms-page .compact-phone,
  .ms-page .compact-cancel-route {
    grid-column: 1 / -1;
    width: 100%;
    min-width: 0;
    min-height: 34px;
    justify-content: center;
  }
}

@media (max-width: 430px) {
  .ms-page .app-shell { padding-left: 6px; padding-right: 6px; }
  .ms-page #mobile-cards { padding: 4px; gap: 7px; }
  .ms-page .compact-card-head { padding: 8px 7px 7px; gap: 4px; }
  .ms-page .compact-card-tags { gap: 4px; }
  .ms-page .compact-card-tags .vehicle-chip,
  .ms-page .compact-card-tags .type-badge { min-height: 28px; padding: 4px; font-size: 10px; }
  .ms-page .compact-meta span { padding: 6px 2px; font-size: 9px; }
  .ms-page .compact-card .compact-schedule,
  .ms-page .compact-card .operation-compact,
  .ms-page .compact-card .compact-party {
    width: calc(100% - 12px);
    max-width: calc(100% - 12px);
    margin-left: 6px;
    margin-right: 6px;
  }
  .ms-page .classic-operation-fact { min-height: 39px; padding: 4px 3px; }
  .ms-page .classic-operation-summary.compact-summary { min-height: 39px; padding: 4px 5px; }
  .ms-page .compact-card .compact-party { gap: 4px; padding: 5px; }
  .ms-page .compact-party > div { min-height: 40px; padding: 4px 3px; }
}
`;

writeFileSync(path, style.trimEnd() + '\n\n' + block.trim() + '\n');
console.log('MS_TABLE_DENSITY_V2_APPLIED=1');
