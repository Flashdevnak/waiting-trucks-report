# Self-Heal V4 DEV validation trigger

This marker contains no runtime logic. It triggers the DEV-only deployment pipeline after the tested bot-authored classifier commit.

Validation target: policy v4 requires authoritative HTTP 401/403 before classifying Route as `MS_SESSION_EXPIRED`. Application-level MS text/code alone is treated as a retry-safe source error, so it cannot falsely lock a HUB into `needs_login`. The v4 policy also ignores persisted v3 repair state in memory so false EA2 state from the previous classifier can recover through the normal shared cron without a forced repair call.

Scope: DEV only. Production is not deployed by this pipeline.
