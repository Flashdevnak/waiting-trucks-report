const DEFAULT_BACKEND = "d1";

export function databaseEnv(env) {
  const backend = String(env?.DB_BACKEND || DEFAULT_BACKEND).trim().toLowerCase();
  if (backend !== "turso") return env;

  const db = new TursoD1Database({
    url: env?.TURSO_DATABASE_URL,
    authToken: env?.TURSO_AUTH_TOKEN,
    fetchImpl: fetch,
  });

  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "DB") return db;
      return Reflect.get(target, property, receiver);
    },
  });
}

export class TursoD1Database {
  constructor({ url, authToken, fetchImpl = fetch } = {}) {
    this.url = normalizeDatabaseUrl(url);
    this.authToken = String(authToken || "").trim();
    this.fetchImpl = fetchImpl;
  }

  prepare(sql) {
    return new TursoD1PreparedStatement(this, String(sql || ""), []);
  }

  async batch(statements) {
    const items = Array.from(statements || []);
    if (!items.length) return [];
    for (const item of items) {
      if (!(item instanceof TursoD1PreparedStatement) || item.database !== this) {
        throw tursoError("TURSO_BATCH_INVALID", "Turso batch accepts prepared statements from the same database only");
      }
    }

    const first = await this._pipeline([
      executeRequest("BEGIN IMMEDIATE"),
      ...items.map((item) => item._request()),
    ]);

    const beginResult = first.results?.[0];
    const statementResults = (first.results || []).slice(1);
    const firstError = [beginResult, ...statementResults].find((result) => result?.type === "error");

    if (firstError) {
      await this._finishTransaction(first, "ROLLBACK").catch(() => {});
      throw resultError(firstError, "TURSO_BATCH_ERROR");
    }

    try {
      await this._finishTransaction(first, "COMMIT");
    } catch (error) {
      throw wrapError(error, "TURSO_COMMIT_ERROR");
    }

    return statementResults.map((result) => d1Result(executeResult(result)));
  }

  async _execute(sql, args = []) {
    const payload = await this._pipeline([
      executeRequest(sql, args),
      { type: "close" },
    ]);
    return executeResult(payload.results?.[0]);
  }

  async _finishTransaction(openPipeline, command) {
    const baseUrl = openPipeline.base_url || this.url;
    const baton = openPipeline.baton || undefined;
    const payload = await this._pipeline(
      [executeRequest(command), { type: "close" }],
      { baseUrl, baton },
    );
    const result = payload.results?.[0];
    if (result?.type === "error") throw resultError(result, `TURSO_${command}_ERROR`);
    return payload;
  }

  async _pipeline(requests, { baseUrl = this.url, baton } = {}) {
    this._assertConfigured();
    const endpoint = `${normalizeDatabaseUrl(baseUrl)}/v2/pipeline`;
    const body = { requests };
    if (baton) body.baton = baton;

    let response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw wrapError(error, "TURSO_NETWORK_ERROR");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw tursoError(
        "TURSO_PROTOCOL_ERROR",
        `Turso returned an unreadable response (${response.status || "unknown"})`,
        error,
      );
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `Turso HTTP ${response.status}`;
      throw tursoError("TURSO_HTTP_ERROR", message);
    }

    if (!Array.isArray(payload?.results)) {
      throw tursoError("TURSO_PROTOCOL_ERROR", "Turso response is missing pipeline results");
    }
    return payload;
  }

  _assertConfigured() {
    if (!this.url || !this.authToken) {
      throw tursoError(
        "TURSO_CONFIG_MISSING",
        "Turso is selected but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing",
      );
    }
  }
}

export class TursoD1PreparedStatement {
  constructor(database, sql, args) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new TursoD1PreparedStatement(this.database, this.sql, args);
  }

  async all() {
    return d1Result(await this.database._execute(this.sql, this.args));
  }

  async first(column) {
    const result = await this.database._execute(this.sql, this.args);
    const rows = rowsFromResult(result);
    const row = rows[0] || null;
    if (row === null || column === undefined) return row;
    return row[column] ?? null;
  }

  async run() {
    const result = await this.database._execute(this.sql, this.args);
    return d1Result(result);
  }

  _request() {
    return executeRequest(this.sql, this.args);
  }
}

function normalizeDatabaseUrl(value) {
  let url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("libsql://")) url = `https://${url.slice("libsql://".length)}`;
  return url.replace(/\/+$/, "");
}

function executeRequest(sql, args = []) {
  const stmt = { sql: String(sql || "") };
  if (args.length) stmt.args = args.map(encodeValue);
  return { type: "execute", stmt };
}

function encodeValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "bigint") return { type: "integer", value: String(value) };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw tursoError("TURSO_BIND_INVALID", "Cannot bind a non-finite number");
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value: String(value) };
  }
  if (value instanceof Uint8Array) return { type: "blob", base64: bytesToBase64(value) };
  if (value instanceof ArrayBuffer) return { type: "blob", base64: bytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    return {
      type: "blob",
      base64: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  return { type: "text", value: String(value) };
}

function executeResult(item) {
  if (!item) throw tursoError("TURSO_PROTOCOL_ERROR", "Turso returned an empty pipeline result");
  if (item.type === "error") throw resultError(item, "TURSO_QUERY_ERROR");
  if (item.type !== "ok" || item.response?.type !== "execute") {
    throw tursoError("TURSO_PROTOCOL_ERROR", "Turso returned an unexpected pipeline result");
  }
  return item.response.result || {};
}

function rowsFromResult(result) {
  const columns = (result.cols || []).map((column) =>
    typeof column === "string" ? column : String(column?.name || ""),
  );
  return (result.rows || []).map((row) => {
    if (!Array.isArray(row)) return row || {};
    const object = {};
    for (let i = 0; i < row.length; i += 1) {
      object[columns[i] || String(i)] = decodeValue(row[i]);
    }
    return object;
  });
}

function decodeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || !value.type) return value;
  if (value.type === "null") return null;
  if (value.type === "integer") return Number(value.value);
  if (value.type === "float") return Number(value.value);
  if (value.type === "text") return String(value.value ?? "");
  if (value.type === "blob") return base64ToBytes(value.base64 || "");
  return value.value ?? null;
}

function d1Result(result) {
  return {
    success: true,
    results: rowsFromResult(result),
    meta: {
      changes: Number(result.affected_row_count || 0),
      last_row_id: result.last_insert_rowid == null ? 0 : Number(result.last_insert_rowid),
      rows_read: Number(result.rows_read || 0),
      rows_written: Number(result.rows_written || 0),
      duration: Number(result.query_duration_ms || 0),
    },
  };
}

function resultError(result, fallbackCode) {
  const error = result?.error || result?.response?.error || {};
  return tursoError(error.code || fallbackCode, error.message || "Turso query failed");
}

function wrapError(error, code) {
  if (error?.code && String(error.code).startsWith("TURSO_")) return error;
  return tursoError(code, error?.message || "Turso request failed", error);
}

function tursoError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
