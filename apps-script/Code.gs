const SETTINGS = {
  SPREADSHEET_ID: '1sqON2-nJLYCS26wWihFmOw27bmg_BdpuRab3maSr1ng',
  LEGACY_SHEET: '未卸车明细 รายละเอียดรถรอลงงาน',
  ACTIVE_SHEET: 'ระบบ_รถรอลงงาน',
  HISTORY_SHEET: 'ระบบ_ประวัติ',
  AUDIT_SHEET: 'ระบบ_บันทึกการใช้งาน',
  SYSTEM_SHEET: 'ระบบ_ตั้งค่า',
  USERS_SHEET: 'ระบบ_ผู้ใช้งาน',
  USERNAME: 'NE1',
  ADMIN_USERNAME: 'ADMIN',
  SESSION_DAYS: 180
};

const ACTIVE_HEADERS = [
  'id', 'barcode', 'previousStation', 'routeName',
  'driverName', 'driverPhone', 'vehicleType', 'plate',
  'parcels', 'arrivalAt', 'hub', 'supplier',
  'importedAt', 'sourceFile', 'workStatus', 'startedAt', 'startedBy'
];

const HISTORY_HEADERS = [
  ...ACTIVE_HEADERS, 'status', 'actionAt', 'note', 'operator'
];

const AUDIT_HEADERS = [
  'timestamp', 'action', 'recordId', 'detail', 'operator'
];

const SYSTEM_HEADERS = [
  'branch', 'category', 'key', 'label', 'startHour', 'endHour',
  'minutes', 'color', 'enabled', 'updatedAt', 'updatedBy'
];

