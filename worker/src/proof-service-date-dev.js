const HTML_MARKER = 'DEV_PROOF_SERVICE_DATE_HTML_V1';
const CORE_MARKER = 'DEV_PROOF_SERVICE_DATE_CORE_V1';
const STRIP_QUERY = "if(location.search)history.replaceState(null,'',location.pathname+location.hash);";
const THAI_DAY_ANCHOR = "P.thaiDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());";
const BOOTSTRAP_DAY_ANCHOR = 'P.state.day=P.thaiDay();';

export function normalizeProofServiceDate(value) {
  const serviceDate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return '';
  const [year, month, day] = serviceDate.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
    ? serviceDate
    : '';
}

export function proofAssetRequestWithoutQuery(request) {
  const assetUrl = new URL(request.url);
  assetUrl.search = '';
  return new Request(assetUrl.toString(), request);
}

function responseWithText(response, text, contentType) {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.delete('ETag');
  return new Response(text, { status: response.status, statusText: response.statusText, headers });
}

export function patchDevProofHtmlServiceDate(source) {
  const text = String(source || '');
  if (text.includes(HTML_MARKER)) return text;
  if (!text.includes(STRIP_QUERY)) {
    throw new Error('DEV Proof service-date HTML anchor missing');
  }
  return text.replace(
    STRIP_QUERY,
    `/* ${HTML_MARKER}: keep ?date=YYYY-MM-DD available to the staged Proof core. */`,
  );
}

export function patchDevProofCoreServiceDate(source) {
  let text = String(source || '');
  if (text.includes(CORE_MARKER)) return text;
  if (!text.includes(THAI_DAY_ANCHOR) || !text.includes(BOOTSTRAP_DAY_ANCHOR)) {
    throw new Error('DEV Proof service-date core anchor missing');
  }
  const normalizer = normalizeProofServiceDate.toString();
  text = text.replace(
    THAI_DAY_ANCHOR,
    `${THAI_DAY_ANCHOR} P.cleanServiceDay=${normalizer}; P.requestedServiceDay=()=>P.cleanServiceDay(new URLSearchParams(location.search).get('date')); /* ${CORE_MARKER} */`,
  );
  text = text.replace(
    BOOTSTRAP_DAY_ANCHOR,
    'P.state.day=P.requestedServiceDay()||P.thaiDay();',
  );
  return text;
}

export async function applyDevProofServiceDate(request, response) {
  if (request.method !== 'GET' || !response?.ok) return response;
  const url = new URL(request.url);
  if (url.pathname === '/proof.html') {
    return responseWithText(
      response,
      patchDevProofHtmlServiceDate(await response.text()),
      'text/html; charset=utf-8',
    );
  }
  if (url.pathname === '/proof-v2-core.js') {
    return responseWithText(
      response,
      patchDevProofCoreServiceDate(await response.text()),
      'application/javascript; charset=utf-8',
    );
  }
  return response;
}
