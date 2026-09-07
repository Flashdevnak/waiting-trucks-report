const ORIGIN = process.env.MOBILE_SHELL_DEV_ORIGIN || 'https://waiting-trucks-report-api-dev.26nak-testdev.workers.dev';
const REQUIRED = [
  'DEV mobile unified shell v7',
  'MS mobile export single-column v2',
  'Proof V16 mobile toolbar containment v2',
  'Proof mobile header full-width anchor v4',
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= 120; attempt += 1) {
  try {
    const url = `${ORIGIN}/style.css?v=20260905-dev-shell-v3&releaseGate=${Date.now()}-${attempt}`;
    const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control':'no-cache' } });
    const text = await response.text();
    const missing = REQUIRED.filter(marker => !text.includes(marker));
    if (response.ok && missing.length === 0) {
      console.log('MOBILE_STYLE_EXACT_RELEASE=PASS');
      console.log(`MOBILE_STYLE_REQUIRED_MARKERS=${REQUIRED.length}`);
      process.exit(0);
    }
    console.log(`MOBILE_STYLE_WAIT_ATTEMPT=${attempt} MISSING=${missing.join('|') || 'HTTP_' + response.status}`);
  } catch (error) {
    console.log(`MOBILE_STYLE_WAIT_ATTEMPT=${attempt} ERROR=${String(error?.message || error)}`);
  }
  await sleep(1000);
}

throw new Error(`Timed out waiting for current DEV style release markers: ${REQUIRED.join(', ')}`);