const USER_HEADERS = [
  'username', 'passwordHash', 'role', 'branches', 'active',
  'createdAt', 'updatedAt', 'updatedBy'
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

// ใช้เฉพาะการติดตั้งครั้งแรก
function setupOnce() {
  return setupSystem('12345');
}

// ใช้เฉพาะกรณียังไม่เคยสร้าง ADMIN
function setupAdminOnce() {
  return setAdminAccount_(
    'ADMIN',
    '555555'
  );
}

function setupSystem(operatorPin) {
  if (!operatorPin || String(operatorPin).length < 4) {
    throw new Error('รหัสต้องมีอย่างน้อย 4 ตัว');
  }

  const props = PropertiesService.getScriptProperties();

  props.setProperty(
    'OPERATOR_PIN_HASH',
    hash_(String(operatorPin))
  );

  props.setProperty(
    'OPERATOR_USERNAME',
    SETTINGS.USERNAME
  );

  if (!props.getProperty('AUTH_SECRET')) {
    props.setProperty(
      'AUTH_SECRET',
      Utilities.getUuid() + Utilities.getUuid()
    );
  }

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const active = ensureSheet_(
    ss,
    SETTINGS.ACTIVE_SHEET,
    ACTIVE_HEADERS
  );

  ensureSheet_(ss, SETTINGS.HISTORY_SHEET, HISTORY_HEADERS);
  ensureSheet_(ss, SETTINGS.AUDIT_SHEET, AUDIT_HEADERS);
  ensureSystemSettings_(ss);
  ensureUserSystem_(ss);

  const migrated = active.getLastRow() < 2
    ? migrateLegacyData_(ss, active)
    : 0;

  return 'ตั้งค่าระบบสำเร็จ ย้ายข้อมูลเดิม ' +
    migrated + ' รายการ';
}

function doGet(e) {
  try {
    const action = String(
      e?.parameter?.action || 'list'
    );

    if (action === 'health') {
      return json_({
        ok: true,
        data: {
          service: 'waiting-trucks-api',
          time: new Date().toISOString()
        }
      });
    }

    const operator = verifySession_(
      e?.parameter?.token
    );

    if (action === 'history') {
      return json_({
        ok: true,
        data: scopeRows_(
          readSheet_(SETTINGS.HISTORY_SHEET),
          operator
        ).slice(-1000)
      });
    }

    if (action === 'users') {
      assertAdmin_(operator);

      return json_({
        ok: true,
        data: listUsers_()
      });
    }

    if (action === 'settings') {
      const branch = settingsBranch_(
        operator,
        e?.parameter?.branch
      );

      return json_({
        ok: true,
        data: readSystemSettings_(branch)
      });
    }

    return json_({
      ok: true,
      data: scopeRows_(
        readSheet_(SETTINGS.ACTIVE_SHEET),
        operator
      )
    });

  } catch (error) {
    return errorResponse_(error);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    const body = JSON.parse(
      e?.postData?.contents || '{}'
    );

    if (body.action === 'login') {
      return json_({
        ok: true,
        data: login_(body.username, body.pin)
      });
    }

    lock.waitLock(20000);

    const operator = verifySession_(
      body.token
    );

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

    if (body.action === 'start') {
      return json_({
        ok: true,
        data: startUnloading_(
          body.id,
          operator
        )
      });
    }

    if (body.action === 'cancelStart') {
      return json_({
        ok: true,
        data: cancelUnloading_(
          body.id,
          operator
        )
      });
    }

    if (body.action === 'complete') {
      return json_({
        ok: true,
        data: archiveRecord_(
          body.id,
          'COMPLETED',
          body.note || '',
          operator
        )
      });
    }

    if (body.action === 'remove') {
      return json_({
        ok: true,
        data: archiveRecord_(
          body.id,
          'REMOVED',
          body.note || '',
          operator
        )
      });
    }

    if (body.action === 'saveSettings') {
      assertAdmin_(operator);

      const branch = settingsBranch_(
        operator,
        body.branch
      );

      return json_({
        ok: true,
        data: saveSystemSettings_(
          body.settings || {},
          operator.username,
          branch
        )
      });
    }

    if (body.action === 'saveUser') {
      assertAdmin_(operator);

      return json_({
        ok: true,
        data: saveUser_(
          body.user || {},
          operator.username
        )
      });
    }

    if (body.action === 'setUserActive') {
      assertAdmin_(operator);

      return json_({
        ok: true,
        data: setUserActive_(
          body.username,
          body.active,
          operator.username
        )
      });
    }

    if (body.action === 'changePassword') {
      return json_({
        ok: true,
        data: changePassword_(
          operator,
          body.currentPassword,
          body.newPassword
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
  const inputUsername = String(
    username || ''
  ).trim().toUpperCase();

  const user = getUser_(inputUsername);

  if (
    !user ||
    !boolean_(user.active) ||
    hash_(String(pin || '')) !==
      String(user.passwordHash || '')
  ) {
    throw loginError_();
  }

  const role = String(
    user.role || 'operator'
  ).toLowerCase();

  const branches = parseBranches_(
    user.branches
  );

  const expiresAt =
    Date.now() +
    SETTINGS.SESSION_DAYS *
      24 * 60 * 60 * 1000;

  const payload = Utilities
    .base64EncodeWebSafe(
      inputUsername + '|' +
      role + '|' +
      expiresAt + '|' +
      Utilities.getUuid()
    )
    .replace(/=+$/, '');

  const token =
    payload + '.' + sign_(payload);

  audit_(
    'LOGIN',
    '',
    'เข้าสู่ระบบถึง ' +
      new Date(expiresAt).toISOString(),
    inputUsername
  );

  return {
    username: inputUsername,
    role: role,
    branches: branches,
    token: token,
    expiresAt: expiresAt
  };
}

function loginError_() {
  const error = new Error(
    'Username หรือรหัสจัดการไม่ถูกต้อง'
  );

  error.code = 'INVALID_LOGIN';

  return error;
}

function verifySession_(token) {
  try {
    const parts = String(
      token || ''
    ).split('.');

    if (
      parts.length !== 2 ||
      parts[1] !== sign_(parts[0])
    ) {
      throw new Error('Invalid token');
    }

    const decoded = Utilities
      .newBlob(
        Utilities.base64DecodeWebSafe(
          parts[0]
        )
      )
      .getDataAsString();

    const fields = decoded.split('|');
    const username = fields[0];

    const legacyToken =
      /^\d+$/.test(fields[1] || '');

    const role = legacyToken
      ? 'operator'
      : String(fields[1] || '')
          .trim()
          .toLowerCase();

    const expiresAt = Number(
      legacyToken
        ? fields[1]
        : fields[2]
    );

    if (
      !['operator', 'admin'].includes(role) ||
      !expiresAt ||
      Date.now() > expiresAt
    ) {
      throw new Error('Expired token');
    }

    const user = getUser_(username);

    if (
      !user ||
      !boolean_(user.active) ||
      String(user.role)
        .trim()
        .toLowerCase() !== role
    ) {
      throw new Error('Disabled user');
    }

    return {
      username: username,
      role: role,
      branches:
        parseBranches_(user.branches)
    };

  } catch (error) {
    const sessionError = new Error(
      'สิทธิ์หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
    );

    sessionError.code =
      'INVALID_SESSION';

    throw sessionError;
  }
}

function sign_(payload) {
  const props =
    PropertiesService.getScriptProperties();

  let secret =
    props.getProperty('AUTH_SECRET');

  if (!secret) {
    secret =
      Utilities.getUuid() +
      Utilities.getUuid();

    props.setProperty(
      'AUTH_SECRET',
      secret
    );
  }

  return Utilities
    .base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(
        payload,
        secret
      )
    )
    .replace(/=+$/, '');
}

function importRows_(incoming, fileName, operator) {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const active = ensureSheet_(
    ss,
    SETTINGS.ACTIVE_SHEET,
    ACTIVE_HEADERS
  );

  const blocked = new Set(
    readSheet_(
      SETTINGS.HISTORY_SHEET
    ).map(row => String(row.id))
  );

  const existingRows = readSheet_(
    SETTINGS.ACTIVE_SHEET
  );

  const existingById = new Map(
    existingRows.map(row => [
      String(row.id),
      row
    ])
  );

  const defaultBranch =
    operator.role === 'admin'
      ? ''
      : (
          operator.branches.length === 1
            ? operator.branches[0]
            : ''
        );

  const importedBranches = new Set();
  const incomingMap = new Map();

  let imported = 0;
  let skipped = 0;

  incoming.forEach(raw => {
    const prepared = {
      ...raw,
      hub: raw.hub || defaultBranch
    };

    const row = cleanIncoming_(
      prepared,
      fileName
    );

    const existing = existingById.get(
      String(row.id)
    );

    // นำเข้าไฟล์ซ้ำแล้วคงสถานะกำลังลงงานไว้
    if (existing) {
      row.workStatus =
        existing.workStatus || '';

      row.startedAt =
        existing.startedAt || '';

      row.startedBy =
        existing.startedBy || '';
    }

    if (
      !row.previousStation ||
      !row.arrivalAt
    ) {
      return;
    }

    if (blocked.has(String(row.id))) {
      skipped++;
      return;
    }

    if (!row.hub) {
      throw new Error(
        'ไม่พบสาขาในไฟล์ กรุณาระบุสาขาของผู้ใช้ให้เหลือ 1 สาขา'
      );
    }

    if (!canAccessRow_(row, operator)) {
      throw new Error(
        'ไม่มีสิทธิ์นำเข้าข้อมูลของสาขา ' +
        row.hub
      );
    }

    importedBranches.add(
      normalizeBranch_(row.hub)
    );

    incomingMap.set(
      String(row.id),
      row
    );

    imported++;
  });

  const preserved = existingRows.filter(
    row =>
      !importedBranches.has(
        normalizeBranch_(row.hub)
      )
  );

  const finalRows =
    preserved.concat(
      Array.from(incomingMap.values())
    );

  const previousScopedTotal =
    existingRows.length -
    preserved.length;

  replaceData_(
    active,
    ACTIVE_HEADERS,
    finalRows
  );

  audit_(
    'IMPORT',
    '',
    fileName + ': ' +
      imported + ' imported, ' +
      skipped + ' skipped',
    operator.username
  );

  return {
    imported: imported,
    skipped: skipped,
    total: incomingMap.size,
    removed: Math.max(
      0,
      previousScopedTotal -
      incomingMap.size
    ),
    branches:
      Array.from(importedBranches)
  };
}

function startUnloading_(id, operator) {
  if (!id) {
    throw new Error('ไม่พบรหัสรายการ');
  }

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const active = ensureSheet_(
    ss,
    SETTINGS.ACTIVE_SHEET,
    ACTIVE_HEADERS
  );

  const rows = readSheet_(
    SETTINGS.ACTIVE_SHEET
  );

  const index = rows.findIndex(
    row => String(row.id) === String(id)
  );

  if (index < 0) {
    throw new Error(
      'ไม่พบรถรายการนี้ กรุณารีเฟรชหน้าเว็บ'
    );
  }

  if (!canAccessRow_(rows[index], operator)) {
    throw new Error(
      'ไม่มีสิทธิ์จัดการข้อมูลของสาขานี้'
    );
  }

  if (
    String(rows[index].workStatus) !==
    'UNLOADING'
  ) {
    rows[index].workStatus = 'UNLOADING';

    rows[index].startedAt =
      new Date().toISOString();

    rows[index].startedBy =
      operator.username;

    replaceData_(
      active,
      ACTIVE_HEADERS,
      rows
    );

    audit_(
      'START_UNLOADING',
      id,
      'เริ่มลงงาน',
      operator.username
    );
  }

  return {
    id: id,
    workStatus: 'UNLOADING',
    startedAt: rows[index].startedAt,
    startedBy: rows[index].startedBy
  };
}

function cancelUnloading_(id, operator) {
  if (!id) {
    throw new Error('ไม่พบรหัสรายการ');
  }

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const active = ensureSheet_(
    ss,
    SETTINGS.ACTIVE_SHEET,
    ACTIVE_HEADERS
  );

  const rows = readSheet_(
    SETTINGS.ACTIVE_SHEET
  );

  const index = rows.findIndex(
    row => String(row.id) === String(id)
  );

  if (index < 0) {
    throw new Error(
      'ไม่พบรถรายการนี้ กรุณารีเฟรชหน้าเว็บ'
    );
  }

  if (!canAccessRow_(rows[index], operator)) {
    throw new Error(
      'ไม่มีสิทธิ์จัดการข้อมูลของสาขานี้'
    );
  }

  rows[index].workStatus = '';
  rows[index].startedAt = '';
  rows[index].startedBy = '';

  replaceData_(
    active,
    ACTIVE_HEADERS,
    rows
  );

  audit_(
    'CANCEL_UNLOADING',
    id,
    'ย้อนกลับสถานะกำลังลงงาน',
    operator.username
  );

  return {
    id: id,
    workStatus: ''
  };
}

function archiveRecord_(id, status, note, operator) {
  if (!id) {
    throw new Error('ไม่พบรหัสรายการ');
  }

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const active = ensureSheet_(
    ss,
    SETTINGS.ACTIVE_SHEET,
    ACTIVE_HEADERS
  );

  const rows = readSheet_(
    SETTINGS.ACTIVE_SHEET
  );

  const index = rows.findIndex(
    row => String(row.id) === String(id)
  );

  if (index < 0) {
    throw new Error(
      'รายการนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าเว็บ'
    );
  }

  if (!canAccessRow_(rows[index], operator)) {
    throw new Error(
      'ไม่มีสิทธิ์จัดการข้อมูลของสาขานี้'
    );
  }

  const history = ensureSheet_(
    ss,
    SETTINGS.HISTORY_SHEET,
    HISTORY_HEADERS
  );

  appendObject_(
    history,
    HISTORY_HEADERS,
    {
      ...rows[index],
      status: status,
      actionAt:
        new Date().toISOString(),
      note: String(note || '')
        .slice(0, 500),
      operator: operator.username
    }
  );

  active.deleteRow(index + 2);

  audit_(
    status,
    id,
    note,
    operator.username
  );

  return {
    id: id,
    status: status,
    operator: operator.username
  };
}

function setAdminAccount_(username, adminPin) {
  const cleanUsername = String(
    username || ''
  ).trim().toUpperCase();

  const cleanPin = String(
    adminPin || ''
  ).trim();

  if (
    !cleanUsername ||
    cleanPin.length < 6 ||
    cleanPin.indexOf('เปลี่ยน') >= 0
  ) {
    throw new Error(
      'กรุณาแก้รหัสใน setupAdminOnce ให้มีอย่างน้อย 6 ตัวก่อนกด Run'
    );
  }

  const props =
    PropertiesService.getScriptProperties();

  props.setProperty(
    'ADMIN_USERNAME',
    cleanUsername
  );

  props.setProperty(
    'ADMIN_PIN_HASH',
    hash_(cleanPin)
  );

  if (!props.getProperty('AUTH_SECRET')) {
    props.setProperty(
      'AUTH_SECRET',
      Utilities.getUuid() +
      Utilities.getUuid()
    );
  }

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  ensureUserSystem_(ss);

  upsertUserRow_(
    {
      username: cleanUsername,
      passwordHash: hash_(cleanPin),
      role: 'admin',
      branches: '*',
      active: true
    },
    cleanUsername
  );

  audit_(
    'ADMIN_SETUP',
    '',
    'ตั้งค่าบัญชีผู้ดูแล',
    cleanUsername
  );

  return 'ตั้งค่าบัญชีผู้ดูแล ' +
    cleanUsername + ' สำเร็จ';
}

function assertAdmin_(operator) {
  if (
    !operator ||
    operator.role !== 'admin'
  ) {
    const error = new Error(
      'คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบ'
    );

    error.code = 'ADMIN_REQUIRED';

    throw error;
  }
}

function ensureUserSystem_(ss) {
  const sheet = ensureSheet_(
    ss,
    SETTINGS.USERS_SHEET,
    USER_HEADERS
  );

  const props =
    PropertiesService.getScriptProperties();

  const now =
    new Date().toISOString();

  if (
    !getUserFromSheet_(
      sheet,
      SETTINGS.USERNAME
    )
  ) {
    const operatorHash =
      props.getProperty(
        'OPERATOR_PIN_HASH'
      );

    if (operatorHash) {
      sheet.appendRow(
        USER_HEADERS.map(header => ({
          username:
            SETTINGS.USERNAME,
          passwordHash:
            operatorHash,
          role: 'operator',
          branches:
            SETTINGS.USERNAME,
          active: true,
          createdAt: now,
          updatedAt: now,
          updatedBy: 'SYSTEM'
        })[header] ?? '')
      );
    }
  }

  const adminName =
    props.getProperty(
      'ADMIN_USERNAME'
    ) ||
    SETTINGS.ADMIN_USERNAME;

  const adminHash =
    props.getProperty(
      'ADMIN_PIN_HASH'
    );

  if (
    adminHash &&
    !getUserFromSheet_(
      sheet,
      adminName
    )
  ) {
    sheet.appendRow(
      USER_HEADERS.map(header => ({
        username: adminName,
        passwordHash: adminHash,
        role: 'admin',
        branches: '*',
        active: true,
        createdAt: now,
        updatedAt: now,
        updatedBy: 'SYSTEM'
      })[header] ?? '')
    );
  }

  return sheet;
}

function getUserFromSheet_(sheet, username) {
  if (sheet.getLastRow() < 2) {
    return null;
  }

  const values =
    sheet.getDataRange().getValues();

  const headers =
    values.shift().map(String);

  const target = String(
    username || ''
  ).trim().toUpperCase();

  const row = values.find(
    item =>
      String(item[0])
        .trim()
        .toUpperCase() === target
  );

  return row
    ? Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            row[index]
          ]
        )
      )
    : null;
}

function getUser_(username) {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  return getUserFromSheet_(
    ensureUserSystem_(ss),
    username
  );
}

function parseBranches_(value) {
  const text = String(
    value || ''
  ).trim().toUpperCase();

  if (text === '*') {
    return ['*'];
  }

  return [
    ...new Set(
      text
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    )
  ];
}

function listUsers_() {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const sheet =
    ensureUserSystem_(ss);

  if (sheet.getLastRow() < 2) {
    return [];
  }

  const values =
    sheet.getDataRange().getValues();

  const headers =
    values.shift().map(String);

  return values
    .filter(row =>
      row.some(value =>
        value !== '' &&
        value !== null
      )
    )
    .map(row =>
      Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            row[index]
          ]
        )
      )
    )
    .map(user => ({
      username:
        String(user.username),
      role:
        String(user.role),
      branches:
        parseBranches_(
          user.branches
        ),
      active:
        boolean_(user.active),
      createdAt:
        user.createdAt,
      updatedAt:
        user.updatedAt,
      updatedBy:
        user.updatedBy
    }));
}

