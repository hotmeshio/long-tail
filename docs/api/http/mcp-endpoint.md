# MCP Endpoint

Long Tail exposes its full tool surface via the MCP (Model Context Protocol) streamable-http transport at `/mcp`. External MCP clients — Claude Desktop, Cursor, other agents, or custom applications — connect to this endpoint to discover and invoke tools.

All requests require authentication via `Authorization: Bearer <token>`.

## Connection

```
POST /mcp
Authorization: Bearer <api-key>
Content-Type: application/json
Accept: application/json, text/event-stream
```

The endpoint uses stateless mode — each request is self-contained. No session management required.

### Connecting with the MCP SDK

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp'),
  {
    requestInit: {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    },
  },
);

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

// Discover tools
const { tools } = await client.listTools();
console.log(`${tools.length} tools available`);

// Invoke a tool
const result = await client.callTool({
  name: 'list_roles',
  arguments: {},
});
```

### Connecting with curl

```bash
# Initialize
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}},"id":1}'

# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_settings","arguments":{}},"id":3}'
```

## Authentication

Two token types are supported:

| Type | Format | Use case |
|------|--------|----------|
| JWT | Standard Bearer token from `POST /api/auth/login` | Interactive sessions, testing |
| API key | `lt_bot_*` prefix | Service accounts, automation |

### Service Account Setup

1. Create a service account: `POST /api/bot-accounts`
2. Generate an API key with scopes: `POST /api/bot-accounts/:id/api-keys`
3. Use the key as a Bearer token for `/mcp` requests

## Scopes

API key scopes control which tools are visible:

| Scope | Tools | Description |
|-------|-------|-------------|
| `mcp:read` | 57 | Read-safe tools only — queries, listings, discovery |
| `mcp:read` + `mcp:full` | 110 | All tools — can modify state |

A read key cannot invoke write operations (create, update, delete, invoke workflows). Use the read key for monitoring and exploration, the full key for automation.

### Seeded Service Account

Long Tail seeds an `mcp-service` account at startup with two pre-configured API keys:
- **read** — scopes: `["mcp:read"]`
- **full** — scopes: `["mcp:read", "mcp:full"]`

Keys are logged once at startup and cannot be retrieved again. For production, create a new service account and generate keys via the dashboard or API.

## Exposure Control

Deployment-wide configuration controls which servers and tools are available on the `/mcp` endpoint. Set via `startConfig.mcp.exposure`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `readOnly` | boolean | false | Only expose read-safe tools to all callers |
| `hideAiWhenUnavailable` | boolean | true | Hide AI-dependent servers when no API key configured |
| `allowServers` | string[] | all shipped | Explicit server allowlist |
| `denyServers` | string[] | none | Server denylist |

Exposure config is deployment-wide. Scopes are per-API-key. Both layers are applied: exposure filters first, then scope filters.

## Error Responses

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid Bearer token |
| 405 | GET or DELETE request (stateless mode — POST only) |
| 500 | Internal server error |

## Methods

| Method | Description |
|--------|-------------|
| `GET /mcp` | Returns 405 — stateless mode has no SSE streams |
| `POST /mcp` | JSON-RPC messages: `initialize`, `tools/list`, `tools/call` |
| `DELETE /mcp` | Returns 405 — stateless mode has no sessions |
