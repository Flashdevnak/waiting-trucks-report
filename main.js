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

function renderTable(data) {
  const tableBody = document.getElementById("data");
  tableBody.innerHTML = '';

  data.forEach(row => {
    if (!row['上一站网点名称 สาขาก่อนหน้า']) return;

    const tr = document.createElement('tr');
    const waitTime = parseInt(row['เวลาที่รอลงงาน/นาที']) || 0;
    let waitColor = '';
    if (waitTime > 120) waitColor = 'style="color:red;font-weight:bold"';
    else if (waitTime >= 60) waitColor = 'style="color:orange;font-weight:bold"';
    else waitColor = 'style="color:green;font-weight:bold"';

    tr.innerHTML = `
      <td>${row['上一站网点名称 สาขาก่อนหน้า']}</td>
      <td>${row['司机姓名 ชื่อพนักงานขับรถ']}</td>
      <td>${row['司机电话 เบอร์โทรพนักงานขับรถ']}</td>
      <td>${row['车辆类型 ประเภทรถ']}</td>
      <td>${row['包裹量 จำนวนพัสดุ']}</td>
      <td>${formatThaiDate(row['实际到达时间 เวลารถถึงจริง'])}</td>
      <td>${row['สถานะ 120 นาที']}</td>
      <td ${waitColor}>${waitTime} นาที</td>
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
    let waitColor = '';
    if (waitTime > 120) waitColor = 'color:red;font-weight:bold';
    else if (waitTime >= 60) waitColor = 'color:orange;font-weight:bold';
    else waitColor = 'color:green;font-weight:bold';

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-item"><span>สาขาก่อนหน้า:</span> ${row['上一站网点名称 สาขาก่อนหน้า']}</div>
      <div class="card-item"><span>ชื่อพนักงาน:</span> ${row['司机姓名 ชื่อพนักงานขับรถ']}</div>
      <div class="card-item"><span>เบอร์โทร:</span> ${row['司机电话 เบอร์โทรพนักงานขับรถ']}</div>
      <div class="card-item"><span>ประเภทรถ:</span> ${row['车辆类型 ประเภทรถ']}</div>
      <div class="card-item"><span>จำนวนพัสดุ:</span> ${row['包裹量 จำนวนพัสดุ']}</div>
      <div class="card-item"><span>เวลาที่รถถึงจริง:</span> ${formatThaiDate(row['实际到达时间 เวลารถถึงจริง'])}</div>
      <div class="card-item"><span>สถานะ:</span> ${row['สถานะ 120 นาที']}</div>
      <div class="card-item" style="${waitColor}"><span>เวลาที่รอลงงาน:</span> ${waitTime} นาที</div>
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
        totalPackages += parseInt(row['包裹量 จำนวนพัสดุ']) || 0;
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
        `<tr><td colspan="8">❌ โหลดข้อมูลไม่สำเร็จ</td></tr>`;
      document.getElementById("cards-container").innerHTML =
        `<div class="card">❌ โหลดข้อมูลไม่สำเร็จ</div>`;
      console.error(err);
    });
}

// โหลดข้อมูลครั้งแรก + รีเฟรชทุก 15 วินาที
loadData();
setInterval(loadData, 15000);
