const SETTINGS = {
  SPREADSHEET_ID: '1sqON2-nJLYCS26wWihFmOw27bmg_BdpuRab3maSr1ng',
  LEGACY_SHEET: '未卸车明细 รายละเอียดรถรอลงงาน',
  ACTIVE_SHEET: 'ระบบ_รถรอลงงาน',
  HISTORY_SHEET: 'ระบบ_ประวัติ',
  AUDIT_SHEET: 'ระบบ_บันทึกการใช้งาน',
  SYSTEM_SHEET: 'ระบบ_ตั้งค่า',
  USERNAME: 'NE1',
  ADMIN_USERNAME: 'ADMIN',
  SESSION_DAYS: 30
};

const ACTIVE_HEADERS = [
  'id', 'barcode', 'previousStation', 'routeName',
  'driverName', 'driverPhone', 'vehicleType', 'plate',
  'parcels', 'arrivalAt', 'hub', 'supplier',
  'importedAt', 'sourceFile'
];

const HISTORY_HEADERS = [
  ...ACTIVE_HEADERS, 'status', 'actionAt', 'note', 'operator'
];

const AUDIT_HEADERS = [
  'timestamp', 'action', 'recordId', 'detail', 'operator'
];

const SYSTEM_HEADERS = [
  'category', 'key', 'label', 'startHour', 'endHour',
  'minutes', 'enabled', 'updatedAt', 'updatedBy'
];

const DEFAULT_PAUSE_WINDOWS = [
  ['pause-1', 'ช่วงไม่มีกะ 1', 0, 1],
  ['pause-2', 'ช่วงไม่มีกะ 2', 7, 8],
  ['pause-3', 'ช่วงไม่มีกะ 3', 10, 15],
  ['pause-4', 'ช่วงไม่มีกะ 4', 18, 19]
];

const DEFAULT_VEHICLE_LIMITS = [
  ['4W', 120], ['4WJ', 120], ['6W', 120],
  ['14W', 120], ['18W', 120], ['22W', 120]
];

// เปลี่ยน 55555 เป็นรหัสกลางก่อนกด Run ครั้งแรก
function setupOnce() {
  return setupSystem('55555');
}

// เปลี่ยนรหัสด้านล่างก่อน Run ครั้งแรก แล้วอย่าเผยแพร่รหัสใน GitHub
function setupAdminOnce() {
  return setAdminAccount_('ADMIN', 'เปลี่ยนเป็นรหัสแอดมินของคุณ');
}

