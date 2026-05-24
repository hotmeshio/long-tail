# Agents API

CRUD operations for agents — autonomous personas that react to events and run workflows on schedules. Each agent has an identity, motivation (goals/rules), event subscriptions, cron schedules, and a knowledge domain.

All endpoints require authentication.

## List agents

```
GET /api/agents?status=active&knowledge_domain=system-health&limit=25&offset=0
```

Returns agents with subscription counts and topic lists (via JOIN).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | `string` | No | Filter by status: `active`, `inactive`, `paused`, `error` |
| `knowledge_domain` | `string` | No | Filter by knowledge domain |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |

**Response 200:**

```json
{
  "agents": [
    {
      "id": "health-monitor",
      "description": "Watches for workflow failures",
      "status": "active",
      "knowledge_domain": "system-health",
      "behaviors": { "schedules": [{ "cron": "*/5 * * * *", "workflow_type": "basicEcho" }] },
      "subscription_count": 4,
      "sub_topics": ["workflow.failed", "activity.failed", "app.*.*.error", "task.failed"],
      "last_run_at": "2026-05-15T04:24:58.351Z",
      ...
    }
  ],
  "total": 3
}
```

## Get agent

```
GET /api/agents/:id
```

Returns an agent with aggregated stats (knowledge entry count, escalation count).

**Response 200:**

```json
{
  "id": "health-monitor",
  "stats": { "knowledge_count": 3, "escalation_count": 0 },
  ...
}
```

## Create agent

```
POST /api/agents
```

**Body:**

```json
{
  "id": "health-monitor",
  "description": "Watches for workflow failures and schema drift",
  "goals": "Detect failures early, capture diagnostics",
  "rules": "Never auto-restart failed workflows",
  "status": "active",
  "knowledge_domain": "system-health",
  "behaviors": {
    "schedules": [
      { "cron": "*/5 * * * *", "workflow_type": "basicEcho", "envelope": {} }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique kebab-case identifier (e.g. `health-monitor`). Serves as primary key. |
| `description` | `string` | No | One-sentence summary |
| `goals` | `string` | No | Agent's primary motivation |
| `rules` | `string` | No | Guardrails and constraints |
| `status` | `string` | No | `active`, `inactive`, `paused`, `error` (default: `inactive`) |
| `user_id` | `string` | No | Service account UUID |
| `knowledge_domain` | `string` | No | Knowledge domain to own |
| `behaviors` | `object` | No | `{ schedules?: AgentSchedule[] }` |

**Response 201:** The created agent.

## Update agent

```
PUT /api/agents/:id
```

Partial update — only include fields to change. Changing `status` or `behaviors` automatically restarts event subscriptions and cron schedules.

**Response 200:** The updated agent.

## Delete agent

```
DELETE /api/agents/:id
```

Permanently removes the agent. Event subscriptions are cascade-deleted. Cron schedules are stopped. Knowledge entries and workflow history are preserved.

**Response 200:** `{ "deleted": true }`

---

## Agent Subscriptions

Subscriptions wire events to workflows. When an event matches the topic pattern, the agent invokes the configured workflow.

### List subscriptions

```
GET /api/agents/:agentId/subscriptions
```

**Response 200:**

```json
{
  "subscriptions": [
    {
      "id": "uuid",
      "agent_id": "health-monitor",
      "topic": "workflow.failed",
      "filter": { "status": 422 },
      "reaction_type": "durable",
      "workflow_type": "basicEcho",
      "input_mapping": { "data": { "error": "{event.data.error}" } },
      "execute_as": null,
      "enabled": true
    }
  ]
}
```

### Create subscription

```
POST /api/agents/:agentId/subscriptions
```

**Body:**

```json
{
  "topic": "workflow.failed",
  "reaction_type": "durable",
  "workflow_type": "basicEcho",
  "input_mapping": { "data": { "error": "{event.status}" } },
  "filter": { "status": 422 },
  "enabled": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | `string` | Yes | Event topic pattern. Supports `*` (one token) and `>` (rest of subject). |
| `reaction_type` | `string` | Yes | `durable`, `pipeline`, or `mcp_query` |
| `workflow_type` | `string` | For durable | Registered workflow name |
| `pipeline_id` | `string` | For pipeline | YAML workflow UUID |
| `mcp_prompt` | `string` | For mcp_query | Dynamic query prompt |
| `input_mapping` | `object` | No | Maps event fields to workflow envelope. Templates: `{event.data.field}` |
| `filter` | `object` | No | Shallow key-value match against `event.data` |
| `execute_as` | `string` | No | Identity override for this subscription |
| `enabled` | `boolean` | No | Default: `true` |

**Response 201:** The created subscription.

### Update subscription

```
PUT /api/agents/:agentId/subscriptions/:subId
```

Partial update.

**Response 200:** The updated subscription.

### Delete subscription

```
DELETE /api/agents/:agentId/subscriptions/:subId
```

**Response 200:** `{ "deleted": true }`
