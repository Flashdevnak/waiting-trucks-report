# Self-Heal V5 DEV validation trigger

This marker contains no runtime logic. It triggers the DEV-only deployment pipeline after the tested 401 helper and Connection Intelligence updates.

Validation target: keep truth-safe HTTP 401/403 classification, expose the repair state's `changedAt` in the sanitized DEV repair status, and let the MS connection dialog show a small bottom-right 401 explanation with the detection time. The helper text says `กรุณาเชื่อมต่อ MS ใหม่` and intentionally does not mention QR.

Scope: DEV only. Production is not deployed by this pipeline.