function saveUser_(input, updatedBy) {
  const username = String(
    input.username || ''
  ).trim().toUpperCase();

  const role = String(
    input.role || 'operator'
  ).trim().toLowerCase();

  const branches =
    Array.isArray(input.branches)
      ? parseBranches_(
          input.branches.join(',')
        )
      : parseBranches_(
          input.branches
        );

  const password = String(
    input.password || ''
  ).trim();

  const existing =
    getUser_(username);

  if (
    !/^[A-Z0-9_-]{2,30}$/.test(
      username
    )
  ) {
    throw new Error(
      'Username ใช้ได้เฉพาะ A-Z, 0-9, _ และ - จำนวน 2–30 ตัว'
    );
  }

  if (
    !['operator', 'admin']
      .includes(role)
  ) {
    throw new Error(
      'สิทธิ์ผู้ใช้ไม่ถูกต้อง'
    );
  }

  if (
    role !== 'admin' &&
    !branches.length
  ) {
    throw new Error(
      'ผู้ใช้งานทั่วไปต้องมีอย่างน้อย 1 สาขา'
    );
  }

  if (
    !existing &&
    password.length < 6
  ) {
    throw new Error(
      'ผู้ใช้ใหม่ต้องมีรหัสผ่านอย่างน้อย 6 ตัว'
    );
  }

  if (
    password &&
    password.length < 6
  ) {
    throw new Error(
      'รหัสผ่านต้องมีอย่างน้อย 6 ตัว'
    );
  }

  upsertUserRow_(
    {
      username: username,
      passwordHash: password
        ? hash_(password)
        : existing.passwordHash,
      role: role,
      branches:
        role === 'admin'
          ? '*'
          : branches.join(','),
      active:
        input.active !== false
    },
    updatedBy
  );

  audit_(
    'SAVE_USER',
    username,
    role + ' / ' +
      branches.join(','),
    updatedBy
  );

  return listUsers_();
}

