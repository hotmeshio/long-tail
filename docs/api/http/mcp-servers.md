# MCP Servers API

Manage MCP server registrations, connections, and tool invocations. All endpoints require authentication. Registering, testing, updating, deleting, connecting, and disconnecting servers require builder access (superadmin or the `engineer` role).

A `stdio` server is a command Long Tail starts on its own host, with that host's environment and network. Builder access therefore includes running commands on the host: grant the `engineer` role with the same care as host access.

## List servers

```
GET /api/mcp/servers
```

`transport_config` is included only for builders.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | Filter by status: `registered`, `connected`, `error`, `disconnected` |
| `search` | `string` | Search server name, description, or tool names (case-insensitive) |
| `auto_connect` | `boolean` | Filter by auto-connect flag |
| `tags` | `string` | Comma-separated tags for tag-based filtering |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:**

```json
{
  "servers": [
    {
      "id": "a1b2c3d4-...",
      "name": "mcp-vision-longtail",
      "description": "Vision analysis tools",
      "transport_type": "stdio",
      "transport_config": { "command": "node", "args": ["server.js"] },
      "auto_connect": true,
      "status": "connected",
      "tool_manifest": [
        { "name": "analyze_image", "description": "Analyze an image", "inputSchema": {} }
      ],
      "tags": ["vision", "image-analysis"],
      "compile_hints": "Use for image processing tasks",
      "credential_providers": ["openai"],
      "metadata": { "builtin": true },
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

## Register a server

```
POST /api/mcp/servers
```

**Auth:** Requires builder access (superadmin or the `engineer` role).

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique server name |
| `description` | `string` | No | Human-readable description |
| `transport_type` | `string` | Yes | `stdio`, `sse`, or `streamable-http` |
| `transport_config` | `object` | Yes | Transport-specific config (see below) |
| `auto_connect` | `boolean` | No | Connect on startup (default: false) |
| `metadata` | `object` | No | Arbitrary metadata |
| `tags` | `string[]` | No | Tags for tool discovery (e.g., `["database", "analytics"]`) |
| `compile_hints` | `string` | No | Guidance for the workflow compiler when using this server's tools |
| `credential_providers` | `string[]` | No | IAM providers required by tools (e.g., `["github", "slack"]`) |

**Transport config for `stdio`:**

```json
{ "command": "node", "args": ["server.js"], "env": {} }
```

**Transport config for `sse`:**

```json
{ "url": "http://localhost:3001/sse" }
```

**Transport config for `streamable-http`:**

```json
{ "url": "http://localhost:3001/mcp" }
```

**Response 201:** Created server record.

**Response 409:** Server name already exists.

## Get a server

```
GET /api/mcp/servers/:id
```

`transport_config` is included only for builders.

**Response 200:** Server record.

**Response 404:** Server not found.

## Update a server

```
PUT /api/mcp/servers/:id
```

**Auth:** Requires builder access (superadmin or the `engineer` role).

**Request body:** Any fields from the registration (partial update), including `tags`, `compile_hints`, and `credential_providers`.

**Response 200:** Updated server record.

**Response 404:** Server not found.

## Delete a server

```
DELETE /api/mcp/servers/:id
```

**Auth:** Requires builder access (superadmin or the `engineer` role).

**Response 200:**

```json
{ "deleted": true }
```

**Response 404:** Server not found.

## Test connection

```
POST /api/mcp/servers/test-connection
```

**Auth:** Requires builder access (superadmin or the `engineer` role).

Test connectivity to an MCP server without persisting a registration. Creates a temporary client, connects, lists tools, then disconnects.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transport_type` | `string` | Yes | `stdio`, `sse`, or `streamable-http` |
| `transport_config` | `object` | Yes | Transport-specific config |

**Response 200:**

```json
{
  "success": true,
  "tools": [
    { "name": "analyze_image", "description": "Analyze an image", "inputSchema": {} }
  ]
}
```

On failure:

```json
{
  "success": false,
  "tools": [],
  "error": "Connection refused"
}
```

## Connect to a server

```
POST /api/mcp/servers/:id/connect
```

**Auth:** Requires builder access (superadmin or the `engineer` role).

Establishes a connection to the registered MCP server and caches its tool manifest.

**Response 200:**

```json
{ "connected": true, "serverId": "a1b2c3d4-..." }
```

## Disconnect from a server

```
POST /api/mcp/servers/:id/disconnect
```

**Auth:** Requires builder access (superadmin or the `engineer` role).

**Response 200:**

```json
{ "disconnected": true, "serverId": "a1b2c3d4-..." }
```

## List tools

```
GET /api/mcp/servers/:id/tools
```

Returns tools available on a connected MCP server.

**Response 200:**

```json
{
  "tools": [
    {
      "name": "analyze_image",
      "description": "Analyze an image using vision models",
      "inputSchema": {
        "type": "object",
        "properties": {
          "image_url": { "type": "string" }
        }
      }
    }
  ]
}
```

## Call a tool

```
POST /api/mcp/servers/:id/tools/:toolName/call
```

Invoke a tool on a connected MCP server.

**Auth:** The tool runs as the caller, or as the `execute_as` account when given. A built-in tool requires the capability its manifest `gate` declares, checked for the acting account; a built-in tool with no gate requires builder access. `execute_as` follows the act-as rule: a superadmin may act as anyone, and a caller holding an `admin`-type grant may act as an account that holds no superadmin grant and whose every role the caller holds at the same or higher type.

**Request body:**

```json
{
  "arguments": {
    "image_url": "https://example.com/image.png"
  },
  "execute_as": "optional-account-id"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `arguments` | `object` | No | Tool arguments |
| `execute_as` | `string` | No | Account id or `external_id` to run the tool as |

**Response 200:**

```json
{
  "result": {
    "content": [{ "type": "text", "text": "Analysis result..." }]
  }
}
```

**Response 403:** The caller may not act as `execute_as`, or the acting account lacks the tool's capability.

**Response 422** (missing credential):

```json
{
  "error": "missing_credential",
  "provider": "openai",
  "message": "Credential required for provider: openai"
}
```
