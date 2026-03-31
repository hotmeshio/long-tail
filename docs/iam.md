# Identity and Access Management

Long Tail runs durable workflows that call tools on behalf of users. A content review might invoke a database query, fetch a document through a vision model, and escalate to a human reviewer — all within a single orchestrated pipeline. Each of those steps needs to know who asked for it, what credentials to use, and what permissions apply.

This document explains how Long Tail answers the question every tool must eventually face: on whose behalf?

## The Problem of Three Paths

A tool in Long Tail can be invoked three ways. It might be called as an MCP server tool, where a client sends a JSON-RPC request. It might run as a proxy activity inside a durable workflow, where HotMesh replays the call from its event log. Or it might execute as a worker callback in a compiled YAML workflow, where a HotMesh stream delivers input data to a registered function.

Each path historically carried identity differently. MCP tools received a hidden `_auth` field injected into their arguments. Proxy activities read from `OrchestratorContext`, an `AsyncLocalStorage` bucket set by the interceptor. YAML workers received nothing at all — their callbacks ran with no knowledge of who had initiated the pipeline. An activity that worked when called from one path would silently lose identity when called from another.

The IAM system unifies these paths behind a single abstraction.

## ToolContext

At the centre of the design sits `ToolContext`, a structured identity object available to any activity through Node's `AsyncLocalStorage`. It carries three concerns:

**Principal** — who is making the request. A principal has an ID (UUID from `lt_users`), a type (`user` or `bot`), a display name, and a list of RBAC roles loaded from the database. The system makes no functional distinction between humans and bots at the authorization layer; the `type` field exists for audit and billing purposes.

**Credentials** — what authority the principal carries. This includes a short-lived delegation token (a scoped JWT with a five-minute default TTL) and the scopes it grants. The token is minted once per workflow execution and reused across all tool calls within that scope.

**Trace** — where the call sits in the workflow hierarchy. Origin ID, parent ID, current workflow ID, and optional OpenTelemetry identifiers. These fields enable audit queries that trace a tool call back through the full orchestration chain to the HTTP request that started it.

The interceptor sets `ToolContext` at the start of every workflow execution:

```
HTTP request (req.auth.userId)
    → LTEnvelope.lt.userId
        → Interceptor resolves ToolContext from userId + DB roles
            → runWithToolContext(ctx, workflowFn)
                → Any activity calls getToolContext()
```

Activities call `getToolContext()` and receive the same object regardless of invocation path. The MCP client's `callServerTool` function also reads it — when no explicit auth context is passed, it derives `_auth` from the ambient `ToolContext`. This closed the YAML worker gap without requiring changes to worker registration or HotMesh's streaming protocol.

## Resolution Priority

Identity can arrive from several sources simultaneously. The `resolveToolContext` function imposes a strict priority:

1. `_auth.userId` — explicit injection from the MCP server tool path
2. Direct `userId` parameter — passed by route handlers
3. `envelope.lt.userId` — set when the workflow was started
4. `orchestratorContext.userId` — inherited from the parent workflow

The first non-null value wins. This ordering means that an explicit tool-level override (for impersonation or testing) takes precedence over the workflow's ambient identity, which in turn takes precedence over the orchestrator's inherited identity.

When a userId is resolved, the system loads the user's roles from `lt_user_roles` and determines the highest role type (superadmin outranks admin, which outranks member). If the user cannot be found — perhaps because the database is temporarily unreachable — resolution falls back to a minimal principal with just the ID and an empty role list. The workflow proceeds rather than failing, since identity is informational for most tool calls.

## Credential Resolution

Tools that need provider credentials (an Anthropic API key, a Google OAuth token) use the credential resolution cascade:

1. **Principal's stored credential** — `getFreshAccessToken(principal.id, provider, label)` looks up the user's encrypted OAuth token in `lt_oauth_tokens`. If the token has expired and a refresh token is available, it refreshes automatically.

2. **System environment variable** — if no stored credential exists, the system checks well-known environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.).

The source of the credential is tracked (`user`, `bot`, or `system`) so that billing and audit systems can distinguish between user-funded and platform-funded API calls.

## Bot Accounts

Not every workflow is initiated by a human clicking a button. Scheduled jobs, CI pipelines, and webhook handlers need service identities that can authenticate without an interactive session.

Bot accounts are rows in `lt_users` with `account_type = 'bot'`. This design decision — bots are users — means the entire RBAC, credential storage, and delegation token infrastructure works for bots without a single line of special-case code. A bot can hold the `scheduler` role, store an Anthropic OAuth token, and receive delegation tokens exactly as a human user would.

