# MS Connection Layout V2 DEV validation trigger

This marker contains no runtime logic. It triggers the DEV-only deployment pipeline after the tested three-layer MS connection modal layout update.

Validation target: full-viewport dialog owns vertical scrolling, connector-dialog-stage centers the white connection card, the card is not a scroll owner, HTTP 401 helper text remains truth-safe, HUB selector/realtime/quota contracts remain unchanged.

Source target: cff9bfdad3d89210b84545d824570eb2a15f6164.

Scope: DEV only. Production is not deployed by this pipeline.
