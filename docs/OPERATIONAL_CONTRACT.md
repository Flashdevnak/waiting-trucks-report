# Operational contract routing

Use [MS Operational Contract V1 at the verified DEV source](https://github.com/Flashdevnak/waiting-trucks-report/blob/afbe6e0e57b5d0a752303e39846538a439dda27d/docs/MS_OPERATIONAL_CONTRACT_V1.md). Recheck the actual source for changes when a task starts. The following navigation aid does not modify any rule.

- §§1–3, 8: Destination/Drop active queue and earliest valid KIT/TBR arrival; KIT wins an exact tie. Business day derives from observed arrival evidence. Review onset, source freshness and exact trip provenance before accepting evidence.
- §§9–12: Route state 2 completes unloading; Schedule E is timing/display evidence. Drop release requires actual departure. Exactly 12 hours expires eligible active states without fabricating completion or departure.
- §§5–7, 13, 15, 18: shared/provider reads, coordination and quotas; UI ~4 s, Route ~3 s, healthy BusTime ~12 s. History uses immutable as-of evidence boundaries. PNO/HBI remain on-demand under the source contract; consult source for passive instrumentation and PNO lifecycle.
- §16 and [DEV config](../worker/wrangler.dev.jsonc): exact staged Turso runtime, D1 bindings 0, DEV and Production remain separate.
- [Feature evidence](EVIDENCE_INDEX.md): QR and Excel 365 contracts and PNO regression evidence are referenced via the historical DEV handoff. This documentation task does not modify source, builder, release workflow or browser code.
