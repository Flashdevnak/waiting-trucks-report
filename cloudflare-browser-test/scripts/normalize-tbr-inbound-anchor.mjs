import fs from 'node:fs';

const file = process.argv[2] || 'src/tbr-shadow.js';
let source = fs.readFileSync(file, 'utf8');
const comments = `      // TBR_LEAD_NULL_V1: pending/expired records with null lead must stay null.\n      // Number(null) is 0, which incorrectly rendered \"0 นาที\" before Route confirmation.\n`;
if (source.includes(comments)) source = source.replace(comments, '');
fs.writeFileSync(file, source);
console.log('TBR_INBOUND_ANCHOR_NORMALIZED=PASS');
