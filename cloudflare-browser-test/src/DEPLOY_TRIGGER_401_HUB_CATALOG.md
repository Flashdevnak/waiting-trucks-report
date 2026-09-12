# Browser DEV validation trigger

Triggers Browser TEST deployment after authoritative catalog source commit `b6af24e12abf52acb8c212c9a45b7cb68aaec88a` and DEV Worker version `925b2fe7-843b-4191-8215-31dea3248026`.

Validation target: Error Intelligence and TBR Intelligence must use the same authoritative configured-HUB catalog on every HUB. Browser cron refreshes the catalog at most once per hour through the DEV service binding. The catalog request performs no MS upstream polling and no Turso writes; it is generic and has no named-HUB exception.

Scope: Browser TEST only. No Production cutover.
