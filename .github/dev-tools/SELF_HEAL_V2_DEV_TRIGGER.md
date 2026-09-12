# Self-Heal V3 DEV validation trigger

This marker intentionally contains no runtime logic. It triggers the DEV-only deployment pipeline after bot-authored DEV patch commits, because GitHub Actions does not cascade workflow runs from pushes made with `GITHUB_TOKEN`.

Current validation target: confirmed-session classifier policy v3. A single `MS_SESSION_EXPIRED` signal must not immediately force `needs_login`; the same auth-expiry signal must be confirmed on a later retry. Existing policy-v2 repair state is ignored in-memory so a false-positive EA2 lock can recover with the current stored credentials.

Scope: DEV only. Production is not deployed by this pipeline.
