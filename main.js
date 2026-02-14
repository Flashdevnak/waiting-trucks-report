function updateDateTime() {
  const now = new Date();
  const day = now.getDate();
  const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear() + 543;
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  document.getElementById("datetime").innerText =
    `📅 วันที่: ${day} ${month} ${year} เวลา: ${hours}:${minutes}:${seconds} น.`;
}
setInterval(updateDateTime, 1000);
updateDateTime();

function formatThaiDate(isoString) {
  const date = new Date(isoString);
  if (isNaN(date)) return "-";
  const day = date.getDate();
  const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear() + 543;
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${year} เวลา ${hours}:${minutes} น.`;
}

function getWaitClass(minutes) {
  if (minutes > 120) return "red";
  if (minutes >= 60) return "orange";
  return "green";
}

function renderTable(data) {
  const tableBody = document.getElementById("data");
  tableBody.innerHTML = '';

  data.forEach(row => {
    if (!row['上一站网点名称 สาขาก่อนหน้า']) return;

    const waitTime = parseInt(row['เวลาที่รอลงงาน/นาที']) || 0;
    const waitClass = getWaitClass(waitTime);
    const waitHtml = `<td class="${waitClass}" style="font-weight:bold">${waitTime} นาที</td>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row['上一站网点名称 สาขาก่อนหน้า']}</td>
      <td>${row['车线名称 ชื่อเส้นทางการเดินรถ']}</td>
      <td>${row['司机姓名 ชื่อพนักงานขับรถ']}</td>
      <td>${row['司机电话 เบอร์โทรพนักงานขับรถ']}</td>
      <td>${row['车辆类型 ประภทรถ']}</td>
      <td>${row['包裹总量 จำนวนพัสดุทั้งหมด']} ชิ้น</td>
      <td>${formatThaiDate(row['实际到达时间 เวลารถถึงจริง'])}</td>
      <td>${row['สถานะ 120 นาที']}</td>
      ${waitHtml}
    `;
    tableBody.appendChild(tr);
  });
}

function renderCards(data) {
  const cardContainer = document.getElementById("cards-container");
  cardContainer.innerHTML = "";

  data.forEach(row => {
    if (!row['上一站网点名称 สาขาก่อนหน้า']) return;

    const waitTime = parseInt(row['เวลาที่รอลงงาน/นาที']) || 0;
    const waitClass = getWaitClass(waitTime);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-item"><div class="label">สาขาก่อนหน้า:</div><div class="value">${row['上一站网点名称 สาขาก่อนหน้า']}</div></div>
      <div class="card-item"><div class="label">ชื่อเส้นทาง:</div><div class="value">${row['车线名称 ชื่อเส้นทางการเดินรถ']}</div></div>
      <div class="card-item"><div class="label">ชื่อพนักงาน:</div><div class="value">${row['司机姓名 ชื่อพนักงานขับรถ']}</div></div>
      <div class="card-item"><div class="label">เบอร์โทร:</div><div class="value">${row['司机电话 เบอร์โทรพนักงานขับรถ']}</div></div>
      <div class="card-item"><div class="label">ประเภทรถ:</div><div class="value">${row['车辆类型 ประภทรถ']}</div></div>
      <div class="card-item"><div class="label">จำนวนพัสดุ:</div><div class="value">${row['包裹总量 จำนวนพัสดุทั้งหมด']} ชิ้น</div></div>
      <div class="card-item"><div class="label">เวลาที่รถถึงจริง:</div><div class="value">${formatThaiDate(row['实际到达时间 เวลารถถึงจริง'])}</div></div>
      <div class="card-item"><div class="label">สถานะ:</div><div class="value">${row['สถานะ 120 นาที']}</div></div>
      <div class="card-item"><div class="label">เวลาที่รอลงงาน:</div><div class="value ${waitClass}">${waitTime} นาที</div></div>
    `;
    cardContainer.appendChild(card);
  });
}

function loadData() {
  fetch("https://script.google.com/macros/s/AKfycbxE2-_8h6EzOQQ3FeDwFxNIAn4U40pacvRnp3XeOGevXDzhw15bgDi74LVgtozfjgiHXQ/exec")
    .then(res => res.json())
    .then(data => {
      let totalTrucks = 0;
      let totalPackages = 0;

      data.forEach(row => {
        if (!row['上一站网点名称 สาขาก่อนหน้า']) return;
        totalTrucks++;
        totalPackages += parseInt(row['包裹总量 จำนวนพัสดุทั้งหมด']) || 0;
      });

      document.getElementById("summary").innerText =
        `🚛 รถทั้งหมด: ${totalTrucks} คัน | 📦 พัสดุทั้งหมด: ${totalPackages} ชิ้น`;

      renderTable(data);
      renderCards(data);

      const now = new Date();
      document.getElementById("last-update").innerText =
        `อัปเดตล่าสุดเมื่อ: ${formatThaiDate(now.toISOString())}`;
    })
    .catch(err => {
      document.getElementById("data").innerHTML =
        `<tr><td colspan="9">❌ โหลดข้อมูลไม่สำเร็จ</td></tr>`;
      document.getElementById("cards-container").innerHTML =
        `<div class="card">❌ โหลดข้อมูลไม่สำเร็จ</div>`;
      console.error(err);
    });
}

loadData();
setInterval(loadData, 15000);
