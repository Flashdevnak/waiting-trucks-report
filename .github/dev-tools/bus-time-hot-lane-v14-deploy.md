# BUS_TIME_HOT_LANE_V14 DEV deployment checkpoint

This file intentionally lives under `.github/dev-tools/**` so the normal `Deploy Worker DEV` workflow runs after the tested hot-lane installer commit.

Contract:
- DEV only; no Production deployment.
- Frontend/Route cadence remains 4 seconds.
- BusTime hot detection remains ~4 seconds without full pagination on every cycle.
- Deep BusTime pagination is incremental and bounded.
- Per-HUB shared reader/cache; client count must not amplify upstream calls.
- HTTP 429 / `Request exceeds the limit` is BusTime degradation, not session expiry.
- Existing source-hash/snapshot/write dedupe remains authoritative.
- Telemetry is memory/log based and adds no per-poll Turso writes.

Runtime marker: `BUS_TIME_HOT_LANE_V14`.
