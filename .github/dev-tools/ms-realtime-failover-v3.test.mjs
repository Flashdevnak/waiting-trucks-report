import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { patchDevDurableCoordinator } from "./patch-ms-durable-coordinator.mjs";

const root = new URL("../../", import.meta.url);
const front = await readFile(new URL("ms.js", root), "utf8");
const worker = patchDevDurableCoordinator(await readFile(new URL("worker/src/index.js", root), "utf8"));

test("one-shot follower watchdog recovers at 5 seconds, resets on healthy snapshots, and stays on WebSocket", () => {
  assert.match(front, /const REALTIME_FOLLOWER_TAKEOVER_MS = CONFIG\.pollMs \+ 1000/);
  assert.match(front, /setInterval\(realtimeTick, CONFIG\.pollMs\)/);
  assert.doesNotMatch(front, /setInterval\(\(\) => state\.auth && loadData\(true\), CONFIG\.pollMs\)/);
  const start = front.indexOf("function handleRealtimeMessage(raw) {");
  const end = front.indexOf("function loadAuth() {", start);
  assert.ok(start >= 0 && end > start);
  let now = 1_000;
  let nextId = 0;
  const timers = new Map();
  const sent = [];
  let httpFallbacks = 0;
  const socket = { readyState: 1, send: (value) => sent.push(JSON.parse(value)) };
  const context = {
    Date: { now: () => now }, JSON, Math,
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    state: { auth: { token: "test" } }, document: { hidden: false },
    realtimeSocket: socket, realtimeIsLeader: false, realtimeLastSnapshotAt: 0,
    realtimeLastAuthSentAt: now, realtimeFollowerWatchdog: null,
    realtimeConnectStartedAt: 0, REALTIME_AUTH_HEARTBEAT_MS: 60_000,
    REALTIME_FOLLOWER_TAKEOVER_MS: 5_000,
    ensureRealtimeTransport: () => true,
    applyAcceptedLiveResult: () => true, saveFastRefreshSnapshot() {},
    loadData: async () => { httpFallbacks += 1; },
  };
  vm.createContext(context);
  vm.runInContext(front.slice(start, end) + "\nglobalThis.testRealtime = { handleRealtimeMessage, realtimeTick };", context);
  context.testRealtime.handleRealtimeMessage(JSON.stringify({ type: "role", leader: false }));
  context.testRealtime.handleRealtimeMessage(JSON.stringify({ type: "snapshot", rows: [] }));
  assert.equal(timers.size, 1);
  now += 4_000;
  context.testRealtime.realtimeTick();
  assert.equal(sent.length, 0, "healthy follower stays passive after one visible cycle");
  context.testRealtime.handleRealtimeMessage(JSON.stringify({ type: "snapshot", rows: [] }));
  assert.equal(timers.size, 1, "healthy snapshot replaces the old deadline");
  now += 5_001;
  const due = [...timers].filter(([, timer]) => timer.at <= now);
  for (const [id, timer] of due) { timers.delete(id); timer.fn(); }
  assert.deepEqual(sent.map((item) => item.type), ["refresh"]);
  assert.equal(httpFallbacks, 0);
  context.testRealtime.handleRealtimeMessage(JSON.stringify({ type: "role", leader: true }));
  assert.equal(timers.size, 0, "promotion clears stale follower watchdog");
});

test("open stream sends an immediate shared snapshot and leader promotion reuses it without upstream read", async () => {
  const start = worker.indexOf("export class MsRefreshCoordinator {");
  const end = worker.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start);
  let reads = 0;
  const sockets = [];
  const pending = [];
  class Socket {
    messages = [];
    send(message) { this.messages.push(JSON.parse(message)); }
    serializeAttachment(value) { this.attachment = value; }
    deserializeAttachment() { return this.attachment; }
    close() { const index = sockets.indexOf(this); if (index >= 0) sockets.splice(index, 1); }
  }
  const context = {
    Response: class { constructor(body, options) { this.status = options.status; this.webSocket = options.webSocket; } },
    WebSocketPair: class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } },
    OriginManifestCoordinator: class {},
    runMsRefresh: async () => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 2)); return { rows: [{ proofId: "TEST" }], status: "synced", syncedAt: "2026-09-28T16:00:00Z" }; },
    readSettings: async () => ({ msVehicleLimits: {} }),
    MS_SYNC_TTL: 3_000, MS_CRON_ACTIVE_SKIP_MS: 45_000,
    verify: async () => ({ branches: ["NE1"] }), access: () => true,
    Date, JSON, String, Number,
  };
  vm.createContext(context);
  vm.runInContext(worker.slice(start, end).replace("export class", "class") + "\nglobalThis.Coordinator = MsRefreshCoordinator;", context);
  const ctx = {
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets,
    waitUntil: (promise) => pending.push(promise),
  };
  const coordinator = new context.Coordinator(ctx, {});
  const request = { headers: { get: () => "websocket" } };
  await coordinator.openStream(request, "NE1");
  await Promise.all(pending.splice(0));
  assert.deepEqual(sockets[0].messages.map((item) => item.type), ["role", "snapshot"]);
  await coordinator.openStream(request, "NE1");
  await Promise.all(pending.splice(0));
  assert.equal(reads, 1, "new follower joins the accepted shared snapshot");
  assert.equal(sockets[1].messages[0].leader, false);

  coordinator.recentUntil = 0;
  await Promise.all([0, 1].map(() => coordinator.webSocketMessage(sockets[1], JSON.stringify({ type: "refresh", token: "test" }))));
  assert.equal(reads, 2, "simultaneous stale followers share one source refresh");
  const leader = sockets[0];
  const follower = sockets[1];
  const beforePromotion = reads;
  coordinator.webSocketClose(leader, 1000, "closed");
  assert.deepEqual(follower.messages.slice(-2).map((item) => item.type), ["role", "snapshot"]);
  assert.equal(follower.messages.at(-2).leader, true);
  assert.equal(reads, beforePromotion, "promotion does not read upstream or settings");
});
