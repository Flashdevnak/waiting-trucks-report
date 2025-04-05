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
      const tableBody = document.getElementById("data");
      tableBody.innerHTML = '';
      let totalTrucks = 0;
      let totalPackages = 0;

      data.forEach(row => {
        if (!row['上一站网点名称 สาขาก่อนหน้า']) return;

        totalTrucks++;
        totalPackages += parseInt(row['包裹量 จำนวนพัสดุ']) || 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row['上一站网点名称 สาขาก่อนหน้า']}</td>
          <td>${row['司机姓名 ชื่อพนักงานขับรถ']}</td>
          <td>${row['司机电话 เบอร์โทรพนักงานขับรถ']}</td>
          <td>${row['车辆类型 ประเภทรถ']}</td>
          <td>${row['包裹量 จำนวนพัสดุ']}</td>
          <td>${formatThaiDate(row['实际到达时间 เวลารถถึงจริง'])}</td>
          <td>${row['สถานะ 120 นาที']}</td>
          <td>${row['เวลาที่รอลงงาน/นาที']} นาที</td>
        `;
        tableBody.appendChild(tr);
      });

      document.getElementById("summary").innerText =
        `🚛 รถทั้งหมด: ${totalTrucks} คัน | 📦 พัสดุทั้งหมด: ${totalPackages} ชิ้น`;

      const now = new Date();
      document.getElementById("last-update").innerText = `อัปเดตล่าสุดเมื่อ: ${formatThaiDate(now.toISOString())}`;
    })
    .catch(err => {
      document.getElementById("data").innerHTML =
        `<tr><td colspan="8">❌ โหลดข้อมูลไม่สำเร็จ</td></tr>`;
      console.error(err);
    });
}

loadData();
setInterval(loadData, 15000);