function upsertUserRow_(input, updatedBy) {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const sheet = ensureSheet_(
    ss,
    SETTINGS.USERS_SHEET,
    USER_HEADERS
  );

  const values =
    sheet.getDataRange().getValues();

  const username = String(
    input.username
  ).trim().toUpperCase();

  let rowIndex = -1;

  for (
    let index = 1;
    index < values.length;
    index++
  ) {
    if (
      String(values[index][0])
        .trim()
        .toUpperCase() === username
    ) {
      rowIndex = index + 1;
      break;
    }
  }

  const existingCreatedAt =
    rowIndex > 0
      ? values[rowIndex - 1][5]
      : '';

  const now =
    new Date().toISOString();

  const object = {
    username: username,
    passwordHash:
      input.passwordHash,
    role: input.role,
    branches: input.branches,
    active:
      input.active !== false,
    createdAt:
      existingCreatedAt || now,
    updatedAt: now,
    updatedBy: updatedBy
  };

  const row = USER_HEADERS.map(
    header =>
      object[header] ?? ''
  );

  if (rowIndex > 0) {
    sheet
      .getRange(
        rowIndex,
        1,
        1,
        USER_HEADERS.length
      )
      .setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function setUserActive_(
  username,
  active,
  updatedBy
) {
  const existing =
    getUser_(username);

  if (!existing) {
    throw new Error(
      'ไม่พบผู้ใช้งาน'
    );
  }

  if (
    String(username).toUpperCase() ===
      String(updatedBy).toUpperCase() &&
    !active
  ) {
    throw new Error(
      'ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่'
    );
  }

  upsertUserRow_(
    {
      username:
        existing.username,
      passwordHash:
        existing.passwordHash,
      role:
        existing.role,
      branches:
        existing.branches,
      active:
        Boolean(active)
    },
    updatedBy
  );

  audit_(
    'SET_USER_ACTIVE',
    username,
    String(Boolean(active)),
    updatedBy
  );

  return listUsers_();
}

function changePassword_(
  operator,
  currentPassword,
  newPassword
) {
  const next = String(
    newPassword || ''
  ).trim();

  const user =
    getUser_(operator.username);

  if (
    !user ||
    hash_(String(currentPassword || '')) !==
      String(user.passwordHash)
  ) {
    throw new Error(
      'รหัสผ่านปัจจุบันไม่ถูกต้อง'
    );
  }

  if (next.length < 6) {
    throw new Error(
      'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัว'
    );
  }

  if (
    hash_(next) ===
    String(user.passwordHash)
  ) {
    throw new Error(
      'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม'
    );
  }

  upsertUserRow_(
    {
      username: user.username,
      passwordHash: hash_(next),
      role: user.role,
      branches: user.branches,
      active: true
    },
    operator.username
  );

  audit_(
    'CHANGE_PASSWORD',
    operator.username,
    'เปลี่ยนรหัสผ่าน',
    operator.username
  );

  return {
    changed: true
  };
}

function normalizeBranch_(value) {
  return String(
    value || ''
  ).trim().toUpperCase();
}

function canAccessRow_(row, operator) {
  if (
    operator.role === 'admin' ||
    operator.branches.includes('*')
  ) {
    return true;
  }

  const hub =
    normalizeBranch_(row.hub);

  if (!hub) {
    return (
      operator.branches.length === 1
    );
  }

  return operator.branches.some(
    branch =>
      hub === branch ||
      hub.includes(branch)
  );
}

function scopeRows_(rows, operator) {
  return rows.filter(
    row =>
      canAccessRow_(row, operator)
  );
}

function settingsBranch_(operator, requested) {
  const branch =
    normalizeBranch_(requested);

  if (operator.role === 'admin') {
    return (
      branch ||
      SETTINGS.USERNAME
    );
  }

  if (
    branch &&
    !operator.branches.includes(branch) &&
    !operator.branches.includes('*')
  ) {
    throw new Error(
      'ไม่มีสิทธิ์เข้าถึงการตั้งค่าฮับนี้'
    );
  }

  return (
    branch ||
    operator.branches[0] ||
    SETTINGS.USERNAME
  );
}

function ensureSystemSettings_(ss) {
  const sheet = ensureSheet_(
    ss,
    SETTINGS.SYSTEM_SHEET,
    SYSTEM_HEADERS
  );

  if (sheet.getLastRow() < 2) {
    const now =
      new Date().toISOString();

    const rows = [];

    DEFAULT_PAUSE_WINDOWS.forEach(
      item => rows.push({
        branch: SETTINGS.USERNAME,
        category: 'pause',
        key: item[0],
        label: item[1],
        startHour: item[2],
        endHour: item[3],
        minutes: '',
        enabled: true,
        updatedAt: now,
        updatedBy: 'SYSTEM'
      })
    );

    DEFAULT_VEHICLE_LIMITS.forEach(
      item => rows.push({
        branch: SETTINGS.USERNAME,
        category: 'vehicle',
        key: item[0],
        label: item[0],
        startHour: '',
        endHour: '',
        minutes: item[1],
        enabled: true,
        updatedAt: now,
        updatedBy: 'SYSTEM'
      })
    );

    replaceData_(
      sheet,
      SYSTEM_HEADERS,
      rows
    );
  }

  return sheet;
}

function readSystemSettings_(branch) {
  branch =
    normalizeBranch_(branch) ||
    SETTINGS.USERNAME;

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const sheet =
    ensureSystemSettings_(ss);

  const values =
    sheet.getDataRange().getValues();

  const headers =
    values.shift().map(String);

  const rows = values
    .filter(row =>
      row.some(value =>
        value !== '' &&
        value !== null
      )
    )
    .map(row =>
      Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            row[index]
          ]
        )
      )
    )
    .filter(row =>
      normalizeBranch_(row.branch) ===
        branch ||
      (
        !normalizeBranch_(row.branch) &&
        branch === SETTINGS.USERNAME
      )
    );

  if (!rows.length) {
    return {
      branch: branch,

      pauseWindows:
        DEFAULT_PAUSE_WINDOWS.map(
          item => ({
            key: item[0],
            label: item[1],
            startHour: item[2],
            endHour: item[3]
          })
        ),

      vehicleLimits:
        DEFAULT_VEHICLE_LIMITS.map(
          item => ({
            type: item[0],
            minutes: item[1]
          })
        )
    };
  }

  return {
    branch: branch,

    pauseWindows: rows
      .filter(row =>
        row.category === 'pause' &&
        boolean_(row.enabled)
      )
      .map(row => ({
        key: String(row.key),
        label: String(
          row.label || ''
        ),
        startHour:
          Number(row.startHour),
        endHour:
          Number(row.endHour)
      })),

    vehicleLimits: rows
      .filter(row =>
        row.category === 'vehicle' &&
        boolean_(row.enabled)
      )
      .map(row => ({
        type: String(row.key)
          .trim()
          .toUpperCase(),
        minutes:
          Number(row.minutes) || 120
      }))
  };
}

