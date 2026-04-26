# lt.events

Subscribe to real-time Long Tail events via in-process callbacks.

## on

Subscribe to events by type pattern. Returns an unsubscribe function.

```typescript
// Exact event type
const unsub = lt.events.on('escalation.claimed', (event) => {
  console.log('claimed:', event.escalationId);
});

// Category wildcard — all task events
const unsub2 = lt.events.on('task.*', (event) => {
  console.log('task event:', event.type);
});

// Global wildcard — every event
const unsub3 = lt.events.on('*', (event) => {
  console.log(event.type, event.workflowId);
});

// Unsubscribe when done
unsub();
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | `LTEventType \| '*' \| string` | Yes | Event type to match |
| `callback` | `(event: LTEvent) => void` | Yes | Handler invoked for each matching event |

**Pattern matching:**

| Pattern | Matches |
|---------|---------|
| `'task.created'` | Exact match on `task.created` only |
| `'task.*'` | All events starting with `task.` (e.g. `task.created`, `task.completed`, `task.failed`) |
| `'*'` | Every event |

**Returns:** `() => void` -- call the returned function to unsubscribe.

**Auth:** Not required

---

### LTEventType values

`task.created`, `task.started`, `task.completed`, `task.escalated`, `task.failed`, `escalation.created`, `escalation.resolved`, `escalation.claimed`, `escalation.released`, `workflow.started`, `workflow.completed`, `workflow.failed`, `activity.started`, `activity.completed`, `activity.failed`, `milestone`

### LTEvent fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `LTEventType \| string` | Event classification |
| `source` | `string` | Origin: `'interceptor'`, `'orchestrator'`, or `'activity'` |
| `workflowId` | `string` | The workflow instance that produced this event |
| `workflowName` | `string` | The workflow function name |
| `taskQueue` | `string` | The task queue the workflow ran on |
| `taskId` | `string?` | The task ID (present when orchestrated) |
| `escalationId` | `string?` | The escalation ID (present for escalation events) |
| `originId` | `string?` | Root process lineage |
| `status` | `string?` | Task or workflow status after this event |
| `data` | `Record<string, unknown>?` | Event-specific payload |
| `timestamp` | `string` | ISO 8601 timestamp |
