# MS Connection 401 Toast V2 DEV validation trigger

This marker contains no runtime logic. It triggers the DEV-only deployment pipeline after the tested MS connection 401 toast update.

Validation target: keep each source card concise, remove the modal-level 401 guidance box, reuse the existing bottom-right page toast used by upload/login feedback, preserve the detected time and affected source names, keep normal toast duration unchanged, show 401 guidance for 10 seconds, and preserve all realtime/quota/session contracts.

Source target: 738624e4dbb07ea6a53993782db60a89756835a5.

Scope: DEV only. Production is not deployed by this pipeline.
