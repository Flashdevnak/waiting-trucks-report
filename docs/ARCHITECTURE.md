# WTR architecture

The static frontend draws queue and Supervisor views from shared runtime projections. DEV composes the Turso Worker and browser assets using the exact runtime builder and ordered staging helpers. The Cloudflare Browser Connector acquires upstream evidence; per-HUB coordination, caches and shared flights protect source quotas. Turso backs DEV. Route/KIT, BusTime/TBR, PreEntry, HBI and PNO each have distinct evidence responsibilities.

| Surface | Authoritative reference |
|---|---|
| Source and ordered staging | [Pinned DEV source](https://github.com/Flashdevnak/waiting-trucks-report/tree/afbe6e0e57b5d0a752303e39846538a439dda27d) · [Exact builder](../.github/dev-tools/build-exact-dev-runtime.mjs) · [stage-dev-runtime](../.github/dev-tools/stage-dev-runtime.mjs) |
| Runtime config and publisher | [DEV config](../worker/wrangler.dev.jsonc) · [Deploy Workflow](../.github/workflows/deploy-worker-dev.yml) · [Sealed Publisher](../.github/dev-tools/wtr011p-sealed-publisher.mjs) |
| Source truth and lifecycle | [Operational contract](OPERATIONAL_CONTRACT.md) · [Pinned architecture map](https://github.com/Flashdevnak/waiting-trucks-report/blob/52f2859d5688ba35583ef9e5d56117b7745dff9f/docs/project-brain/system/SYSTEM_MAP_TH.md) |
| Continuity | [Task system](TASK_SYSTEM.md) · [New AI handoff](NEW_AI_HANDOFF.md) |