function saveSystemSettings_(
  settings,
  username,
  branch
) {
  branch =
    normalizeBranch_(branch) ||
    SETTINGS.USERNAME;

  const pauseWindows =
    Array.isArray(
      settings.pauseWindows
    )
      ? settings.pauseWindows
      : [];

  const vehicleLimits =
    Array.isArray(
      settings.vehicleLimits
    )
      ? settings.vehicleLimits
      : [];

  if (vehicleLimits.length < 1) {
    throw new Error(
      'ต้องมีประเภทรถอย่างน้อย 1 ประเภท'
    );
  }

  const now =
    new Date().toISOString();

  const rows = [];

  pauseWindows.forEach(
    (item, index) => {
      const start =
        Number(item.startHour);

      const end =
        Number(item.endHour);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start >= 24 ||
        end < 0 ||
        end >= 24 ||
        start === end
      ) {
        throw new Error(
          'ช่วงไม่มีกะลำดับที่ ' +
          (index + 1) +
          ' ไม่ถูกต้อง'
        );
      }

      rows.push({
        branch: branch,
        category: 'pause',
        key:
          'pause-' + (index + 1),
        label: String(
          item.label ||
          (
            'ช่วงไม่มีกะ ' +
            (index + 1)
          )
        ).slice(0, 100),
        startHour: start,
        endHour: end,
        minutes: '',
        enabled: true,
        updatedAt: now,
        updatedBy: username
      });
    }
  );

  const seen = new Set();

  vehicleLimits.forEach(
    (item, index) => {
      const type = String(
        item.type || ''
      ).trim().toUpperCase();

      const minutes = Math.round(
        Number(item.minutes)
      );

      if (
        !type ||
        seen.has(type) ||
        !Number.isFinite(minutes) ||
        minutes < 1 ||
        minutes > 1440
      ) {
        throw new Error(
          'ข้อมูลประเภทรถลำดับที่ ' +
          (index + 1) +
          ' ไม่ถูกต้อง'
        );
      }

      seen.add(type);

      rows.push({
        branch: branch,
        category: 'vehicle',
        key: type,
        label: type,
        startHour: '',
        endHour: '',
        minutes: minutes,
        enabled: true,
        updatedAt: now,
        updatedBy: username
      });
    }
  );

  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const sheet = ensureSheet_(
    ss,
    SETTINGS.SYSTEM_SHEET,
    SYSTEM_HEADERS
  );

  const existing =
    sheet.getDataRange().getValues();

  const headers =
    existing.shift().map(String);

  const keep = existing
    .filter(row =>
      row.some(value =>
        value !== '' &&
        value !== null
      )
    )
    .map(row =>
      Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            row[index]
          ]
        )
      )
    )
    .filter(row => {
      const rowBranch =
        normalizeBranch_(row.branch) ||
        SETTINGS.USERNAME;

      return rowBranch !== branch;
    });

  replaceData_(
    sheet,
    SYSTEM_HEADERS,
    keep.concat(rows)
  );

  audit_(
    'SAVE_SETTINGS',
    branch,
    JSON.stringify(settings),
    username
  );

  return readSystemSettings_(branch);
}

