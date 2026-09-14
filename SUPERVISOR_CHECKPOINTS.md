# Waiting Trucks Supervisor checkpoints

Scope: DEV only. Production is outside the authority of every Supervisor component.

## SUP-00 — Architecture audit

Status: PASS  
Base remote main: `b85390f7e6ba551b95ad233f312b4af8de171361`  
Audit date: 2026-09-14

### 1. Current architecture

- The canonical Worker is `worker/src/index.js`. It owns the JSON API, role checks, Waiting Trucks business truth, Route/KIT/TBR/FBI/HBI connection metadata, accepted-route persistence, and Turso reads/writes.
- DEV runs through `worker/src/turso-index.js` with `worker/wrangler.dev.jsonc`. `databaseEnv()` installs the Turso D1-compatible adapter and runtime counters. DEV has no D1 binding.
- The deployed DEV Worker is not the canonical source verbatim. `.github/dev-tools/stage-dev-runtime.mjs` applies an ordered, tested DEV-only patch chain to a copy in `.dev-runtime`. The chain adds the per-HUB `MsRefreshCoordinator`, WebSocket realtime, source cadence guards, recovery state, quota-safe accepted-cache handling, and other verified DEV contracts.
- `MsRefreshCoordinator` is a hibernatable Durable Object keyed by HUB. It coalesces concurrent refreshes and broadcasts one accepted snapshot to all connected clients for that HUB.
- `ms.js` keeps the visible UI cadence at 4 seconds. One WebSocket leader requests shared evaluation; followers receive the same broadcast. The staged Route source minimum cadence is 12 seconds. The one-minute cron keeps configured HUBs active and skips a recent source refresh inside its active window.
- Accepted current state is held in the existing live cache and route tables. Business changes, not every evaluation, drive route/history writes. HBI photos remain click-only. Origin Manifest has its own shared five-minute cache and is not queue truth.
- Authentication uses a signed, stateless 180-day token plus an authoritative user/role/active lookup. Identical authorization reads are cached and coalesced for 60 seconds. Admin APIs call `mustAdmin(actor)`.
- Existing `adminOverview` is a manual, read-only, admin-only database overview. It explicitly does not call upstream sources, refresh accepted snapshots, or start a timer. Existing Turso usage counters are in-memory per Worker isolate and are not provider-account billing truth.
- Important audit events are persisted in `audit_log`; there is no current incident/alert schema. Repair state is stored in the existing per-HUB Durable Object only on material state changes.
- The DEV deploy workflow stages assets/runtime, runs contract tests, rejects D1 bindings, verifies required DEV secrets, deploys only `waiting-trucks-report-api-dev`, and runs bounded smoke checks.

### 2. Exact Supervisor integration point

The UI is a separate asset at `/supervisor.html` with separate JS/CSS. It must never be imported by `ms.html` or `ms.js` and must not sit in the Queue/lifecycle call path.

The future data integration point is a sanitized, admin-only Supervisor snapshot adapter on the Worker side. That adapter will compose only already-held state:

1. configured/discovered HUB and source metadata already used by `adminOverview`;
2. accepted-cache metadata already persisted by the shared refresh path;
3. in-memory Turso diagnostics already incremented by real requests;
4. per-HUB coordinator diagnostics that explicitly guarantee zero upstream and zero Turso work for inspection;
5. state-change events emitted by existing operations.

It must not call `refreshMsIfStale`, `runMsRefresh`, Route, KIT/TBR, FBI, HBI, PreEntry, Origin Manifest, or provider billing APIs merely to render the Supervisor.

### 3. Exact zero-extra-upstream strategy

- SUP-01 loads static assets only and performs zero API/upstream/database work.
- Later initial data is one shared sanitized snapshot, followed by shared event fan-out; no 4-second Supervisor HTTP timer is allowed.
- Existing source work instruments counters at the point where work already occurs. Supervisor rendering never generates source work for measurement.
- Provider quota/billing data, if capability and credentials exist, uses one server-shared TTL of at least 15 minutes plus a rate-limited manual refresh. Missing provider truth remains `UNKNOWN`.
- Terminal lines are bounded ephemeral events. Only material state transitions and privileged actions become persistent audit/incident records.

