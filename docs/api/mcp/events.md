# Events

Event bus for agent-to-agent communication. Publish custom events that other agents subscribe to and react to.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-events` |
| Category | Communication |
| AI required | No |
| Credential providers | — |

## Compile Hints

publish_event: topic follows app.{namespace}.{entity}.{action} convention. The app. prefix is auto-added if omitted. Events are delivered to all matching subscribers.

## Tools

### publish_event

Publish a custom event to the event bus. Other agents and workflows can subscribe to these events and react.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Event topic using dot-delimited segments (e.g., app.epic.apis.createorder.error). The "app." prefix is auto-added if omitted. |
| data | object | No | Event payload — any structured data relevant to the event. |
| source | string | No | Source identifier (agent name, workflow type, or free-form label). |

### list_subscriptions

List all active agent event subscriptions, optionally filtered by topic pattern.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | No | Optional topic pattern to filter subscriptions. |

### list_topics

Browse the topic catalog to discover available event topics, their descriptions, payload schemas, and subscriber counts.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| category | string | No | Filter by category (task, workflow, escalation, activity, knowledge, agent, app, milestone). |
| search | string | No | Search topics by name or description. |
| limit | number | No | Max results (default 50). |

### register_topic

Declare a topic in the catalog with its description and payload schema. Use this to pre-register topics before first publish so other agents can discover them.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Topic name (e.g., app.vendor.orders.created). |
| description | string | No | Human-readable description of the event. |
| category | string | No | Category (defaults to first segment or "app"). |
| payload_schema | object | No | JSON Schema describing the event.data shape. |
| tags | string[] | No | Tags for filtering. |