function boolean_(value) {
  return (
    value === true ||
    String(value).toLowerCase() ===
      'true' ||
    value === 1
  );
}

function cleanIncoming_(raw, fileName) {
  const arrivalDate =
    new Date(raw.arrivalAt);

  const barcode = String(
    raw.barcode || ''
  ).trim();

  const naturalId =
    barcode ||
    [
      raw.plate,
      raw.routeName,
      isNaN(arrivalDate)
        ? raw.arrivalAt
        : arrivalDate.toISOString()
    ].join('|');

  return {
    id: hash_(naturalId),
    barcode: barcode,
    previousStation: String(
      raw.previousStation || ''
    ).trim(),
    routeName: String(
      raw.routeName || ''
    ).trim(),
    driverName: String(
      raw.driverName || ''
    ).trim(),
    driverPhone:
      phone_(raw.driverPhone),
    vehicleType: String(
      raw.vehicleType || ''
    ).trim(),
    plate: String(
      raw.plate || ''
    ).trim(),
    parcels:
      Number(raw.parcels) || 0,
    arrivalAt:
      isNaN(arrivalDate)
        ? String(raw.arrivalAt || '')
        : arrivalDate.toISOString(),
    hub: String(
      raw.hub || ''
    ).trim(),
    supplier: String(
      raw.supplier || ''
    ).trim(),
    importedAt:
      new Date().toISOString(),
    sourceFile: String(
      fileName || ''
    ).slice(0, 200),
    workStatus: '',
    startedAt: '',
    startedBy: ''
  };
}