### 4. Small stable module contract proposal

```js
{
  id, name,
  health: { state, observedAt, evidence, impact },
  metrics: [],
  incidents: [],
  capabilities: {
    quota: false,
    repair: false,
    guide: false,
    audit: false,
    actions: false,
    diagnostics: false,
    dependencies: false
  }
}
```

Capabilities are explicit. Core renders only registered data and never guesses quota, repair, or dependencies. Registration is internal static code: no marketplace, remote code, arbitrary loading, or speculative future module.

### 5. Files/modules to add or change

- Add `supervisor.html`, `supervisor.css`, and `supervisor.js` as isolated assets.
- Add focused Supervisor tests under `worker/tests/`.
- Update only the DEV asset staging and DEV smoke contract to ship/verify these assets.
- Later checkpoints may add a small Supervisor adapter/registry and DEV-only authenticated routes after their contracts are tested.

### 6. Files that should remain untouched

- `ms.html`, `ms.js`, `sync-policy.js`, Queue/lifecycle truth helpers, and existing source adapters unless a later checkpoint proves a minimal integration is required.
- `worker/wrangler.example.jsonc`, production routes/config/secrets, and production workflows.
- Existing migrations during SUP-00/SUP-01. No new incident/quota tables are justified yet.
- Existing PASS staging patches must remain ordered and intact.

### 7. Quota impact

- SUP-00: zero runtime impact.
- SUP-01: static asset requests only; additional upstream calls `0`, database reads `0`, database writes `0`, AI monitoring calls `0`, timers `0`, WebSockets `0`.
- A later snapshot endpoint must have explicit shared caching/coalescing and contract tests before it is connected to the UI.

### 8. Database impact

None for SUP-00/SUP-01. No schema or migration changes.

### 9. Main website impact

None. The main page does not import, invoke, or depend on Supervisor assets. A Supervisor asset/API failure cannot enter the main realtime, source, cache, or lifecycle path.

### 10. Risks and blockers

- `/supervisor.html` is a static asset. The current login token lives in `localStorage`, which is not available to the Worker during HTML navigation. A frontend role check alone is not the required two-layer authorization. SUP-02 must add a bounded secure bootstrap/session exchange or an equivalent source-truth mechanism so unauthorized HTML requests are rejected and all data/actions remain backend-admin-only.
- DEV runtime is staging-generated. New backend integration must be tested against both canonical and staged outputs so a later deploy cannot silently drop or duplicate it.
- In-memory quota counters are per isolate and do not equal Cloudflare/Turso account billing. UI must label these as runtime observations and show provider limits as `UNKNOWN` when unavailable.
- `adminOverview` currently performs database reads per manual load. It is useful evidence, but it is not yet the final multi-client shared Supervisor snapshot transport.
- The repository does not contain a trustworthy active Cloudflare version identifier in a public endpoint. Deployment/version claims must come from the DEV workflow/provider response, never be inferred from timestamps.

### 11. Updated forward-only checkpoint plan

1. SUP-01 Core shell: isolated static assets, responsive operations layout, truth-safe empty/unknown states, no transport.
2. SUP-02 Access guard: frontend role gate plus backend-enforced HTML/API authorization and CSRF-safe mutation foundation.
3. SUP-03 Module contract/registry: one real Waiting Trucks adapter only.
4. SUP-04 Shared sanitized snapshot and event fan-out with zero-extra-upstream regression proof.
5. SUP-05–SUP-09: Overview, HUB/source/queue diagnostics, terminal, incident/action/audit state transitions.
6. SUP-10–SUP-12: piggyback quota instrumentation, shared quota center, leak/circuit/backoff/kill-switch contracts.
7. SUP-13–SUP-17: Thai/English, guide, redacted prompts, context/evidence, dependency diagnostics.
8. SUP-18 Shadow Repair. No execution.
9. SUP-19 Known Safe Repair only after architecture-specific allowlisting, regression tests, quota guard, and post-check.
10. SUP-20 DEV Code Repair workflow with one active job, branch isolation, targeted tests first, and no arbitrary shell.
11. SUP-21 before/after guard.
12. SUP-22 full DEV acceptance, including Supervisor-down/main-site-up and Production touched `NO`.

