import fs from 'node:fs';

const path = 'worker/tests/auth-session-resilience.test.mjs';
let source = fs.readFileSync(path, 'utf8');
source = source
  .replace('fsRead("src/index.js")', 'fsRead("../src/index.js")')
  .replace('fsRead("../main.js")', 'fsRead("../../main.js")')
  .replace('fsRead("../ms.js")', 'fsRead("../../ms.js")');
if (!source.includes('fsRead("../src/index.js")')) throw new Error('worker source path correction failed');
if (!source.includes('fsRead("../../main.js")')) throw new Error('main source path correction failed');
if (!source.includes('fsRead("../../ms.js")')) throw new Error('ms source path correction failed');
fs.writeFileSync(path, source);
console.log('AUTH_TEST_PATHS=PASS');