function setupSystem(operatorPin) {
  if (!operatorPin || String(operatorPin).length < 4) {
    throw new Error('รหัสต้องมีอย่างน้อย 4 ตัว');
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('OPERATOR_PIN_HASH', hash_(String(operatorPin)));
  props.setProperty('OPERATOR_USERNAME', SETTINGS.USERNAME);

  if (!props.getProperty('AUTH_SECRET')) {
    props.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const active = ensureSheet_(ss, SETTINGS.ACTIVE_SHEET, ACTIVE_HEADERS);
  ensureSheet_(ss, SETTINGS.HISTORY_SHEET, HISTORY_HEADERS);
  ensureSheet_(ss, SETTINGS.AUDIT_SHEET, AUDIT_HEADERS);
  ensureSystemSettings_(ss);

  const migrated = active.getLastRow() < 2
    ? migrateLegacyData_(ss, active)
    : 0;

  return 'ตั้งค่าระบบสำเร็จ ย้ายข้อมูลเดิม ' + migrated + ' รายการ';
}

function doGet(e) {
  try {
    const action = String(e?.parameter?.action || 'list');

    if (action === 'history') {
      return json_({
        ok: true,
        data: readSheet_(SETTINGS.HISTORY_SHEET).slice(-1000)
      });
    }

    if (action === 'health') {
      return json_({
        ok: true,
        data: {
          service: 'waiting-trucks-api',
          time: new Date().toISOString()
        }
      });
    }

    if (action === 'settings') {
      return json_({
        ok: true,
        data: readSystemSettings_()
      });
    }

    return json_({
      ok: true,
      data: readSheet_(SETTINGS.ACTIVE_SHEET)
    });
  } catch (error) {
    return errorResponse_(error);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    const body = JSON.parse(e?.postData?.contents || '{}');

    if (body.action === 'login') {
      return json_({
        ok: true,
        data: login_(body.username, body.pin)
      });
    }

    lock.waitLock(20000);
    const operator = verifySession_(body.token);

    if (body.action === 'import') {
      return json_({
        ok: true,
        data: importRows_(
          body.rows || [],
          body.fileName || '',
          operator
        )
      });
    }

    if (body.action === 'complete') {
      return json_({
        ok: true,
        data: archiveRecord_(
          body.id, 'COMPLETED', body.note || '', operator
        )
      });
    }

    if (body.action === 'remove') {
      return json_({
        ok: true,
        data: archiveRecord_(
          body.id, 'REMOVED', body.note || '', operator
        )
      });
    }

    if (body.action === 'saveSettings') {
      assertAdmin_(operator);
      return json_({
        ok: true,
        data: saveSystemSettings_(body.settings || {}, operator.username)
      });
    }

    throw new Error('ไม่รู้จักคำสั่งที่ส่งมา');
  } catch (error) {
    return errorResponse_(error);
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function login_(username, pin) {
  const props = PropertiesService.getScriptProperties();
  const inputUsername = String(username || '').trim().toUpperCase();
  const operatorUsername = props.getProperty('OPERATOR_USERNAME') || SETTINGS.USERNAME;
  const adminUsername = props.getProperty('ADMIN_USERNAME') || SETTINGS.ADMIN_USERNAME;
  let role = '';

  if (inputUsername === operatorUsername) {
    if (hash_(String(pin || '')) !== props.getProperty('OPERATOR_PIN_HASH')) {
      throw loginError_();
    }
    role = 'operator';
  } else if (inputUsername === adminUsername) {
    if (hash_(String(pin || '')) !== props.getProperty('ADMIN_PIN_HASH')) {
      throw loginError_();
    }
    role = 'admin';
  } else {
    throw loginError_();
  }

  const expiresAt = Date.now() +
    SETTINGS.SESSION_DAYS * 24 * 60 * 60 * 1000;

  const payload = Utilities
    .base64EncodeWebSafe(
      inputUsername + '|' + role + '|' + expiresAt + '|' + Utilities.getUuid()
    )
    .replace(/=+$/, '');

  const token = payload + '.' + sign_(payload);

  audit_(
    'LOGIN', '',
    'เข้าสู่ระบบถึง ' + new Date(expiresAt).toISOString(),
    inputUsername
  );

  return {
    username: inputUsername,
    role: role,
    token: token,
    expiresAt: expiresAt
  };
}

function loginError_() {
  const error = new Error('Username หรือรหัสจัดการไม่ถูกต้อง');
  error.code = 'INVALID_LOGIN';
  return error;
}

function verifySession_(token) {
  try {
    const parts = String(token || '').split('.');

    if (parts.length !== 2 || parts[1] !== sign_(parts[0])) {
      throw new Error('Invalid token');
    }

    const decoded = Utilities
      .newBlob(Utilities.base64DecodeWebSafe(parts[0]))
      .getDataAsString();

    const fields = decoded.split('|');
    const username = fields[0];
    const legacyToken = /^\d+$/.test(fields[1] || '');
    const role = legacyToken ? 'operator' : fields[1];
    const expiresAt = Number(legacyToken ? fields[1] : fields[2]);

    if (
      !['operator', 'admin'].includes(role) ||
      !expiresAt ||
      Date.now() > expiresAt
    ) {
      throw new Error('Expired token');
    }

    return { username: username, role: role };
  } catch (error) {
    const sessionError = new Error(
      'สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
    );
    sessionError.code = 'INVALID_SESSION';
    throw sessionError;
  }
}

function sign_(payload) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('AUTH_SECRET');

  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('AUTH_SECRET', secret);
  }

  return Utilities
    .base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(payload, secret)
    )
    .replace(/=+$/, '');
}

function importRows_(incoming, fileName, operator) {
  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const active = ensureSheet_(ss, SETTINGS.ACTIVE_SHEET, ACTIVE_HEADERS);

  const blocked = new Set(
    readSheet_(SETTINGS.HISTORY_SHEET).map(row => String(row.id))
  );

  // ไฟล์ Excel คือภาพคิวล่าสุดทั้งชุด จึงสร้างรายการใหม่จากไฟล์ทุกครั้ง
  // รถที่ไม่มีอยู่ในไฟล์รอบล่าสุดจะถูกนำออกจากคิวหน้าเว็บอัตโนมัติ
  const activeMap = new Map();
  const previousTotal = readSheet_(SETTINGS.ACTIVE_SHEET).length;

  let imported = 0;
  let skipped = 0;

  incoming.forEach(raw => {
    const row = cleanIncoming_(raw, fileName);

    if (!row.previousStation || !row.arrivalAt) {
      return;
    }

    if (blocked.has(String(row.id))) {
      skipped++;
      return;
    }

    activeMap.set(String(row.id), row);
    imported++;
  });

  replaceData_(active, ACTIVE_HEADERS, Array.from(activeMap.values()));

  audit_(
    'IMPORT', '',
    fileName + ': ' + imported + ' imported, ' + skipped + ' skipped',
    operator.username
  );

  return {
    imported: imported,
    skipped: skipped,
    total: activeMap.size,
    removed: Math.max(0, previousTotal - activeMap.size)
  };
}

function archiveRecord_(id, status, note, operator) {
  if (!id) {
    throw new Error('ไม่พบรหัสรายการ');
  }

  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const active = ensureSheet_(ss, SETTINGS.ACTIVE_SHEET, ACTIVE_HEADERS);
  const rows = readSheet_(SETTINGS.ACTIVE_SHEET);

  const index = rows.findIndex(
    row => String(row.id) === String(id)
  );

  if (index < 0) {
    throw new Error(
      'รายการนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าเว็บ'
    );
  }

  const history = ensureSheet_(ss, SETTINGS.HISTORY_SHEET, HISTORY_HEADERS);

  appendObject_(history, HISTORY_HEADERS, {
    ...rows[index],
    status: status,
    actionAt: new Date().toISOString(),
    note: String(note || '').slice(0, 500),
    operator: operator.username
  });

  active.deleteRow(index + 2);
  audit_(status, id, note, operator.username);

  return {
    id: id,
    status: status,
    operator: operator.username
  };
}

function setAdminAccount_(username, adminPin) {
  const cleanUsername = String(username || '').trim().toUpperCase();
  const cleanPin = String(adminPin || '').trim();

  if (!cleanUsername || cleanPin.length < 6 || cleanPin.indexOf('เปลี่ยน') >= 0) {
    throw new Error(
      'กรุณาแก้รหัสใน setupAdminOnce ให้มีอย่างน้อย 6 ตัวก่อนกด Run'
    );
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_USERNAME', cleanUsername);
  props.setProperty('ADMIN_PIN_HASH', hash_(cleanPin));

  if (!props.getProperty('AUTH_SECRET')) {
    props.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  audit_('ADMIN_SETUP', '', 'ตั้งค่าบัญชีผู้ดูแล', cleanUsername);
  return 'ตั้งค่าบัญชีผู้ดูแล ' + cleanUsername + ' สำเร็จ';
}

function assertAdmin_(operator) {
  if (!operator || operator.role !== 'admin') {
    const error = new Error('คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบ');
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }
}

function ensureSystemSettings_(ss) {
  const sheet = ensureSheet_(ss, SETTINGS.SYSTEM_SHEET, SYSTEM_HEADERS);

  if (sheet.getLastRow() < 2) {
    const now = new Date().toISOString();
    const rows = [];

    DEFAULT_PAUSE_WINDOWS.forEach(item => rows.push({
      category: 'pause', key: item[0], label: item[1],
      startHour: item[2], endHour: item[3], minutes: '',
      enabled: true, updatedAt: now, updatedBy: 'SYSTEM'
    }));

    DEFAULT_VEHICLE_LIMITS.forEach(item => rows.push({
      category: 'vehicle', key: item[0], label: item[0],
      startHour: '', endHour: '', minutes: item[1],
      enabled: true, updatedAt: now, updatedBy: 'SYSTEM'
    }));

    replaceData_(sheet, SYSTEM_HEADERS, rows);
  }

  return sheet;
}

function readSystemSettings_() {
  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const sheet = ensureSystemSettings_(ss);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);
  const rows = values
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));

  return {
    pauseWindows: rows
      .filter(row => row.category === 'pause' && boolean_(row.enabled))
      .map(row => ({
        key: String(row.key),
        label: String(row.label || ''),
        startHour: Number(row.startHour),
        endHour: Number(row.endHour)
      })),
    vehicleLimits: rows
      .filter(row => row.category === 'vehicle' && boolean_(row.enabled))
      .map(row => ({
        type: String(row.key).trim().toUpperCase(),
        minutes: Number(row.minutes) || 120
      }))
  };
}

