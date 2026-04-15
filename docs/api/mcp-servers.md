# MCP Servers API

Manage MCP server registrations, connections, and tool invocations. All endpoints require authentication.

## List servers

```
GET /api/mcp/servers
```

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

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique server name |
| `description` | `string` | No | Human-readable description |
| `transport_type` | `string` | Yes | `stdio` or `sse` |
| `transport_config` | `object` | Yes | Transport-specific config (see below) |
| `auto_connect` | `boolean` | No | Connect on startup (default: false) |
| `metadata` | `object` | No | Arbitrary metadata |

**Transport config for `stdio`:**

```json
{ "command": "node", "args": ["server.js"], "env": {} }
```

**Transport config for `sse`:**

```json
{ "url": "http://localhost:3001/sse" }
```

**Response 201:** Created server record.

**Response 409:** Server name already exists.

## Get a server

```
GET /api/mcp/servers/:id
```

**Response 200:** Server record.

**Response 404:** Server not found.

## Update a server

```
PUT /api/mcp/servers/:id
```

**Request body:** Any fields from the registration (partial update).

**Response 200:** Updated server record.

**Response 404:** Server not found.

## Delete a server

```
DELETE /api/mcp/servers/:id
```

**Response 200:**

```json
{ "deleted": true }
```

**Response 404:** Server not found.

## Connect to a server

```
POST /api/mcp/servers/:id/connect
```

Establishes a connection to the registered MCP server and caches its tool manifest.

**Response 200:**

```json
{ "connected": true, "serverId": "a1b2c3d4-..." }
```

## Disconnect from a server

```
POST /api/mcp/servers/:id/disconnect
```

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

**Request body:**

```json
{
  "arguments": {
    "image_url": "https://example.com/image.png"
  }
}
```

**Response 200:**

```json
{
  "result": {
    "content": [{ "type": "text", "text": "Analysis result..." }]
  }
}
```
