Identity and access management service. Provides principal resolution, tool context propagation, and credential cascade that works identically across MCP server tools, proxy activities, YAML workflows, and route handlers.

Key files:
- `index.ts` — Barrel re-export of all IAM primitives
- `context.ts` — `runWithToolContext()` / `getToolContext()` for AsyncLocalStorage-based identity propagation
- `resolve.ts` — `resolveToolContext()` merges identity from JWT, delegation token, bot key, or workflow metadata
- `principal.ts` — Principal type normalization and lookup
- `activity.ts` — `getActivityIdentity()` for retrieving caller identity inside proxy activities
- `credentials.ts` — Credential cascade: resolve OAuth tokens, API keys, or prompt for missing credentials
- `envelope.ts` — Envelope helpers for attaching identity to outbound tool calls
- `ephemeral.ts` — Ephemeral token issuance for short-lived, narrowly scoped operations
- `bots.ts` — Service account (bot user) management and resolution
