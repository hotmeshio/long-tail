# Topics API

Browse, register, and manage the topic catalog — a persistent registry of known event topics with descriptions, payload schemas, and subscriber counts.

All endpoints require authentication.

## List topics

```
GET /api/topics?category=task&search=created&limit=50&offset=0
```

Returns topics with subscriber counts (computed via JOIN on active subscriptions).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | `string` | No | Filter by category: `task`, `workflow`, `escalation`, `activity`, `knowledge`, `agent`, `app`, `milestone` |
| `search` | `string` | No | Search topic name or description (case-insensitive) |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |

**Response 200:**

```json
{
  "topics": [
    {
      "topic": "task.created",
      "description": "A new task has been created and queued for execution.",
      "category": "task",
      "payload_schema": {
        "type": "object",
        "properties": {
          "taskId": { "type": "string" },
          "status": { "type": "string" },
          "workflowId": { "type": "string" }
        }
      },
      "example_payload": { "taskId": "tsk-001", "status": "pending" },
      "source": "system",
      "tags": ["lifecycle", "core"],
      "subscriber_count": 2,
      "last_seen_at": "2026-05-20T12:00:00Z",
      "created_at": "2026-05-20T00:00:00Z",
      "updated_at": "2026-05-20T00:00:00Z"
    }
  ],
  "total": 22
}
```

## Get topic

```
GET /api/topics/by-name/:topic
```

Returns a single topic with its full schema, example payload, and a list of agents whose subscription patterns match this topic.

The `:topic` parameter must be URL-encoded (e.g., `task.created` becomes `task.created` — Express auto-decodes).

**Response 200:**

```json
{
  "topic": "task.created",
  "description": "A new task has been created and queued for execution.",
  "category": "task",
  "payload_schema": { "..." },
  "example_payload": { "..." },
  "source": "system",
  "tags": ["lifecycle", "core"],
  "subscribers": [
    {
      "id": "uuid",
      "agent_id": "uuid",
      "agent_name": "health-monitor",
      "topic": "task.*",
      "reaction_type": "durable"
    }
  ],
  "created_at": "2026-05-20T00:00:00Z",
  "updated_at": "2026-05-20T00:00:00Z"
}
```

Subscribers are matched using NATS-style pattern matching — an agent subscribed to `task.*` appears on the `task.created` detail page.

**Response 404:** `{ "error": "Topic not found" }`

## Register topic

```
POST /api/topics
```

Manually register a topic in the catalog. Use this to pre-declare topics before first publish.

**Body:**

```json
{
  "topic": "app.vendor.orders.created",
  "description": "Fired when a new order is placed.",
  "category": "app",
  "payload_schema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string" },
      "total": { "type": "number" }
    }
  },
  "tags": ["orders", "lifecycle"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | `string` | Yes | Unique topic name (dot-delimited) |
| `category` | `string` | Yes | One of: `task`, `workflow`, `escalation`, `activity`, `knowledge`, `agent`, `app`, `milestone` |
| `description` | `string` | No | Human-readable description |
| `payload_schema` | `object` | No | JSON Schema for `event.data` |
| `example_payload` | `object` | No | Concrete example of `event.data` |
| `source` | `string` | No | Source identifier (default: `'app'`) |
| `tags` | `string[]` | No | Filterable tags |

**Response 201:** The created topic.

**Response 409:** `{ "error": "Topic \"app.vendor.orders.created\" already exists" }`

## Update topic

```
PUT /api/topics/by-name/:topic
```

Partial update — only include fields to change. System topics (`source: 'system'`) can be updated (description, tags) but not deleted.

**Body:**

```json
{
  "description": "Updated description",
  "tags": ["orders", "lifecycle", "critical"]
}
```

**Response 200:** The updated topic.

**Response 404:** `{ "error": "Topic not found" }`

## Delete topic

```
DELETE /api/topics/by-name/:topic
```

Permanently removes a topic from the catalog. System topics are protected.

**Response 200:** `{ "deleted": true }`

**Response 403:** `{ "error": "System topics cannot be deleted" }`

**Response 404:** `{ "error": "Topic not found" }`
