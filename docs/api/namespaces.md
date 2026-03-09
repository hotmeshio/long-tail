# Namespaces API

Namespaces organize MCP process servers. Each namespace maps to a separate PostgreSQL schema used by HotMesh for workflow execution. Namespaces are auto-registered when YAML workflows are deployed. All endpoints require authentication.

## List namespaces

```
GET /api/namespaces
```

**Response 200:**

```json
{
  "namespaces": [
    {
      "id": "a1b2c3d4-...",
      "name": "lt-yaml",
      "description": "YAML workflow process server",
      "schema_name": "lt-yaml",
      "is_default": false,
      "metadata": null,
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

## Register a namespace

```
POST /api/namespaces
```

Creates or upserts a namespace. Typically called automatically during YAML workflow deployment.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique namespace name (becomes the HotMesh app ID and schema name) |
| `description` | `string` | No | Human-readable description |
| `metadata` | `object` | No | Arbitrary metadata |

**Response 200:** Namespace record (created or existing).

**Response 400:** Missing `name`.
