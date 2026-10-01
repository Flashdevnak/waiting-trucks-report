import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../ms.js", import.meta.url), "utf8");
const transport = source.slice(
  source.indexOf("function realtimeTransportKey() {"),
  source.indexOf("function loadAuth() {"),
);

function harness() {
  const sockets = [];
  const acceptedRows = [{ marker: "accepted" }];
  let directLoads = 0;
  let freshRenders = 0;
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
      this.messages = [];
      sockets.push(this);
    }
    send(message) { this.messages.push(JSON.parse(message)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    snapshot() { this.onmessage?.({ data: JSON.stringify({ type: "snapshot", rows: acceptedRows }) }); }
  }
  const state = {
    auth: { username: "operator", expiresAt: 999999, token: "fixture" },
    branch: "NE1", currentRows: acceptedRows, transportLastOkAt: 900,
  };
  const document = { hidden: false };
  const lastRefresh = { textContent: "accepted at 900" };
  const context = {
    state, document, URL, JSON, Date: { now: () => 1000 }, WebSocket: Socket,
    CONFIG: { apiUrl: "https://example.test/api", pollMs: 4000 },
    REALTIME_WS_RETRY_MS: 3000, REALTIME_FOLLOWER_TAKEOVER_MS: 5000,
    REALTIME_AUTH_HEARTBEAT_MS: 60000,
    realtimeSocket: null, realtimeSocketKey: "", realtimeConnectStartedAt: 0,
    realtimeRetryAt: 0, realtimeIsLeader: null, realtimeLastSnapshotAt: 0,
    realtimeFollowerNoSnapshotAt: 0, realtimeLastAuthSentAt: 0,
    realtimeFollowerWatchdog: null,
    realtimeWasHidden: false, realtimeForegroundRefreshPending: false,
    clearTimeout() {}, setTimeout() { return 1; },
    el: (id) => id === "last-refresh" ? lastRefresh : null,
    renderFreshness() { freshRenders++; },
    restoreFastRefreshSnapshot() { throw new Error("accepted rows must remain"); },
    applyAcceptedLiveResult() { state.transportLastOkAt = 1000; return true; },
    saveFastRefreshSnapshot() {},
    loadData() { directLoads++; return Promise.resolve(); },
    invalidateSession() { throw new Error("unexpected authentication failure"); },
  };
  runInNewContext(transport + `
    globalThis.realtime = {
      visibility: handleRealtimeVisibility, message: handleRealtimeMessage,
      tick: realtimeTick, ensure: ensureRealtimeTransport,
      pending: () => realtimeForegroundRefreshPending,
    };`, context);
  const hide = () => { document.hidden = true; context.realtime.visibility(); };
  const show = () => { document.hidden = false; context.realtime.visibility(); };
  return { context, sockets, state, acceptedRows, document, lastRefresh, hide, show,
    directLoads: () => directLoads, freshRenders: () => freshRenders };
}

test("foreground resume sends one immediate shared refresh without clearing accepted rows or freshness", () => {
  const h = harness();
  h.hide();
  h.show();
  assert.strictEqual(h.state.currentRows, h.acceptedRows);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0].readyState, 0);
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].messages.map((message) => message.type), ["refresh"]);
  assert.equal(h.state.transportLastOkAt, 900);
  assert.equal(h.lastRefresh.textContent, "accepted at 900");
  assert.equal(h.directLoads(), 0);
  assert.strictEqual(h.state.currentRows, h.acceptedRows);
  h.sockets[0].onopen();
  h.show();
  assert.equal(h.sockets[0].messages.length, 1);
  h.sockets[0].snapshot();
  assert.equal(h.state.transportLastOkAt, 1000);
  assert.equal(h.context.realtime.pending(), false);
});

test("connecting resume coalesces duplicate visible events and snapshot cancels pending refresh", () => {
  const h = harness();
  h.hide(); h.show(); h.show();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.context.realtime.pending(), true);
  h.context.realtime.message(JSON.stringify({ type: "snapshot", rows: h.acceptedRows }));
  assert.equal(h.context.realtime.pending(), false);
  h.sockets[0].open();
  assert.equal(h.sockets[0].messages.length, 0);
  h.hide();
  assert.equal(h.sockets[0].messages.length, 0, "hidden tab sends nothing");
  h.show(); h.sockets[1].open();
  assert.deepEqual(h.sockets[1].messages.map((message) => message.type), ["refresh"]);
  assert.equal(h.directLoads(), 0);
});

test("a genuinely resumed page with an already-open shared socket sends immediately once", () => {
  const h = harness();
  h.context.realtime.ensure();
  h.sockets[0].open();
  h.context.realtimeWasHidden = true;
  h.show();
  assert.equal(h.sockets.length, 1, "open transport is reused");
  assert.deepEqual(h.sockets[0].messages.map((message) => message.type), ["refresh"]);
  h.show();
  assert.equal(h.sockets[0].messages.length, 1);
  assert.equal(h.state.transportLastOkAt, 900);
  assert.equal(h.directLoads(), 0);
});

test("foreground path adds no direct HTTP load, new polling timer, or history access", () => {
  const block = source.slice(source.indexOf("function handleRealtimeVisibility() {"), source.indexOf("function handleRealtimeMessage(raw) {"));
  assert.doesNotMatch(block, /loadData\(|apiGet\(|fetch\(|setInterval\(|setTimeout\(|history/i);
});
