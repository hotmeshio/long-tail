# lt.mcp

Manage MCP (Model Context Protocol) server registrations, connections, credentials, and tool invocations.

## listServers

List registered MCP servers with optional filtering and pagination.

```typescript
const result = await lt.mcp.listServers({ status: 'active', limit: 10 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | No | Filter by server status (e.g. `'active'`, `'inactive'`) |
| `auto_connect` | `boolean` | No | Filter by auto-connect setting |
| `search` | `string` | No | Free-text search across server names and descriptions |
| `tags` | `string[]` | No | Filter to servers matching any of these tags |
| `limit` | `number` | No | Maximum number of results to return |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<{ ... }>`

**Auth:** Not required

---

## createServer

Register a new MCP server.

```typescript
const result = await lt.mcp.createServer({
  name: 'my-server',
  transport_type: 'sse',
  transport_config: { url: 'https://mcp.example.com/sse' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique display name for the server |
| `description` | `string` | No | Human-readable description |
| `transport_type` | `string` | Yes | Transport protocol (e.g. `'sse'`, `'stdio'`) |
| `transport_config` | `Record<string, any>` | Yes | Transport-specific connection settings |
| `auto_connect` | `boolean` | No | Whether to connect automatically on startup |
| `metadata` | `Record<string, any>` | No | Arbitrary key-value metadata |
| `tags` | `string[]` | No | Tags for categorization and filtering |
| `compile_hints` | `any` | No | Hints used during tool compilation |
| `credential_providers` | `string[]` | No | OAuth/credential provider identifiers required by this server |

**Returns:** `LTApiResult<McpServer>`

**Auth:** Not required

---

## testConnection

Test connectivity to an MCP server without persisting it.

```typescript
const result = await lt.mcp.testConnection({
  transport_type: 'sse',
  transport_config: { url: 'https://mcp.example.com/sse' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transport_type` | `string` | Yes | Transport protocol to test |
| `transport_config` | `Record<string, any>` | Yes | Transport-specific connection settings |

**Returns:** `LTApiResult<{ success: boolean, error?: string, tools: any[] }>`

**Auth:** Not required

---

## getServer

Retrieve a single MCP server by ID.

```typescript
const result = await lt.mcp.getServer({ id: 'server-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier |

**Returns:** `LTApiResult<McpServer>`

**Auth:** Not required

---

## updateServer

Update fields on an existing MCP server.

```typescript
const result = await lt.mcp.updateServer({ id: 'server-id', description: 'Updated description' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier |
| `[key]` | `any` | No | Any mutable server field (name, description, transport_config, etc.) |

**Returns:** `LTApiResult<McpServer>`

**Auth:** Not required

---

## deleteServer

Delete an MCP server by ID.

```typescript
const result = await lt.mcp.deleteServer({ id: 'server-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier |

**Returns:** `LTApiResult<{ deleted: true }>`

**Auth:** Not required

---

## connectServer

Establish a live connection to a registered MCP server.

```typescript
const result = await lt.mcp.connectServer({ id: 'server-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier to connect |

**Returns:** `LTApiResult<{ connected: true, serverId: string }>`

**Auth:** Not required

---

## disconnectServer

Disconnect a live MCP server connection.

```typescript
const result = await lt.mcp.disconnectServer({ id: 'server-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier to disconnect |

**Returns:** `LTApiResult<{ disconnected: true, serverId: string }>`

**Auth:** Not required

---

## getCredentialStatus

Check which credential providers are registered vs missing for an MCP server.

```typescript
const result = await lt.mcp.getCredentialStatus({ id: 'server-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier |

**Returns:** `LTApiResult<{ required: string[], registered: string[], missing: string[] }>`

**Auth:** Required (credentials resolved against the authenticated user)

---

## listTools

List all tools exposed by a connected MCP server.

```typescript
const result = await lt.mcp.listTools({ id: 'server-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier |

**Returns:** `LTApiResult<{ tools: any[] }>`

**Auth:** Not required

---

## callTool

Invoke a specific tool on a connected MCP server.

```typescript
const result = await lt.mcp.callTool({
  id: 'server-id',
  toolName: 'screenshot',
  arguments: { url: 'https://example.com' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | The MCP server identifier |
| `toolName` | `string` | Yes | Name of the tool to invoke |
| `arguments` | `Record<string, any>` | No | Key-value arguments to pass to the tool |
| `execute_as` | `string` | No | Account id or `external_id` to run the tool as |

**Returns:** `LTApiResult<{ result: any }>`

**Auth:** Required (`401` without it). The tool runs as the caller, or as `execute_as` when given; for `execute_as`, a superadmin may act as anyone, and a caller holding an `admin`-type grant may act as an account that holds no superadmin grant and whose every role the caller holds at the same or higher type. A built-in tool requires the capability its manifest `gate` declares, checked for the acting account; a built-in tool with no gate requires builder access (superadmin or the `engineer` role). Refusals return `403`.
