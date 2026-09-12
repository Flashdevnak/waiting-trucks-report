# Self-Heal V5 DEV validation trigger

This marker contains no runtime logic. It triggers the DEV-only deployment pipeline after the tested truth-safe Route auth classifier commit.

Validation target: policy v5 distinguishes an upstream HTTP 401 (`MS_SESSION_HTTP_401`) from HTTP 403 (`MS_ROUTE_FORBIDDEN`). Only a confirmed 401 is eligible for `needs_login`; a 403 remains a retry-safe source/permission failure and must never be labeled as an expired session. Persisted v4 repair state is ignored in memory so EA2 is re-evaluated by the shared normal cron without a forced repair call.

Scope: DEV only. Production is not deployed by this pipeline.
