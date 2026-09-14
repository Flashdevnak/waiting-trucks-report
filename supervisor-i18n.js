// SUPERVISOR_I18N_V1
// Pure frontend language contract. No transport, timers, database, source, repair, or AI work.
export const DEFAULT_SUPERVISOR_LANGUAGE = "th";
export const SUPERVISOR_LANGUAGE_KEY = "waiting_trucks_supervisor_language_v1";
export const SUPERVISOR_LANGUAGES = Object.freeze(["th", "en"]);

const TEXT_PAIRS = Object.freeze([
  ["กำลังตรวจสิทธิ์ผู้ดูแล", "Checking administrator access"],
  ["กำลังยืนยัน Admin session กับ Worker ก่อนเปิด Supervisor", "Verifying the Admin session with the Worker before opening Supervisor"],
  ["กลับหน้า Waiting Trucks", "Back to Waiting Trucks"],
  ["เข้าสู่ระบบ Admin", "Sign in as Admin"],
  ["เมนู Supervisor", "Supervisor menu"],
  ["ภาพรวม", "Overview"],
  ["สุขภาพ HUB", "HUB Health"],
  ["การวิเคราะห์", "Diagnostics"],
  ["ศูนย์ Quota", "Quota Center"],
  ["เหตุการณ์", "Incidents"],
  ["บำรุงรักษา", "Maintenance"],
  ["คู่มือ", "Guide"],
  ["ภาพรวมระบบ", "System overview"],
  ["สถานะจริงจะแสดงเมื่อ shared Supervisor snapshot พร้อมใช้งาน", "Live truth appears only when the shared Supervisor snapshot is available"],
  ["รีเฟรช Snapshot", "Refresh Snapshot"],
  ["ยังไม่มี shared snapshot จึงไม่สรุปว่าระบบปกติหรือผิดปกติ", "No shared snapshot is available, so system health is not inferred"],
  ["ไม่มี configured catalog ใน snapshot", "No configured catalog is present in the snapshot"],
  ["กำลังรอ shared snapshot", "Waiting for the shared snapshot"],
  ["เส้นทางข้อมูล Waiting Trucks", "Waiting Trucks data path"],
  ["แผนผังระบบ", "System map"],
  ["ผลกระทบ Supervisor", "Supervisor impact"],
  ["HUB ที่สังเกตได้จาก coordinator จริง", "HUBs observed by the real coordinator"],
  ["ยังไม่มี HUB snapshot", "No HUB snapshot yet"],
  ["รายการจะมาจาก runtime event จริงเท่านั้น ไม่มีการ hardcode HUB ตัวอย่าง", "The list comes only from real runtime events; no sample HUB is hardcoded"],
  ["Missing data จะไม่ถูกตีความเป็น HEALTHY", "Missing data is never interpreted as HEALTHY"],
  ["จะแยก FACT, INFERENCE และ SUSPICION โดยไม่แก้ actual arrival, departure, completion หรือ queue truth", "FACT, INFERENCE, and SUSPICION remain separate without changing actual arrival, departure, completion, or queue truth"],
  ["ยังไม่มี diagnostic snapshot สำหรับเปรียบเทียบ runtime bindings, cadence และ transport", "No diagnostic snapshot is available yet for runtime binding, cadence, and transport comparison"],
  ["ไม่มี incident สำหรับวิเคราะห์", "No incident is available for analysis"],
  ["Supervisor จะอธิบาย evidence, impact และ next step โดยไม่เปิดเผยข้อมูลลับหรือ private reasoning", "Supervisor explains evidence, impact, and the next step without exposing secrets or private reasoning"],
  ["รอ SUP-10 shared isolate telemetry; จะไม่ยิง provider/source เพิ่มและจะไม่เดา plan limit", "Waiting for SUP-10 shared isolate telemetry; no extra provider/source request is made and plan limits are not guessed"],
  ["Isolate-local facts only · ไม่มีการรวม counter ข้าม isolate เป็น account total · billing และ provider plan/limit ที่ไม่มีหลักฐานคงเป็น UNKNOWN", "Isolate-local facts only · counters are not combined across isolates into account totals · billing and provider plan/limit remain UNKNOWN without evidence"],
  ["SUP-12 แสดง local guard truth จาก telemetry เดิมเท่านั้น · global kill switch ไม่มี execution และ provider plan/limit ยัง UNKNOWN", "SUP-12 shows local guard truth only from existing telemetry · the global kill switch has no execution and provider plan/limit remain UNKNOWN"],
  ["เหตุการณ์ที่ dedupe แล้ว", "Deduplicated incidents"],
  ["ยังไม่มี event source", "No event source yet"],
  ["ไม่สร้าง incident จำลอง", "No simulated incident is created"],
  ["สิ่งที่ Admin ต้องจัดการ", "Items requiring Admin attention"],
  ["ยังไม่มี action snapshot", "No action snapshot yet"],
  ["Repair ถูกปิดตาม OBSERVE ONLY", "Repair is disabled under OBSERVE ONLY"],
  ["ยังไม่มี maintenance snapshot", "No maintenance snapshot yet"],
  ["ระบบจะสรุปจากเหตุการณ์จริงและ state changes โดยไม่เพิ่ม heartbeat writes", "The system summarizes real events and state changes without adding heartbeat writes"],
  ["คู่มือ Supervisor", "Supervisor guide"],
  ["UNKNOWN หมายถึงอะไร", "What UNKNOWN means"],
  ["ยังไม่มีหลักฐานเพียงพอ ห้ามตีความว่าปกติ", "Evidence is insufficient; do not interpret the state as healthy"],
  ["ดูและวิเคราะห์เท่านั้น ไม่มีการซ่อมอัตโนมัติ", "Observe and analyze only; no automatic repair"],
  ["Supervisor ต้องไม่สร้าง upstream หรือ DB traffic ตามจำนวนหน้าจอ", "Supervisor must not create upstream or DB traffic per screen"],
  ["Production อยู่นอกอำนาจของ Bot ทุกระดับ", "Production is outside Bot authority at every level"],
  ["ปุ่ม Copy จะเปิดเมื่อมี sanitized snapshot และ redaction tests ผ่านแล้ว", "Copy becomes available only after a sanitized snapshot exists and redaction tests pass"],
  ["ปิด", "Close"],
  ["สถานะมาจาก sanitized shared Durable Object state เท่านั้น", "Status comes only from sanitized shared Durable Object state"],
  ["ถ้าไม่มี runtime event จะแสดง UNKNOWN โดย Waiting Trucks ไม่ได้รับผลกระทบ", "Without a runtime event the status stays UNKNOWN and Waiting Trucks is unaffected"],
  ["OBSERVE ONLY — ไม่สร้างข้อมูลหรือเรียก source เพิ่ม", "OBSERVE ONLY — no data is fabricated and no extra source call is made"],
  ["ตรวจ observed HUB และ last accepted evidence โดยไม่ตีความข้อมูลที่หายเป็น HEALTHY", "Review observed HUB and last accepted evidence without interpreting missing data as HEALTHY"],
  ["สุขภาพ HUB และ Source", "HUB and Source Health"],
  ["Source Health ใช้ telemetry ที่เกิดจาก refresh/coordinator เดิมเท่านั้น", "Source Health uses telemetry produced only by the existing refresh/coordinator"],
  ["อ่าน accepted current rows จาก refresh เดิมเท่านั้น ไม่สร้าง source หรือ DB traffic เพิ่ม", "Read accepted current rows only from the existing refresh; do not add source or DB traffic"],
  ["วัดจากงานเดิมและ shared telemetry โดยไม่สร้าง traffic เพื่อวัด traffic", "Measure from existing work and shared telemetry without creating traffic to measure traffic"],
  ["สรุป current open incident จาก shared state และใช้ event ring เป็นหลักฐานประกอบเท่านั้น", "Summarize currently open incidents from shared state and use the event ring only as supporting evidence"],
  ["สรุป auth renewal, warning, drift และ pending repair จากหลักฐานจริง", "Summarize auth renewal, warnings, drift, and pending repair from real evidence"],
  ["Event ชั่วคราวแบบ bounded จาก shared state เดิม; Clear view ไม่ลบ event ring, Audit หรือ Incident", "Bounded ephemeral events from existing shared state; Clear view does not delete the event ring, Audit, or Incident"],
  ["คู่มือและ System Context", "Guide and System Context"],
  ["คำอธิบายสถานะ การแก้ปัญหา และ sanitized evidence", "Status explanations, troubleshooting, and sanitized evidence"],
  ["Supervisor สำหรับ Admin เท่านั้น", "Supervisor is for Admin only"],
  ["ไม่พบสิทธิ์ Admin ที่ยังไม่หมดอายุ กรุณาเข้าสู่ระบบจากหน้า Admin ก่อน", "No unexpired Admin authorization was found. Sign in from the Admin page first"],
  ["ยังไม่มีหลักฐาน shared runtime เพียงพอ", "Shared runtime evidence is not sufficient yet"],
  ["ไม่มี transport health ใน snapshot นี้", "This snapshot has no transport health evidence"],
  ["ยืนยันจากการตอบ snapshot endpoint", "Confirmed by the snapshot endpoint response"],
  ["Supervisor ไม่ query DB เพื่อวัด health", "Supervisor does not query the DB to measure health"],
  ["ยังไม่มี accepted lifecycle telemetry", "No accepted lifecycle telemetry yet"],
  ["Incident feed ยังไม่อยู่ใน checkpoint นี้", "Incident feed is not available in this checkpoint"],
  ["Action feed ยังไม่อยู่ใน checkpoint นี้", "Action feed is not available in this checkpoint"],
  ["เฉพาะ Supervisor extra activity; provider quota ยัง UNKNOWN", "Supervisor extra activity only; provider quota remains UNKNOWN"],
  ["ไม่มี deployment telemetry ใน runtime snapshot", "No deployment telemetry exists in the runtime snapshot"],
  ["ยังไม่มี runtime event ของ HUB", "No HUB runtime event yet"],
  ["Durable Object อาจเพิ่งเริ่มใหม่ หรือยังไม่มีรอบ refresh จริง ข้อมูลจึงคงเป็น UNKNOWN", "The Durable Object may have just restarted or no real refresh has occurred, so the data remains UNKNOWN"],
  ["ยังไม่มี accepted lifecycle telemetry จึงไม่สรุปสถานะคิว", "No accepted lifecycle telemetry is available, so queue state is not inferred"],
  ["ไม่มี lifecycle observation ที่ตรวจสอบโครงสร้างได้", "No structurally valid lifecycle observation is available"],
  ["ไม่มี isolate-local evidence ที่ตรวจสอบได้ จึงไม่สร้างค่า 0 และไม่เดา provider usage", "No verifiable isolate-local evidence exists, so zero values are not fabricated and provider usage is not guessed"],
  ["ไม่พบ incident ที่ยังเปิดอยู่", "No currently open incident found"],
  ["ยังไม่มี incident ที่ยืนยันได้", "No incident can be confirmed yet"],
  ["ไม่มี current HUB evidence เพียงพอ; event history อย่างเดียวไม่ถูกใช้เพื่อเดาว่า incident ยังเปิดอยู่", "Current HUB evidence is insufficient; event history alone is not used to guess that an incident remains open"],
  ["หลักฐานยังไม่ครบ จึงไม่สรุปว่า CLEAR", "Evidence is incomplete, so CLEAR is not inferred"],
  ["ไม่มี pending manual action", "No pending manual action"],
  ["ยังไม่มี action ที่ยืนยันได้", "No action can be confirmed yet"],
  ["ไม่มี current incident truth จึงไม่สร้าง action จำลอง", "There is no current incident truth, so no simulated action is created"],
  ["OBSERVE ONLY · ไม่มี repair execution และไม่มี mutation endpoint จาก SUP-09", "OBSERVE ONLY · no repair execution and no mutation endpoint from SUP-09"],
  ["หลักฐานไม่พอสำหรับ action ที่ปลอดภัย; ไม่มีการเดา", "Evidence is insufficient for a safe action; nothing is guessed"],
  ["Event console UNAVAILABLE. No runtime event was fabricated.", "Event console UNAVAILABLE. No runtime event was fabricated."],
  ["ล้างมุมมอง", "Clear view"],
  ["กู้คืนมุมมอง", "Restore view"],
  ["คัดลอกแล้ว", "Copied"],
  ["คัดลอกถูกบล็อก", "Copy blocked"],
  ["One-shot", "One-shot"],
  ["View cleared locally. Ephemeral event ring was not deleted; use Restore view to show the retained snapshot again.", "View cleared locally. Ephemeral event ring was not deleted; use Restore view to show the retained snapshot again."],
  ["No material runtime transition is retained in the current ephemeral ring.", "No material runtime transition is retained in the current ephemeral ring."],
]);

