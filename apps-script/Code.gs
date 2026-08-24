const SETTINGS = {
  SPREADSHEET_ID: '1sqON2-nJLYCS26wWihFmOw27bmg_BdpuRab3maSr1ng',
  LEGACY_SHEET: '未卸车明细 รายละเอียดรถรอลงงาน',
  ACTIVE_SHEET: 'ระบบ_รถรอลงงาน',
  HISTORY_SHEET: 'ระบบ_ประวัติ',
  AUDIT_SHEET: 'ระบบ_บันทึกการใช้งาน',
  USERNAME: 'NE1',
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

// เปลี่ยน 55555 เป็นรหัสกลางก่อนกด Run ครั้งแรก
function setupOnce() {
  return setupSystem('55555');
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
  const expected = PropertiesService
    .getScriptProperties()
    .getProperty('OPERATOR_USERNAME') || SETTINGS.USERNAME;

  if (String(username || '').trim().toUpperCase() !== expected) {
    throw loginError_();
  }

  try {
    assertPin_(pin);
  } catch (error) {
    throw loginError_();
  }

  const expiresAt = Date.now() +
    SETTINGS.SESSION_DAYS * 24 * 60 * 60 * 1000;

  const payload = Utilities
    .base64EncodeWebSafe(
      expected + '|' + expiresAt + '|' + Utilities.getUuid()
    )
    .replace(/=+$/, '');

  const token = payload + '.' + sign_(payload);

  audit_(
    'LOGIN', '',
    'เข้าสู่ระบบถึง ' + new Date(expiresAt).toISOString(),
    expected
  );

  return {
    username: expected,
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
    const expiresAt = Number(fields[1]);

    if (
      username !== SETTINGS.USERNAME ||
      !expiresAt ||
      Date.now() > expiresAt
    ) {
      throw new Error('Expired token');
    }

    return username;
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

  const activeMap = new Map(
    readSheet_(SETTINGS.ACTIVE_SHEET).map(
      row => [String(row.id), row]
    )
  );

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
    operator
  );

  return {
    imported: imported,
    skipped: skipped,
    total: activeMap.size
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
    operator: operator
  });

  active.deleteRow(index + 2);
  audit_(status, id, note, operator);

  return {
    id: id,
    status: status,
    operator: operator
  };
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
