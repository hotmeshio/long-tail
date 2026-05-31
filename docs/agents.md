# Agent Automations

## What is an agent automation?

An agent automation is an autonomous persona that reacts to events and takes action on your behalf. When an event happens, it runs a workflow with the right context — automatically, reliably, at scale.

Every automation has:

- **Identity** — a name, a purpose, and optionally a service account it runs as
- **Motivation** — goals that drive it and rules that constrain it
- **Subscriptions** — event topics it listens to and the workflows it triggers in response
- **Knowledge** — a domain where it accumulates context over time
- **Schedule** — one or more cron expressions for periodic work

## The mental model

Agents don't poll. They subscribe to the event bus and react instantly when something happens. A workflow fails? The health-monitor agent detects it. A new support ticket arrives? The triage agent routes it. Schema drift breaks an API? The repair agent fixes it and publishes a "repaired" event that other agents can act on.

This is **event-driven automation**. The event bus is the nervous system. Agents are the reflexes.

## identity

Give your agent a name and describe what it does. Names are lowercase kebab-case and appear everywhere — in the sidebar, in event payloads, in logs.

The **run as** identity controls which service account the agent uses when invoking workflows. This determines what credentials, OAuth tokens, and permissions are available. If unset, workflows run as the invoking user.

## motivation

Goals and rules define the agent's character.

**Goals** are the agent's primary motivation — what it's trying to achieve. When the agent reacts to an event, its goals inform whether and how it should act. Example: *"Detect failures early, capture diagnostics, and alert before cascading issues."*

**Rules** are guardrails — what the agent must never do, even when its goals suggest it should. Example: *"Never auto-restart failed workflows. Always capture state and escalate to a human."*

An agent without motivation is pure automation. An agent with motivation has judgment.

## knowledge

Assign a knowledge domain — the agent's memory. It stores context here over time.

Knowledge domains are shared — multiple agents can read from the same domain. But typically one agent owns a domain and accumulates into it, while others read from it.

Existing domains appear as suggestions. Type a new name to create a fresh domain.

## subscriptions

This is the heart of the agent. Each subscription wires an event to a workflow: when this happens, do that.

### Topic patterns

Topics are dot-delimited strings. The event bus uses NATS-style wildcards for pattern matching:

| Pattern | Matches | Example |
|---------|---------|---------|
| `workflow.failed` | Exact match only | Only `workflow.failed` |
| `app.vendor.*.error` | `*` matches exactly one token | `app.vendor.orders.error`, `app.vendor.users.error` |
| `app.>` | `>` matches one or more remaining tokens | `app.vendor.orders.error`, `app.billing.invoice.generated`, any `app.*` |
| `escalation.*` | Any escalation event | `escalation.created`, `escalation.resolved`, `escalation.claimed` |

The `*` wildcard matches a single dot-separated segment. The `>` wildcard matches everything after it — it must be the last segment in the pattern.

### System events

These are emitted automatically by the platform:

- **Task**: `task.created` · `task.started` · `task.completed` · `task.escalated` · `task.failed`
- **Workflow**: `workflow.started` · `workflow.completed` · `workflow.failed`
- **Escalation**: `escalation.created` · `escalation.claimed` · `escalation.released` · `escalation.resolved`
- **Activity**: `activity.started` · `activity.completed` · `activity.failed`
- **Knowledge**: `knowledge.stored` · `knowledge.deleted`
- **Agent**: `agent.started` · `agent.completed` · `agent.failed` · `agent.status_changed`

### Application events

User-defined events published via the `publish_event` tool. Convention: `app.{namespace}.{entity}.{action}`:

- `app.vendor.orders.sync`
- `app.vendor.schema.drift`
- `app.support.ticket.created`
- `app.billing.invoice.generated`

Any workflow or agent can publish events. Any agent can subscribe.

### Reactions

When an event matches, the agent invokes one of three workflow types:

- **Durable workflow** — a registered TypeScript workflow. Reliable, transactional, supports human-in-the-loop.
- **Pipeline** — a compiled YAML DAG. Deterministic, no AI cost, sub-second execution.
- **MCP Query** — a dynamic AI-driven tool sequence. Flexible, exploratory, uses the agent's capabilities.

### Input mapping

Maps event fields to the workflow's input envelope using `{event.field}` templates:

```json
{
  "data": {
    "orderId": "{event.data.orderId}",
    "error": "{event.data.error}",
    "source": "{event.source}"
  }
}
```

Templates resolve at runtime. `{event.data.orderId}` becomes the actual orderId from the event payload.