Bot authentication uses API keys prefixed with `lt_bot_`. The keys are generated via the admin API, bcrypt-hashed at rest, and validated by the same `JwtAuthAdapter` that handles human JWTs. When a request arrives with a `lt_bot_`-prefixed Bearer token, the adapter validates it against `lt_bot_api_keys` and returns an `AuthPayload` with the bot's user ID. From that point forward, middleware and route handlers cannot distinguish bot requests from human ones.

### Lifecycle

```bash
# Create a bot (admin-only)
POST /api/bot-accounts
{ "name": "ci-bot", "description": "Nightly regression suite" }

# Assign roles
POST /api/bot-accounts/:id/roles
{ "role": "engineer", "type": "member" }

# Generate an API key (returned once)
POST /api/bot-accounts/:id/api-keys
{ "name": "production" }
# → { "id": "...", "rawKey": "lt_bot_a1b2c3..." }

# Bot authenticates with the key
curl -H "Authorization: Bearer lt_bot_a1b2c3..." \
  http://localhost:3000/api/workflows/mcpQuery/invoke \
  -d '{"prompt": "Check system health"}'
```

The bot's `userId` flows into the workflow envelope, through the interceptor, into `ToolContext`, and finally into the `initiated_by` column on the task record. An administrator querying the audit trail can see exactly which bot started which workflow, when, and with what roles.

## Audit Trail

Every task record now carries two audit columns:

- `initiated_by` — UUID foreign key to `lt_users`, identifying the human or bot that started the workflow chain. Set by the interceptor (for standalone workflows) and by `executeLT` (for orchestrated child workflows).

- `principal_type` — `'user'` or `'bot'`, enabling filtered queries without joining back to `lt_users`.

The MCP client also emits a debug-level log for every tool invocation:

```
[lt-mcp:audit] fetchJson on long-tail-http-fetch by user:a1b2c3d4
[lt-mcp:audit] run_query on long-tail-db by bot:e5f6g7h8
```

These entries provide a real-time stream of tool usage that can be routed to structured logging or an observability platform.

## Dashboard

The dashboard exposes IAM through two interfaces:

**Connections** (`/connections`) — available to all authenticated users. Lists the user's connected OAuth providers with status, credential type, and expiry. Users can connect new providers or revoke existing connections. This replaced the former standalone "Connect Anthropic" page with a general-purpose provider management section.

**Bot Management** (`/admin/bots`) — available to admin and superadmin users. Provides a table of bot accounts with status indicators, role assignments, and a detail panel for managing API keys. The key generation flow displays the raw key once with a copy-to-clipboard action; the key cannot be retrieved after the modal is dismissed.

## Security Model

The IAM system follows least-privilege principles at every layer:

| Credential | Scope | Lifetime | Revocation |
|---|---|---|---|
| User JWT | Full API (RBAC-scoped) | 24 hours | Logout / expiry |
| Bot API key | Full API (RBAC-scoped) | Until revoked | Admin deletes key |
| Delegation token | Specific scopes | 5 min (max 1 hr) | Cannot be revoked; expires naturally |
| Service token | Server-specific | Until revoked | Admin deletes token |
| OAuth token | Provider scopes | Provider-set | User revokes in Connections page |

Bot accounts inherit the same RBAC constraints as human users. A bot with the `member` role type cannot access admin endpoints. A bot without the `engineer` role cannot invoke workflows gated by `invocation_roles`. The `account_type` column exists for audit segmentation, not for authorization bypass.

Delegation tokens remain the narrowest credential in the system. They cannot be refreshed, extended, or used to authenticate as a different principal. A tool that receives a delegation token can do exactly what the scopes allow, for exactly the duration specified, on behalf of exactly one user or bot.

## Files

The implementation spans four layers:

**Types** — `types/tool-context.ts` defines `ToolContext`, `ToolPrincipal`, `ToolCredentials`, and `ToolTrace`.

**Services** — `services/iam/` contains the context propagation (`context.ts`), resolution logic (`resolve.ts`), credential cascade (`credentials.ts`), and bot account management (`bots.ts`).

**Routes** — `routes/bot-accounts.ts` provides the admin API. The OAuth routes gained a `GET /api/auth/oauth/connections` endpoint for listing a user's connected providers.

**Dashboard** — `dashboard/src/pages/settings/ConnectionsPage.tsx` and `dashboard/src/pages/admin/bots/BotsPage.tsx` provide the user-facing and admin-facing interfaces respectively.

**Schema** — `008_bot_accounts.sql` adds `account_type` to `lt_users` and creates `lt_bot_api_keys`. `009_audit_trail.sql` adds `initiated_by` and `principal_type` to `lt_tasks`.
