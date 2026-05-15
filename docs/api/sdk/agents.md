# lt.agents

Agent operations — create, configure, and manage autonomous event-driven agents.

## list

List agents with optional filters.

```typescript
const result = await lt.agents.list({ status: 'active', limit: 25 });
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | `string` | No | Filter: `active`, `inactive`, `paused`, `error` |
| `knowledge_domain` | `string` | No | Filter by knowledge domain |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<{ agents: LTAgent[], total: number }>`

Each agent includes `subscription_count` and `sub_topics[]` from a JOIN on `lt_agent_subscriptions`.

## get

Get a single agent with stats.

```typescript
const result = await lt.agents.get({ id: 'uuid' });
```

**Returns:** `LTApiResult<LTAgent & { stats: LTAgentStats }>`

## create

Create an agent.

```typescript
const result = await lt.agents.create({
  name: 'health-monitor',
  description: 'Watches for workflow failures',
  goals: 'Detect failures early',
  rules: 'Never auto-restart',
  status: 'active',
  knowledge_domain: 'system-health',
  behaviors: {
    schedules: [
      { cron: '*/5 * * * *', workflow_type: 'basicEcho' },
    ],
  },
});
```

**Returns:** `LTApiResult<LTAgent>`

## update

Partial update. Changing `status` or `behaviors` automatically restarts event subscriptions and cron schedules.

```typescript
await lt.agents.update({ id: 'uuid', status: 'paused' });
```

**Returns:** `LTApiResult<LTAgent>`

## delete

Delete an agent. Stops subscriptions and schedules. Knowledge and workflow history preserved.

```typescript
await lt.agents.delete({ id: 'uuid' });
```

**Returns:** `LTApiResult<{ deleted: true }>`

## listSubscriptions

List event subscriptions for an agent.

```typescript
const result = await lt.agents.listSubscriptions({ agentId: 'uuid' });
```

**Returns:** `LTApiResult<{ subscriptions: AgentSubscription[] }>`

## createSubscription

Create an event subscription.

```typescript
const result = await lt.agents.createSubscription({
  agentId: 'uuid',
  topic: 'workflow.failed',
  reaction_type: 'durable',
  workflow_type: 'basicEcho',
  input_mapping: {
    data: { error: '{event.status}', workflowId: '{event.workflowId}' },
  },
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agentId` | `string` | Yes | Agent ID |
| `topic` | `string` | Yes | Event topic pattern (`*` = one token, `>` = rest) |
| `reaction_type` | `string` | Yes | `durable`, `pipeline`, or `mcp_query` |
| `workflow_type` | `string` | For durable | Workflow name |
| `pipeline_id` | `string` | For pipeline | YAML workflow UUID |
| `mcp_prompt` | `string` | For mcp_query | Query prompt |
| `input_mapping` | `object` | No | Event-to-envelope field mapping |
| `filter` | `object` | No | Shallow match against `event.data` |
| `execute_as` | `string` | No | Identity override |

**Returns:** `LTApiResult<AgentSubscription>`

## updateSubscription

Partial update of a subscription.

```typescript
await lt.agents.updateSubscription({
  agentId: 'uuid',
  subId: 'uuid',
  topic: 'app.vendor.*.error',
});
```

**Returns:** `LTApiResult<AgentSubscription>`

## deleteSubscription

Delete a subscription.

```typescript
await lt.agents.deleteSubscription({ agentId: 'uuid', subId: 'uuid' });
```

**Returns:** `LTApiResult<{ deleted: true }>`