const TEMPLATE_PAIRS = Object.freeze([
  ["{value} วินาที", "{value} seconds"],
  ["{value} นาที", "{value} minutes"],
  ["{value} ชั่วโมง", "{value} hours"],
  ["{value} วัน", "{value} days"],
  ["No retained event matches filter {value}.", "No retained event matches filter {value}."],
  ["current open เท่านั้น · recent ring alerts {value}", "current open only · recent ring alerts {value}"],
  ["refresh/coordinator telemetry เท่านั้น · AUTH_REQUIRED {auth} · ERROR {errors} · STALE {stale} · HBI คง click-only", "refresh/coordinator telemetry only · AUTH_REQUIRED {auth} · ERROR {errors} · STALE {stale} · HBI remains click-only"],
  ["FACT จาก accepted current rows: active {active} · waiting {waiting} · unloading {unloading} · Drop รอปล่อย {release} · หมดอายุ 12 ชม. {expired} · ยกเลิกที่สังเกตได้ {cancelled}", "FACT from accepted current rows: active {active} · waiting {waiting} · unloading {unloading} · Drop awaiting release {release} · expired 12h {expired} · cancelled observed {cancelled}"],
  ["active {active} · waiting {waiting} · unloading {unloading} · Destination {destination} · Drop {drop} · รอปล่อย {release} · 12h {expired} · cancelled {cancelled} · age {age}", "active {active} · waiting {waiting} · unloading {unloading} · Destination {destination} · Drop {drop} · awaiting release {release} · 12h {expired} · cancelled {cancelled} · age {age}"],
  ["ต่ออายุ session / HAR จริงของ {source} สำหรับ {hub} แล้วให้ refresh/coordinator เดิมยืนยันผล; ห้ามสร้าง session ปลอม", "Renew the real session / HAR for {source} at {hub}, then let the existing refresh/coordinator confirm recovery; never fabricate a session"],
  ["ตรวจ last success และ session ของ {source} สำหรับ {hub}; อย่าเพิ่ม polling เพื่อบังคับ freshness", "Review last success and the session for {source} at {hub}; do not add polling to force freshness"],
  ["ตรวจ {source} ของ {hub}{suffix} จากหลักฐานจริง แล้วรอรอบ shared refresh เดิมยืนยันการฟื้นตัว", "Review {source} for {hub}{suffix} from real evidence, then wait for the existing shared refresh to confirm recovery"],
  ["ตรวจ evidence และ source state ของ {source} สำหรับ {hub} แบบ manual; OBSERVE ONLY ไม่มี repair execution", "Review evidence and source state for {source} at {hub} manually; OBSERVE ONLY has no repair execution"],
  ["{source} ต้องยืนยันตัวตนใหม่", "{source} requires re-authentication"],
  ["{source} ต้องตรวจสอบ", "{source} requires review"],
  ["ตรวจ refresh error {code} และ Source Health ของ {hub}; ห้ามยิง source เพิ่มเพื่อทำให้สถานะเขียว", "Review refresh error {code} and Source Health for {hub}; do not call the source again just to make the status green"],
  ["ตรวจ Source Health, connector/session และ last success ของ {hub} จาก shared evidence เดิม; ไม่มีหลักฐานห้ามเดา", "Review Source Health, connector/session, and last success for {hub} from existing shared evidence; do not guess without evidence"],
  ["OPEN จาก current shared state · key {key} · event ring เป็นหลักฐานประกอบ ไม่ใช่ persistent incident store", "OPEN from current shared state · key {key} · the event ring is supporting evidence, not a persistent incident store"],
  ["ไม่พบ current problem ใน HUB ที่สังเกตได้ · recent WARN/ERROR ใน ring {value} · ไม่ได้หมายความว่าระบบที่ไม่มีหลักฐานเป็น HEALTHY", "No current problem was found in observed HUBs · recent WARN/ERROR in ring {value} · systems without evidence are not assumed HEALTHY"],
]);

