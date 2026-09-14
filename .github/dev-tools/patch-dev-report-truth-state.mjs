const REPORT_STATUS_ID = "report-runtime-status";
export const REPORT_TRUTH_MARKER = "DEV_REPORT_TRUTH_STATE_V1";

function replaceUnique(source, from, to, label) {
  const text = String(source || "");
  const first = text.indexOf(from);
  const last = text.lastIndexOf(from);
  if (first < 0 || first !== last)
    throw new Error(`DEV report truth-state patch failed: ${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

export function patchDevReportTruthHtml(source) {
  const text = String(source || "");
  if (text.includes(`data-report-runtime-status="${REPORT_TRUTH_MARKER}"`)) return text;
  return replaceUnique(
    text,
    '<span class="badge badge-online">พร้อมใช้งาน</span>',
    `<span id="${REPORT_STATUS_ID}" class="badge badge-neutral" data-report-runtime-status="${REPORT_TRUTH_MARKER}">ยังไม่ได้ตรวจสอบ</span>`,
    "static ready badge",
  );
}

export function patchDevReportTruthJs(source) {
  let output = String(source || "");
  if (output.includes(`const ${REPORT_TRUTH_MARKER}=`)) return output;

  const helper = `// ${REPORT_TRUTH_MARKER}: report header reflects auth/data truth and never claims ready before a successful read.\nconst ${REPORT_TRUTH_MARKER}="${REPORT_TRUTH_MARKER}";\nfunction readReportRuntimeAuth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||"null")}catch{return null}}\nfunction setReportRuntimeStatus(text,tone="neutral"){const badge=$("${REPORT_STATUS_ID}");if(!badge)return;badge.textContent=text;badge.className=\`badge badge-\${tone}\`;badge.dataset.reportRuntimeStatus=${REPORT_TRUTH_MARKER}}\nfunction syncReportRuntimeAuthState(){const auth=readReportRuntimeAuth();setReportRuntimeStatus(auth?.token?"พร้อมค้นหา":"ต้องเข้าสู่ระบบ",auth?.token?"neutral":"offline")}\n`;
  output = replaceUnique(output, "const defs=", `${helper}const defs=`, "truth-state helper insertion");

  output = replaceUnique(
    output,
    '$("report-export").onclick=exportExcel;buildFilters([])});',
    '$("report-export").onclick=exportExcel;buildFilters([]);syncReportRuntimeAuthState();window.addEventListener("storage",syncReportRuntimeAuthState)});',
    "DOMContentLoaded auth state",
  );

  output = replaceUnique(
    output,
    "async function load(){const from=",
    'async function load(){if(!readReportRuntimeAuth()?.token){setReportRuntimeStatus("ต้องเข้าสู่ระบบ","offline");return note("กรุณาเข้าสู่ระบบจากหน้าติดตาม MS ก่อน",true)}const from=',
    "load auth gate",
  );

  output = replaceUnique(
    output,
    'note("กำลังดึงข้อมูลและตรวจบาร์โค้ดรถ…");$("report-export").disabled=true;try{',
    'note("กำลังดึงข้อมูลและตรวจบาร์โค้ดรถ…");setReportRuntimeStatus("กำลังตรวจสอบ","neutral");$("report-export").disabled=true;try{',
    "loading state",
  );

  output = replaceUnique(
    output,
    'buildFilters(sourceRows);render();$("report-export").disabled=!sourceRows.length}catch(e){note(e.message,true)}}',
    'buildFilters(sourceRows);render();$("report-export").disabled=!sourceRows.length;setReportRuntimeStatus("พร้อมใช้งาน","online")}catch(e){const authProblem=/เข้าสู่ระบบ|session|เซสชัน|สิทธิ์/i.test(String(e?.message||""));setReportRuntimeStatus(authProblem?"ต้องเข้าสู่ระบบ":"เชื่อมต่อขัดข้อง",authProblem?"offline":"offline");note(e.message,true)}}',
    "success and error states",
  );

  return output;
}

export function verifyDevReportTruthState(html, js) {
  const page = String(html || "");
  const script = String(js || "");
  if (!page.includes(`data-report-runtime-status="${REPORT_TRUTH_MARKER}"`))
    throw new Error("DEV report truth-state marker missing from HTML");
  if (!page.includes(`id="${REPORT_STATUS_ID}"`) || !page.includes("ยังไม่ได้ตรวจสอบ"))
    throw new Error("DEV report neutral initial status missing");
  if (page.includes('<span class="badge badge-online">พร้อมใช้งาน</span>'))
    throw new Error("DEV report still contains static ready badge");
  for (const marker of [
    `const ${REPORT_TRUTH_MARKER}=`,
    "syncReportRuntimeAuthState()",
    'setReportRuntimeStatus("กำลังตรวจสอบ","neutral")',
    'setReportRuntimeStatus("พร้อมใช้งาน","online")',
    'setReportRuntimeStatus("ต้องเข้าสู่ระบบ","offline")',
    '"เชื่อมต่อขัดข้อง"',
  ]) if (!script.includes(marker)) throw new Error(`DEV report JS missing ${marker}`);
  if (/setInterval\s*\(|new WebSocket\s*\(|EventSource\s*\(/.test(script))
    throw new Error("DEV report truth-state introduced background transport");
  return true;
}