function saveSystemSettings_(settings, username) {
  const pauseWindows = Array.isArray(settings.pauseWindows)
    ? settings.pauseWindows : [];
  const vehicleLimits = Array.isArray(settings.vehicleLimits)
    ? settings.vehicleLimits : [];

  if (vehicleLimits.length < 1) {
    throw new Error('ต้องมีประเภทรถอย่างน้อย 1 ประเภท');
  }

  const now = new Date().toISOString();
  const rows = [];

  pauseWindows.forEach((item, index) => {
    const start = Number(item.startHour);
    const end = Number(item.endHour);
    if (!Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || start >= 24 || end <= 0 || end > 24 || start === end) {
      throw new Error('ช่วงไม่มีกะลำดับที่ ' + (index + 1) + ' ไม่ถูกต้อง');
    }
    rows.push({
      category: 'pause', key: 'pause-' + (index + 1),
      label: String(item.label || ('ช่วงไม่มีกะ ' + (index + 1))).slice(0, 100),
      startHour: start, endHour: end, minutes: '', enabled: true,
      updatedAt: now, updatedBy: username
    });
  });

  const seen = new Set();
  vehicleLimits.forEach((item, index) => {
    const type = String(item.type || '').trim().toUpperCase();
    const minutes = Math.round(Number(item.minutes));
    if (!type || seen.has(type) || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      throw new Error('ข้อมูลประเภทรถลำดับที่ ' + (index + 1) + ' ไม่ถูกต้อง');
    }
    seen.add(type);
    rows.push({
      category: 'vehicle', key: type, label: type,
      startHour: '', endHour: '', minutes: minutes, enabled: true,
      updatedAt: now, updatedBy: username
    });
  });

  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const sheet = ensureSheet_(ss, SETTINGS.SYSTEM_SHEET, SYSTEM_HEADERS);
  replaceData_(sheet, SYSTEM_HEADERS, rows);
  audit_('SAVE_SETTINGS', '', JSON.stringify(settings), username);
  return readSystemSettings_();
}

