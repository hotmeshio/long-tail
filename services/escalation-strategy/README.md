Pluggable strategy pattern for escalation resolution. Determines whether a resolved escalation triggers a standard workflow re-run or routes to the MCP triage orchestrator for dynamic remediation.

Key files:
- `index.ts` — `LTEscalationStrategyRegistry` singleton: `register(strategy)`, `clear()`, `current`
- `default.ts` — `DefaultEscalationStrategy`: always returns `{ action: 'rerun' }`
- `mcp.ts` — `McpEscalationStrategy`: checks `resolverPayload._lt.needsTriage`; if set, builds a triage envelope and returns `{ action: 'triage', triageEnvelope }`; otherwise falls through to `rerun`

No SQL or LLM prompts. The strategy interface (`LTEscalationStrategy`) is defined in `types/escalation-strategy.ts`.