const TH_TO_EN = new Map(TEXT_PAIRS.map(([th, en]) => [th, en]));
const EN_TO_TH = new Map(TEXT_PAIRS.map(([th, en]) => [en, th]));

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileTemplate(template) {
  const names = [];
  const pattern = escapeRegex(template).replace(/\\\{([a-zA-Z][a-zA-Z0-9_]*)\\\}/g, (_, name) => {
    names.push(name);
    return "(.+?)";
  });
  return { names, regex: new RegExp(`^${pattern}$`) };
}

const COMPILED_TEMPLATES = TEMPLATE_PAIRS.map(([th, en]) => ({ th, en, thCompiled: compileTemplate(th), enCompiled: compileTemplate(en) }));

function renderTemplate(template, names, values) {
  let output = template;
  names.forEach((name, index) => { output = output.replaceAll(`{${name}}`, values[index] ?? ""); });
  return output;
}

function translateTemplate(text, language) {
  for (const item of COMPILED_TEMPLATES) {
    const source = language === "en" ? item.thCompiled : item.enCompiled;
    const target = language === "en" ? item.en : item.th;
    const match = source.regex.exec(text);
    if (!match) continue;
    return renderTemplate(target, source.names, match.slice(1));
  }
  return text;
}

export function normalizeSupervisorLanguage(value) {
  const language = String(value || "").toLowerCase();
  return SUPERVISOR_LANGUAGES.includes(language) ? language : DEFAULT_SUPERVISOR_LANGUAGE;
}

