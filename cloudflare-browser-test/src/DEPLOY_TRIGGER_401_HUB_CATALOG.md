# Browser DEV validation trigger

Triggers the Browser TEST Worker deployment after commit 3409ea0f6b771587fc1c4b357049cce98e2a4107.

Validation target: Error Intelligence and TBR Intelligence use the same Browser-known HUB catalog on every HUB, including NE1. Catalog discovery remains read-only, cached for 10 minutes, and adds zero Turso reads/writes and zero MS upstream polling.

Scope: Browser TEST only. No Production cutover.
