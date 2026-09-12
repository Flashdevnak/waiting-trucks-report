# Browser DEV validation trigger

Triggers the Browser TEST Worker deployment after the tested Connection Intelligence HUB selector V4 change and V3 compatibility marker.

Validation target: NE1 and every other Connection Intelligence page use the same Browser-known HUB catalog. Selector discovery remains read-only, cached, and adds zero Turso reads/writes and zero MS upstream polling.

Scope: Browser TEST only. No Production cutover.