export function nextSupervisorLanguage(value) {
  return normalizeSupervisorLanguage(value) === "th" ? "en" : "th";
}

export function readSupervisorLanguage(storage = globalThis.localStorage) {
  try { return normalizeSupervisorLanguage(storage?.getItem?.(SUPERVISOR_LANGUAGE_KEY)); }
  catch { return DEFAULT_SUPERVISOR_LANGUAGE; }
}

export function writeSupervisorLanguage(storage = globalThis.localStorage, value) {
  const language = normalizeSupervisorLanguage(value);
  try { storage?.setItem?.(SUPERVISOR_LANGUAGE_KEY, language); } catch {}
  return language;
}

export function translateSupervisorText(value, language = DEFAULT_SUPERVISOR_LANGUAGE) {
  const target = normalizeSupervisorLanguage(language);
  const input = String(value ?? "");
  const leading = input.match(/^\s*/)?.[0] || "";
  const trailing = input.match(/\s*$/)?.[0] || "";
  const text = input.trim();
  if (!text) return input;
  const exact = target === "en" ? TH_TO_EN.get(text) : EN_TO_TH.get(text);
  const translated = exact ?? translateTemplate(text, target);
  return `${leading}${translated}${trailing}`;
}

function shouldSkip(node) {
  const parent = node?.parentElement;
  return Boolean(parent?.closest?.("script,style,[data-i18n-skip]"));
}

