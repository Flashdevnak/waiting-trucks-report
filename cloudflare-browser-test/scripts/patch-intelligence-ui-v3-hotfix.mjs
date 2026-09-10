import fs from "node:fs";

const files = [
  {
    path: "src/connection-error.js",
    optionsFrom: `  const options = values.map((value) => '<option value="' + escapeHtml(value) + '"' + (value === current ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('');`,
    optionsTo: `  const options = values.map((value) => '<option value="/api/connection-error?hub=' + encodeURIComponent(value) + '"' + (value === current ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join('');`,
    returnFrom: `  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href='/api/connection-error?hub='+encodeURIComponent(this.value)">' + options + '</select><span class="hub-filter-note">ดูข้อมูลเท่านั้น · ไม่สร้าง polling เพิ่ม</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a class="active" href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';`,
    returnTo: `  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href=this.value">' + options + '</select><span class="hub-filter-note">ดูข้อมูลเท่านั้น · ไม่สร้าง polling เพิ่ม</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a class="active" href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';`,
  },
  {
    path: "src/tbr-intelligence-entry.js",
    optionsFrom: `  const options = values.map((value) => '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>').join('');`,
    optionsTo: `  const options = values.map((value) => '<option value="/shadow-tbr?hub=' + encodeURIComponent(value) + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>').join('');`,
    returnFrom: `  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href='/shadow-tbr?hub='+encodeURIComponent(this.value)">' + options + '</select><span class="hub-filter-note">อ่าน Intelligence ของ HUB ที่เชื่อมต่อแล้ว · ไม่เพิ่ม MS polling</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a class="active" href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';`,
    returnTo: `  return '<section class="hub-toolbar"><div class="hub-filter"><span class="hub-filter-label">HUB ในระบบ</span><select aria-label="เลือก HUB" onchange="location.href=this.value">' + options + '</select><span class="hub-filter-note">อ่าน Intelligence ของ HUB ที่เชื่อมต่อแล้ว · ไม่เพิ่ม MS polling</span></div><nav class="intel-tabs" aria-label="Intelligence pages"><a href="/api/connection-error?hub=' + encodeURIComponent(current) + '">Error Intelligence</a><a class="active" href="/shadow-tbr?hub=' + encodeURIComponent(current) + '">TBR Intelligence</a></nav></section>';`,
  },
];

for (const item of files) {
  let source = fs.readFileSync(item.path, "utf8");
  for (const [from, to, label] of [
    [item.optionsFrom, item.optionsTo, "options"],
    [item.returnFrom, item.returnTo, "toolbar"],
  ]) {
    const count = source.split(from).length - 1;
    if (count === 1) source = source.replace(from, to);
    else if (count === 0 && source.includes(to)) {
      // idempotent
    } else {
      throw new Error(`INTELLIGENCE_UI_V3_HOTFIX failed ${item.path} ${label}: count=${count}`);
    }
  }
  fs.writeFileSync(item.path, source);
}

console.log("INTELLIGENCE_UI_V3_HOTFIX=PASS");
console.log("INTELLIGENCE_HUB_SELECTOR_NAVIGATION=URL_VALUE");
console.log("INTELLIGENCE_SELECTOR_EXTRA_MS_POLLING=0");