function boolean_(value) {
  return value === true || String(value).toLowerCase() === 'true' || value === 1;
}

function cleanIncoming_(raw, fileName) {
  const arrivalDate = new Date(raw.arrivalAt);
  const barcode = String(raw.barcode || '').trim();

  const naturalId = barcode || [
    raw.plate,
    raw.routeName,
    isNaN(arrivalDate) ? raw.arrivalAt : arrivalDate.toISOString()
  ].join('|');

  return {
    id: hash_(naturalId),
    barcode: barcode,
    previousStation: String(raw.previousStation || '').trim(),
    routeName: String(raw.routeName || '').trim(),
    driverName: String(raw.driverName || '').trim(),
    driverPhone: phone_(raw.driverPhone),
    vehicleType: String(raw.vehicleType || '').trim(),
    plate: String(raw.plate || '').trim(),
    parcels: Number(raw.parcels) || 0,
    arrivalAt: isNaN(arrivalDate)
      ? String(raw.arrivalAt || '')
      : arrivalDate.toISOString(),
    hub: String(raw.hub || '').trim(),
    supplier: String(raw.supplier || '').trim(),
    importedAt: new Date().toISOString(),
    sourceFile: String(fileName || '').slice(0, 200)
  };
}

function migrateLegacyData_(ss, active) {
  const legacy = ss.getSheetByName(SETTINGS.LEGACY_SHEET);

  if (!legacy || legacy.getLastRow() < 2) {
    return 0;
  }

  const values = legacy.getDataRange().getValues();
  const headers = values.shift().map(String);

  const rows = values
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => Object.fromEntries(
      headers.map((header, index) => [header, row[index]])
    ))
    .map(row => cleanIncoming_({
      barcode: pick_(row, ['出车凭证 บาร์โค้ดรถ']),
      previousStation: pick_(row, [
        '上一站网点名称 สาขาก่อนหน้า',
        '上一站网点名称 สถานีก่อนหน้า'
      ]),
      routeName: pick_(row, ['车线名称 ชื่อเส้นทางการเดินรถ']),
      driverName: pick_(row, ['司机姓名 ชื่อพนักงานขับรถ']),
      driverPhone: pick_(row, ['司机电话 เบอร์โทรพนักงานขับรถ']),
      vehicleType: pick_(row, [
        '车辆类型 ประภทรถ',
        '车辆类型 ประเภทรถ'
      ]),
      plate: pick_(row, ['车牌号 เลขทะเบียนรถ']),
      parcels: pick_(row, [
        '包裹总量 จำนวนพัสดุทั้งหมด',
        '待卸车包裹量 จำนวนแพ็คเกจที่ต้องขนถ่าย'
      ]),
      arrivalAt: pick_(row, ['实际到达时间 เวลารถถึงจริง']),
      hub: pick_(row, ['HUB名称 ชื่อHUB']),
      supplier: pick_(row, ['车辆公司名称 Supplier รถ'])
    }, 'ย้ายจากชีตเดิม'))
    .filter(row => row.previousStation && row.arrivalAt);

  replaceData_(active, ACTIVE_HEADERS, rows);
  audit_('MIGRATE', '', 'ย้ายข้อมูลเดิม ' + rows.length + ' รายการ', 'SYSTEM');

  return rows.length;
}

