Execution viewer for YAML and MCP workflow runs. Builds structured timelines from raw workflow events for the dashboard run-detail view.

Key files:
- `index.ts` — Barrel export and top-level run-fetching entry points
- `execution-builder.ts` — Assembles flat event lists into nested execution timelines
- `events.ts` — Event type constructors for tool calls, LLM rounds, escalations, and completions
- `enrichment.ts` — Stream enrichment: attaches server metadata, durations, and status labels to raw events
- `queries.ts` — SQL query functions for fetching run records and associated events
- `sql.ts` — Static SQL statements
- `types.ts` — Shared interfaces for run events, timelines, and execution nodes
