# Self-Heal V2 DEV validation trigger

This marker intentionally contains no runtime logic. It triggers the DEV-only deployment pipeline after bot-authored DEV patch commits, because GitHub Actions does not cascade workflow runs from pushes made with `GITHUB_TOKEN`.

Current validation target: sanitized `msRepairHealthDev` diagnostic for direct Durable Object repair-state inspection.

Scope: DEV only. Production is not deployed by this pipeline.