### Distributed safety

When multiple containers run in parallel, every container receives every published event. Without coordination, a subscription would fire the same workflow N times — once per container. The system prevents this with **deterministic workflow IDs** and **HotMesh's idempotent start**.

#### How it works

1. **Each container** receives the event through its `CallbackEventAdapter`.
2. **Each container** independently computes a deterministic workflow ID from the event:

```
agent-{agentId}-{subscriptionId[0:8]}-{eventKey}
```

The `eventKey` is derived from the event's originating workflow ID, task ID, or escalation ID when available. For custom application events (which don't carry these IDs), the system hashes the event timestamp + type + payload to produce a stable 12-character key.

3. **Each container** calls `Durable.Client.workflow.start({ workflowId })` with this ID.
4. **HotMesh rejects duplicates** — the first container to reach the durable engine wins. All others receive a "Duplicate job" error, which is caught and silently ignored.

The result: exactly one workflow execution per event, regardless of container count.

#### Comparison with cron

Cron schedules use a different mechanism. `Virtual.cron()` is a durable HotMesh construct that uses JetStream consumer groups internally. Only one container picks up each tick — the deduplication happens at the scheduling layer, not the invocation layer. The callback executes on exactly one container per tick.

#### What's NOT deduplicated

Agent lifecycle events (`agent.started`, `agent.completed`) are still emitted by every container that processes the event. These are observability side effects, not workflow state — duplicate lifecycle events are harmless and expected.

#### Custom application events

When publishing custom events from your workflows (e.g., `app.orders.created`), include a stable identifier in `event.data` whenever possible. The deterministic ID derivation uses `event.workflowId` first, but for custom events published outside a workflow context, the system falls back to hashing the full payload. If two events have identical payloads and timestamps, they produce the same hash — which is correct (same event, same reaction) but worth understanding.

### Filters

Optional shallow key-value match against `event.data`. The subscription only fires when all filter keys match. Example: `{"status": 422}` only fires for events where `event.data.status === 422`.

### Topic catalog

The [Topic Catalog](topics.md) is a persistent registry of all known topics. Browse it in the dashboard at `/topics` to see every topic with its description, payload schema, and active subscribers. When creating subscriptions, the topic field shows a searchable dropdown from the catalog with schema previews — so you know what `{event.data.*}` fields are available for input mapping.

Topics can be declared in code via `startConfig.topics[]`, auto-discovered at runtime, or registered manually through the API. See [Topics](topics.md) for the full guide.

## schedule

Agents can run on one or more cron schedules. Each schedule targets a specific workflow with a static envelope payload.

An agent can be:
- **Purely event-driven** — no schedules, only subscriptions
- **Purely scheduled** — no subscriptions, only cron
- **Both** — reacts to events and runs periodic tasks

### Cron expressions

Standard 5-field cron (UTC):

| Pattern | Meaning |
|---------|---------|
| `*/5 * * * *` | Every 5 minutes |
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Hourly |
| `0 */4 * * *` | Every 4 hours |
| `0 7 * * *` | Daily at 7:00 AM UTC |
| `0 9 * * 1-5` | Weekdays at 9:00 AM UTC |
| `0 0 * * 1` | Weekly on Monday at midnight UTC |

### Pausing and resuming

When an agent is paused:
- All event subscriptions are stopped — the agent no longer reacts to events
- All cron schedules are stopped — timed workflows no longer fire
- Knowledge and workflow history are preserved
- The agent can be reactivated at any time, which re-arms all subscriptions and schedules

## Examples

### Content triage automation
Monitors content review escalations. Subscribes to `escalation.created` filtered by `reviewContent`. Auto-resolves low-confidence items. Runs every 15 minutes to catch stragglers. Knowledge domain: `content-review`.

### Health monitor automation
Subscribes to `workflow.failed`, `activity.failed`, `app.*.*.error`, and `task.failed`. Captures diagnostics into `system-health` knowledge. Runs hourly for proactive checks. Rules: never auto-restart — capture and escalate.

### Event coordinator automation
Subscribes to `app.>` (all application events), `workflow.completed`, `knowledge.stored`, and `escalation.resolved`. Routes events to appropriate workflows. Purely event-driven — no schedule.

## What makes agent automations different from workflows?

A workflow is a sequence of steps. An agent automation is a persona that *uses* workflows. The automation decides *when* to run, *what* to run, and *why*. It has goals, rules, memory, and reactive wiring. The workflow is the tool. The automation is the motivation.