function migrateLegacyData_(ss, active) {
  const legacy = ss.getSheetByName(
    SETTINGS.LEGACY_SHEET
  );

  if (
    !legacy ||
    legacy.getLastRow() < 2
  ) {
    return 0;
  }

  const values =
    legacy.getDataRange().getValues();

  const headers =
    values.shift().map(String);

  const rows = values
    .filter(row =>
      row.some(value =>
        value !== '' &&
        value !== null
      )
    )
    .map(row =>
      Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            row[index]
          ]
        )
      )
    )
    .map(row =>
      cleanIncoming_(
        {
          barcode: pick_(
            row,
            ['出车凭证 บาร์โค้ดรถ']
          ),

          previousStation: pick_(
            row,
            [
              '上一站网点名称 สาขาก่อนหน้า',
              '上一站网点名称 สถานีก่อนหน้า'
            ]
          ),

          routeName: pick_(
            row,
            ['车线名称 ชื่อเส้นทางการเดินรถ']
          ),

          driverName: pick_(
            row,
            ['司机姓名 ชื่อพนักงานขับรถ']
          ),

          driverPhone: pick_(
            row,
            ['司机电话 เบอร์โทรพนักงานขับรถ']
          ),

          vehicleType: pick_(
            row,
            [
              '车辆类型 ประภทรถ',
              '车辆类型 ประเภทรถ'
            ]
          ),

          plate: pick_(
            row,
            ['车牌号 เลขทะเบียนรถ']
          ),

          parcels: pick_(
            row,
            [
              '包裹总量 จำนวนพัสดุทั้งหมด',
              '待卸车包裹量 จำนวนแพ็คเกจที่ต้องขนถ่าย'
            ]
          ),

          arrivalAt: pick_(
            row,
            ['实际到达时间 เวลารถถึงจริง']
          ),

          hub: pick_(
            row,
            ['HUB名称 ชื่อHUB']
          ),

          supplier: pick_(
            row,
            ['车辆公司名称 Supplier รถ']
          )
        },
        'ย้ายจากชีตเดิม'
      )
    )
    .filter(row =>
      row.previousStation &&
      row.arrivalAt
    );

  replaceData_(
    active,
    ACTIVE_HEADERS,
    rows
  );

  audit_(
    'MIGRATE',
    '',
    'ย้ายข้อมูลเดิม ' +
      rows.length +
      ' รายการ',
    'SYSTEM'
  );

  return rows.length;
}

function pick_(row, names) {
  for (const name of names) {
    if (
      row[name] !== undefined &&
      row[name] !== null &&
      row[name] !== ''
    ) {
      return row[name];
    }
  }

  return '';
}

function phone_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  let text = String(value)
    .replace(/\.0$/, '')
    .trim();

  if (/^\d{9}$/.test(text)) {
    text = '0' + text;
  }

  return text;
}

