# Authoritative HUB Catalog V5 DEV trigger

Deploy only to `waiting-trucks-report-api-dev` after tested source commit `b6af24e12abf52acb8c212c9a45b7cb68aaec88a`.

Contract:
- connector-authenticated HUB catalog discovery
- generic for every configured HUB; no EA2/NE1 exception
- no MS upstream call
- no Turso write
- at most two small Turso statements per Browser catalog refresh
- Browser side is leased to at most one catalog refresh per hour
- Production must not be deployed
