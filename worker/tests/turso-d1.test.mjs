import assert from "node:assert/strict";
import test from "node:test";
import { databaseEnv, TursoD1Database } from "../src/turso-d1.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function okExecute({ cols = [], rows = [], affected = 0, last = null, rowsRead = 0, rowsWritten = 0 } = {}) {
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols,
        rows,
        affected_row_count: affected,
        last_insert_rowid: last,
        rows_read: rowsRead,
        rows_written: rowsWritten,
        query_duration_ms: 1.25,
      },
    },
  };
}

const okClose = { type: "ok", response: { type: "close" } };

test("databaseEnv keeps D1 unless Turso is explicitly selected", () => {
  const env = { DB: { existing: true } };
  assert.equal(databaseEnv(env), env);
});

test("prepared statements map Turso rows and metadata to the D1 shape", async () => {
  const calls = [];
  const db = new TursoD1Database({
    url: "libsql://example-org.turso.io",
    authToken: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      return response({
        baton: null,
        base_url: null,
        results: [
          okExecute({
            cols: [{ name: "id" }, { name: "name" }, { name: "active" }],
            rows: [[
              { type: "integer", value: "7" },
              { type: "text", value: "NE1" },
              { type: "integer", value: "1" },
            ]],
            rowsRead: 1,
          }),
          okClose,
        ],
      });
    },
  });

  const result = await db.prepare("SELECT * FROM users WHERE id=?").bind(7).all();
  assert.deepEqual(result.results, [{ id: 7, name: "NE1", active: 1 }]);
  assert.equal(result.meta.rows_read, 1);
  assert.equal(calls[0].url, "https://example-org.turso.io/v2/pipeline");
  assert.equal(calls[0].auth, "Bearer secret");
  assert.deepEqual(calls[0].body.requests[0].stmt.args, [{ type: "integer", value: "7" }]);
  assert.equal(calls[0].body.requests.at(-1).type, "close");
});

test("first returns a row or a selected column", async () => {
  const makeDb = () => new TursoD1Database({
    url: "https://example.turso.io",
    authToken: "secret",
    fetchImpl: async () => response({
      results: [
        okExecute({ cols: [{ name: "value" }], rows: [[{ type: "text", value: "ok" }]] }),
        okClose,
      ],
    }),
  });

  assert.deepEqual(await makeDb().prepare("SELECT 'ok' AS value").first(), { value: "ok" });
  assert.equal(await makeDb().prepare("SELECT 'ok' AS value").first("value"), "ok");
});

test("run exposes D1-compatible write metadata", async () => {
  const db = new TursoD1Database({
    url: "https://example.turso.io",
    authToken: "secret",
    fetchImpl: async () => response({
      results: [
        okExecute({ affected: 2, last: "91", rowsRead: 1, rowsWritten: 2 }),
        okClose,
      ],
    }),
  });
  const result = await db.prepare("UPDATE x SET y=?").bind("z").run();
  assert.equal(result.meta.changes, 2);
  assert.equal(result.meta.last_row_id, 91);
  assert.equal(result.meta.rows_written, 2);
});

test("batch commits atomically through a shared Turso baton", async () => {
  const calls = [];
  const replies = [
    response({
      baton: "baton-1",
      base_url: "https://primary.turso.io",
      results: [
        okExecute(),
        okExecute({ affected: 1, rowsWritten: 1 }),
        okExecute({ affected: 1, rowsWritten: 1 }),
      ],
    }),
    response({ results: [okExecute(), okClose] }),
  ];
  const db = new TursoD1Database({
    url: "https://example.turso.io",
    authToken: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return replies.shift();
    },
  });

  const results = await db.batch([
    db.prepare("INSERT INTO x VALUES(?)").bind("a"),
    db.prepare("INSERT INTO x VALUES(?)").bind("b"),
  ]);

  assert.equal(results.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.requests[0].stmt.sql, "BEGIN IMMEDIATE");
  assert.equal(calls[1].url, "https://primary.turso.io/v2/pipeline");
  assert.equal(calls[1].body.baton, "baton-1");
  assert.equal(calls[1].body.requests[0].stmt.sql, "COMMIT");
});

test("batch rolls back when any statement fails", async () => {
  const calls = [];
  const replies = [
    response({
      baton: "baton-fail",
      base_url: "https://primary.turso.io",
      results: [
        okExecute(),
        { type: "error", error: { code: "SQLITE_CONSTRAINT", message: "constraint failed" } },
      ],
    }),
    response({ results: [okExecute(), okClose] }),
  ];
  const db = new TursoD1Database({
    url: "https://example.turso.io",
    authToken: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return replies.shift();
    },
  });

  await assert.rejects(
    db.batch([db.prepare("INSERT INTO x VALUES(?)").bind("duplicate")]),
    (error) => error.code === "SQLITE_CONSTRAINT",
  );
  assert.equal(calls[1].body.requests[0].stmt.sql, "ROLLBACK");
  assert.equal(calls[1].body.baton, "baton-fail");
});

test("missing Turso credentials fail closed instead of falling back to D1", async () => {
  const db = new TursoD1Database({ url: "", authToken: "", fetchImpl: async () => { throw new Error("should not fetch"); } });
  await assert.rejects(
    db.prepare("SELECT 1").first(),
    (error) => error.code === "TURSO_CONFIG_MISSING",
  );
});

test("fetch implementation is not rebound to the database instance", async () => {
  let observedThis = "not-called";
  const fetchImpl = async function () {
    observedThis = this;
    return response({ results: [okExecute(), okClose] });
  };
  const db = new TursoD1Database({
    url: "https://example.turso.io",
    authToken: "secret",
    fetchImpl,
  });

  await db.prepare("SELECT 1").all();
  assert.equal(observedThis, undefined);
});