function assertPin_(pin) {
  const savedHash =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        'OPERATOR_PIN_HASH'
      );

  if (!savedHash) {
    throw new Error(
      'ยังไม่ได้ตั้งค่ารหัส ให้รัน setupOnce ก่อน'
    );
  }

  if (
    hash_(String(pin || '')) !==
    savedHash
  ) {
    const error = new Error(
      'รหัสจัดการไม่ถูกต้อง'
    );

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
  let sheet =
    ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet =
      ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues([headers]);

    formatHeader_(
      sheet,
      1,
      headers.length
    );

    sheet.setFrozenRows(1);

  } else {
    const existing = sheet
      .getRange(
        1,
        1,
        1,
        sheet.getLastColumn()
      )
      .getValues()[0]
      .map(String);

    const missing =
      headers.filter(
        header =>
          !existing.includes(header)
      );

    if (missing.length) {
      const startColumn =
        existing.length + 1;

      sheet
        .getRange(
          1,
          startColumn,
          1,
          missing.length
        )
        .setValues([missing]);

      formatHeader_(
        sheet,
        startColumn,
        missing.length
      );
    }
  }

  return sheet;
}

function formatHeader_(sheet, startColumn, count) {
  sheet
    .getRange(
      1,
      startColumn,
      1,
      count
    )
    .setFontWeight('bold')
    .setBackground('#101828')
    .setFontColor('#ffffff');
}

function readSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const headers =
    sheetName === SETTINGS.ACTIVE_SHEET
      ? ACTIVE_HEADERS
      : sheetName === SETTINGS.HISTORY_SHEET
        ? HISTORY_HEADERS
        : AUDIT_HEADERS;

  const sheet = ensureSheet_(
    ss,
    sheetName,
    headers
  );

  if (sheet.getLastRow() < 2) {
    return [];
  }

  const values =
    sheet.getDataRange().getValues();

  const sheetHeaders =
    values.shift().map(String);

  return values
    .filter(row =>
      row.some(value =>
        value !== '' &&
        value !== null
      )
    )
    .map(row =>
      Object.fromEntries(
        sheetHeaders.map(
          (header, index) => [
            header,
            row[index] instanceof Date
              ? row[index].toISOString()
              : row[index]
          ]
        )
      )
    );
}

function replaceData_(sheet, headers, rows) {
  const actualHeaders = sheet
    .getRange(
      1,
      1,
      1,
      sheet.getLastColumn()
    )
    .getValues()[0]
    .map(String);

  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        sheet.getLastColumn()
      )
      .clearContent();
  }

  if (rows.length) {
    sheet
      .getRange(
        2,
        1,
        rows.length,
        actualHeaders.length
      )
      .setValues(
        rows.map(row =>
          actualHeaders.map(
            header =>
              row[header] ?? ''
          )
        )
      );
  }
}

function appendObject_(sheet, headers, object) {
  const actualHeaders = sheet
    .getRange(
      1,
      1,
      1,
      sheet.getLastColumn()
    )
    .getValues()[0]
    .map(String);

  sheet.appendRow(
    actualHeaders.map(
      header =>
        object[header] ?? ''
    )
  );
}

function audit_(action, recordId, detail, operator) {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const auditSheet = ensureSheet_(
    ss,
    SETTINGS.AUDIT_SHEET,
    AUDIT_HEADERS
  );

  appendObject_(
    auditSheet,
    AUDIT_HEADERS,
    {
      timestamp:
        new Date().toISOString(),
      action: action,
      recordId: recordId,
      detail: String(
        detail || ''
      ).slice(0, 500),
      operator:
        operator || 'SYSTEM'
    }
  );
}

function errorResponse_(error) {
  return json_({
    ok: false,
    message: error.message,
    code:
      error.code ||
      'SERVER_ERROR'
  });
}

function json_(data) {
  return ContentService
    .createTextOutput(
      JSON.stringify(data)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}

// สำรองการอ่านชีตเดิมไว้ตรวจสอบย้อนหลัง
function legacyDoGet_() {
  const ss = SpreadsheetApp.openById(
    SETTINGS.SPREADSHEET_ID
  );

  const sheet = ss.getSheetByName(
    SETTINGS.LEGACY_SHEET
  );

  if (!sheet) {
    throw new Error('ไม่พบชีตเดิม');
  }

  const values =
    sheet.getDataRange().getValues();

  const headers =
    values.shift().map(String);

  const rows = values.map(
    row =>
      Object.fromEntries(
        headers.map(
          (header, index) => {
            let value = row[index];

            if (
              header ===
              '司机电话 เบอร์โทรพนักงานขับรถ'
            ) {
              value = phone_(value);
            }

            if (value instanceof Date) {
              value =
                Utilities.formatDate(
                  value,
                  'Asia/Bangkok',
                  "yyyy-MM-dd'T'HH:mm:ss"
                );
            }

            return [
              header,
              value
            ];
          }
        )
      )
  );

  return json_(rows);
}

// รองรับ Trigger เดิม
function updateColumnCWithNow() {
  const sheet = SpreadsheetApp
    .openById(
      SETTINGS.SPREADSHEET_ID
    )
    .getSheetByName(
      SETTINGS.LEGACY_SHEET
    );

  if (!sheet) {
    return;
  }

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const now = new Date();

  const values = Array.from(
    {
      length: lastRow - 1
    },
    () => [now]
  );

  sheet
    .getRange(
      2,
      3,
      lastRow - 1,
      1
    )
    .setValues(values);
}
