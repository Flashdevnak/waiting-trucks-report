
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

function loadData() {
  fetch("https://script.google.com/macros/s/AKfycbxE2-_8h6EzOQQ3FeDwFxNIAn4U40pacvRnp3XeOGevXDzhw15bgDi74LVgtozfjgiHXQ/exec")
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById("data");
      container.innerHTML = '';
      data.forEach(row => {
        if (!row['上一站网点名称 สาขาก่อนหน้า']) return;
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
          <div><strong>สาขาก่อนหน้า:</strong> ${row['上一站网点名称 สาขาก่อนหน้า']}</div>
          <div><strong>เบอร์โทร:</strong> ${row['司机电话 เบอร์โทรพนักงานขับรถ']}</div>
          <div><strong>ชื่อคนขับ:</strong> ${row['司机姓名 ชื่อพนักงานขับรถ']}</div>
          <div><strong>ประเภท:</strong> ${row['车辆类型 ประเภทรถ']}</div>
          <div><strong>จำนวนพัสดุ:</strong> ${row['包裹量 จำนวนพัสดุ']}</div>
          <div><strong>เวลารถถึงจริง:</strong> ${formatThaiDate(row['实际到达时间 เวลารถถึงจริง'])}</div>
          <div><strong>สถานะ:</strong> ${row['สถานะ 120 นาที']}</div>
          <div><strong>เวลาที่รอลงงาน:</strong> ${row['เวลาที่รอลงงาน/นาที']} นาที</div>
          <hr />
        `;
        container.appendChild(card);
      });

      const now = new Date();
      document.getElementById("last-update").innerText = `อัปเดตล่าสุดเมื่อ: ${formatThaiDate(now.toISOString())}`;
    })
    .catch(err => {
      document.getElementById("data").innerHTML = "❌ โหลดข้อมูลไม่สำเร็จ";
      console.error(err);
    });
}

loadData();
setInterval(loadData, 20000);
