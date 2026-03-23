Singleton registry that starts and manages HotMesh `Virtual.cron` schedules for workflows with a `cron_schedule` in their config. On `connect()`, loads all workflow configs from the database, filters those with `cron_schedule + invocable + task_queue`, and starts a cron for each. Each cron callback creates a new `Durable.Client` and starts a workflow execution with the config's `envelope_schema` as the default payload.

Key files:
- `index.ts` — `LTCronRegistry` class: `connect()`, `disconnect()`, `startCron()`, `stopCron()`, `restartCron()`, `clear()`

The registry follows the same singleton pattern as `maintenanceRegistry` and `telemetryRegistry`. `restartCron()` is called after config changes to stop the old cron and start a new one. All crons use the `lt.cron.{workflowType}` topic pattern and `lt-cron-{workflowType}` IDs. No SQL or LLM prompts — purely orchestration logic over HotMesh primitives.