### Regression proof defined by SUP-00

Every Supervisor checkpoint must prove:

- main Waiting Trucks assets do not import Supervisor assets;
- Supervisor frontend has no direct source URLs and no 4-second HTTP polling;
- static/core operation has no database or upstream calls;
- backend data/actions are admin-gated when introduced;
- missing data renders `UNKNOWN`, `UNAVAILABLE`, `PARTIAL`, or `BLOCKED` rather than fabricated health;
- DEV config remains Turso-only with zero D1 bindings;
- production config/workflows remain unchanged;
- staged runtime contract tests and existing lifecycle/realtime/quota suites remain green.

## SUP-02 — Admin access guard

Status: PASS (local source and regression); DEV deployment pending branch delivery

Base remote main: `b85390f7e6ba551b95ad233f312b4af8de171361`

Branch: `codex/sup-00-supervisor`

Checkpoint date: 2026-09-14

### Implemented

- The DEV staging chain now installs an isolated Worker guard before the static asset binding. A direct unauthorized request to `/supervisor.html` returns `403` and never reads the asset.
- The existing Admin page performs a manual same-origin session exchange using its current signed login token. The Worker reuses the authoritative active-user/Admin role verification before issuing a bounded 30-minute Supervisor session.
- The session is held in an `HttpOnly`, `Secure`, `SameSite=Strict`, path-scoped signed cookie. Only the CSRF value is kept in `sessionStorage`; no credential or session token is exposed by the Supervisor shell.
- Every `/api/supervisor/*` route is backend-authorized. Future mutations additionally require `X-Supervisor-CSRF`; Operator, cross-origin, missing-session, expired-session, and missing-CSRF paths fail closed with `403`.
- Authorized Supervisor HTML is returned with `no-store`, CSP, `nosniff`, and frame denial headers. Static JS/CSS remain non-sensitive core assets; the protected HTML and all future data/action routes remain Admin-only.
- DEV smoke now expects unauthenticated Supervisor HTML to be rejected. It verifies the denial response instead of attempting to treat the protected page as public.

### Test results

- `node --test .github/dev-tools/supervisor-access-guard.test.mjs`: PASS, 5/5.
- `npm run check`: PASS, 141/141 across Supervisor, lifecycle, realtime, quota, Turso, Admin, HBI, and Proof suites.
- DEV workflow's broader pre-deploy test set: PASS, 137/137 in one combined run.
- Staged Worker syntax: PASS.
- Guard contracts prove unauthorized asset reads `0`, Supervisor database writes `0`, source/upstream calls `0`, background timers `0`, and the main `/ms.html` asset path unchanged.

### Impact and guard result

- Quota contract: PASS. A manual Admin open performs at most the existing authoritative user lookup, benefiting from the existing 60-second auth cache/coalescing. It creates no upstream source calls and no database writes.
- Database impact: one bounded read on a cold Admin session exchange/verification; zero writes and zero healthy-state heartbeat writes.
- Main website impact: none. Waiting Trucks routes do not invoke or depend on the Supervisor guard except for an early pathname comparison; `/ms.html`, realtime, accepted state, and lifecycle behavior are unchanged.
- Production touched: NO.
- Open blocker: the terminal environment has no GitHub push credential, so the committed branch cannot yet reach the DEV workflow. No deploy was attempted and no success was fabricated.
- Next exact action: deliver the SUP-02 branch through an authenticated GitHub path, run the DEV workflow, verify unauthorized `403`, open from an authenticated Admin page, and then start SUP-03 from the resulting latest remote main.