export function applySupervisorLanguage(root = globalThis.document, language = DEFAULT_SUPERVISOR_LANGUAGE) {
  const target = normalizeSupervisorLanguage(language);
  const doc = root?.nodeType === 9 ? root : root?.ownerDocument;
  if (!doc) return target;
  doc.documentElement.lang = target;
  const scope = root?.nodeType === 9 ? doc.body : root;
  if (!scope) return target;
  const walker = doc.createTreeWalker(scope, 4);
  let node = walker.nextNode();
  while (node) {
    if (!shouldSkip(node)) node.nodeValue = translateSupervisorText(node.nodeValue, target);
    node = walker.nextNode();
  }
  for (const element of scope.querySelectorAll?.("[aria-label],[title],[placeholder]") || []) {
    for (const name of ["aria-label", "title", "placeholder"]) {
      if (!element.hasAttribute(name)) continue;
      element.setAttribute(name, translateSupervisorText(element.getAttribute(name), target));
    }
  }
  return target;
}

export function syncSupervisorLanguageControls(root = globalThis.document, language = DEFAULT_SUPERVISOR_LANGUAGE) {
  const target = normalizeSupervisorLanguage(language);
  for (const control of root?.querySelectorAll?.("[data-language-toggle]") || []) {
    control.textContent = target === "th" ? "EN" : "ไทย";
    control.setAttribute("aria-label", target === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย");
    control.setAttribute("title", target === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย");
    control.dataset.language = target;
  }
  return target;
}
