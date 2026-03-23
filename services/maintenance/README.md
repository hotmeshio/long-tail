Automated database maintenance via a scheduled HotMesh `Virtual.cron`. Prunes old streams, transient jobs, execution artifacts, and fully-pruned jobs based on configurable rules.

Key files:
- `index.ts` — `LTMaintenanceRegistry` singleton: `register(config)`, `connect()`, `disconnect()`, `clear()`. The `executeRule()` function translates each `LTMaintenanceRule` into the appropriate `dbaService.prune()` call based on `target` (streams/jobs), `action` (delete/prune), and qualifiers (`hasEntity`, `pruned`).

Rule types supported:
- `streams` + `delete` — delete old stream messages
- `jobs` + `delete` + `hasEntity: false` — delete transient jobs (no entity)
- `jobs` + `prune` + `hasEntity: true` — strip execution artifacts from entity jobs (keep jdata/udata/jmark/hmark)
- `jobs` + `delete` + `pruned: true` — hard-delete old pruned jobs

No SQL or LLM prompts. Types are in `types/maintenance.ts`. The cron uses `lt.maintenance.prune` topic and `lt-maintenance-nightly` ID.