function pick_(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
      return row[name];
    }
  }
  return '';
}

function phone_(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  let text = String(value).replace(/\.0$/, '').trim();

  if (/^\d{9}$/.test(text)) {
    text = '0' + text;
  }

  return text;
}

function assertPin_(pin) {
  const savedHash = PropertiesService
    .getScriptProperties()
    .getProperty('OPERATOR_PIN_HASH');

  if (!savedHash) {
    throw new Error('ยังไม่ได้ตั้งค่ารหัส ให้รัน setupOnce ก่อน');
  }

  if (hash_(String(pin || '')) !== savedHash) {
    const error = new Error('รหัสจัดการไม่ถูกต้อง');
    error.code = 'INVALID_PIN';
    throw error;
  }
}

function hash_(value) {
  return Utilities
    .base64EncodeWebSafe(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        value
      )
    )
    .replace(/=+$/, '');
}

function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    formatHeader_(sheet, 1, headers.length);
    sheet.setFrozenRows(1);
  } else {
    const existing = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String);

    const missing = headers.filter(header => !existing.includes(header));

    if (missing.length) {
      const startColumn = existing.length + 1;
      sheet.getRange(1, startColumn, 1, missing.length).setValues([missing]);
      formatHeader_(sheet, startColumn, missing.length);
    }
  }

  return sheet;
}

function formatHeader_(sheet, startColumn, count) {
  sheet
    .getRange(1, startColumn, 1, count)
    .setFontWeight('bold')
    .setBackground('#101828')
    .setFontColor('#ffffff');
}

function readSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);

  const headers = sheetName === SETTINGS.ACTIVE_SHEET
    ? ACTIVE_HEADERS
    : sheetName === SETTINGS.HISTORY_SHEET
      ? HISTORY_HEADERS
      : AUDIT_HEADERS;

  const sheet = ensureSheet_(ss, sheetName, headers);

  if (sheet.getLastRow() < 2) {
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const sheetHeaders = values.shift().map(String);

  return values
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => Object.fromEntries(
      sheetHeaders.map((header, index) => [
        header,
        row[index] instanceof Date
          ? row[index].toISOString()
          : row[index]
      ])
    ));
}

function replaceData_(sheet, headers, rows) {
  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
      .clearContent();
  }

  if (rows.length) {
    sheet
      .getRange(2, 1, rows.length, headers.length)
      .setValues(
        rows.map(row => headers.map(header => row[header] ?? ''))
      );
  }
}

function appendObject_(sheet, headers, object) {
  sheet.appendRow(headers.map(header => object[header] ?? ''));
}

function audit_(action, recordId, detail, operator) {
  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const auditSheet = ensureSheet_(ss, SETTINGS.AUDIT_SHEET, AUDIT_HEADERS);

  appendObject_(auditSheet, AUDIT_HEADERS, {
    timestamp: new Date().toISOString(),
    action: action,
    recordId: recordId,
    detail: String(detail || '').slice(0, 500),
    operator: operator || 'SYSTEM'
  });
}

function errorResponse_(error) {
  return json_({
    ok: false,
    message: error.message,
    code: error.code || 'SERVER_ERROR'
  });
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// สำรองการอ่านชีตเดิมไว้ตรวจสอบย้อนหลัง
function legacyDoGet_() {
  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SETTINGS.LEGACY_SHEET);

  if (!sheet) {
    throw new Error('ไม่พบชีตเดิม');
  }

  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);

  const rows = values.map(row => Object.fromEntries(
    headers.map((header, index) => {
      let value = row[index];

      if (header === '司机电话 เบอร์โทรพนักงานขับรถ') {
        value = phone_(value);
      }

      if (value instanceof Date) {
        value = Utilities.formatDate(
          value,
          'Asia/Bangkok',
          "yyyy-MM-dd'T'HH:mm:ss"
        );
      }

      return [header, value];
    })
  ));

  return json_(rows);
}

// เก็บไว้รองรับ Trigger เดิมโดยไม่กระทบระบบใหม่
function updateColumnCWithNow() {
  const sheet = SpreadsheetApp
    .openById(SETTINGS.SPREADSHEET_ID)
    .getSheetByName(SETTINGS.LEGACY_SHEET);

  if (!sheet) {
    return;
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const now = new Date();
  const values = Array.from({ length: lastRow - 1 }, () => [now]);

  sheet
    .getRange(2, 3, lastRow - 1, 1)
    .setValues(values);
}
