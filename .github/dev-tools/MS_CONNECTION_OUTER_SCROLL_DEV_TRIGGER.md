# MS Connection Outer Scroll — DEV trigger

Deploy current main containing style commit `caf59e368bb8a203b4c5976a4ade91edc7c1869e` to DEV only.

Validation target:
- MS connection dialog scroll owner is the full viewport shell.
- Vertical scrollbar renders at the far-right viewport edge, outside the centered white connection card.
- No nested/inner card scrollbar.
- No session, HAR, connector, realtime, database, or upstream logic change.
- Production must not be deployed or modified.
