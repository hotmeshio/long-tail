# lt.escalations

Manage human-in-the-loop escalations -- list, claim, resolve, and bulk-operate on workflow escalations.

## create

Create an escalation. The caller must hold the target role or be a superadmin.

```typescript
const result = await lt.escalations.create({
  type: 'approval',
  role: 'reviewer',
  description: 'Review deployment to production',
  metadata: {
    form_schema: {
      properties: {
        approved: { type: 'boolean', default: false, description: 'Approve?' },
        environment: { type: 'string', enum: ['staging', 'production'] },
        api_key: { type: 'string', format: 'password', description: 'Deploy key' },
      },
    },
  },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Escalation category |
| `role` | `string` | Yes | Target role for the reviewer queue |
| `subtype` | `string` | No | Subcategory (defaults to `type`) |
| `description` | `string` | No | Human-readable reason |
| `priority` | `number` | No | 1 (highest) to 4 (lowest), default: 2 |
| `envelope` | `string` | No | JSON-serialized workflow envelope |
| `metadata` | `object` | No | Arbitrary metadata; include `form_schema` for typed resolver forms |
| `escalation_payload` | `string` | No | JSON context data shown to the reviewer |

**Returns:** `LTApiResult<Escalation>` with status 201.

**Auth:** Required (RBAC enforced)

---

## list

List escalations with optional filters, scoped to the authenticated user's roles.

```typescript
const result = await lt.escalations.list({
  status: 'pending',
  role: 'reviewer',
  limit: 25,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | No | Filter by `pending`, `resolved`, or `cancelled` |
| `role` | `string` | No | Filter by assigned role |
| `type` | `string` | No | Filter by workflow type |
| `subtype` | `string` | No | Filter by subtype |
| `assigned_to` | `string` | No | Filter by assigned user ID |
| `priority` | `number` | No | Filter by priority (1--4) |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |
| `sort_by` | `string` | No | Column to sort by (e.g. `created_at`, `priority`) |
| `order` | `string` | No | `asc` or `desc` |

**Returns:** `LTApiResult<{ escalations, total }>`

**Auth:** Required

---

## listAvailable

List escalations available for claim (pending and not actively claimed).

```typescript
const result = await lt.escalations.listAvailable({
  role: 'reviewer',
  limit: 10,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | No | Filter by role |
| `type` | `string` | No | Filter by workflow type |
| `subtype` | `string` | No | Filter by subtype |
| `priority` | `number` | No | Filter by priority (1--4) |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |
| `sort_by` | `string` | No | Column to sort by |
| `order` | `string` | No | `asc` or `desc` |

**Returns:** `LTApiResult<{ escalations, total }>`

**Auth:** Required

---

## listTypes

List all distinct escalation type values.

```typescript
const result = await lt.escalations.listTypes();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ types: string[] }>`

**Auth:** Not required

---

## getStats

Get aggregate escalation statistics scoped to the user's roles.

```typescript
const result = await lt.escalations.getStats({ period: '24h' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `period` | `string` | No | Time window (`1h`, `24h`, `7d`, `30d`) |

**Returns:** `LTApiResult<{ pending, claimed, created, resolved, by_role, by_type }>`

**Auth:** Required

---

## get

Get a single escalation by ID.

```typescript
const result = await lt.escalations.get({ id: 'esc_123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |

**Returns:** `LTApiResult<Escalation>` -- returns 403 if user lacks the role, 404 if not found.

**Auth:** Required

---

## getByWorkflowId

List all escalations for a given workflow ID.

```typescript
const result = await lt.escalations.getByWorkflowId({ workflowId: 'wf_abc' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | HotMesh workflow ID |

**Returns:** `LTApiResult<{ escalations }>`

**Auth:** Not required

---

## escalate

Route a pending escalation to a different role.

```typescript
const result = await lt.escalations.escalate({
  id: 'esc_123',
  targetRole: 'senior-reviewer',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |
| `targetRole` | `string` | Yes | Destination role |

**Returns:** `LTApiResult<Escalation>` -- returns 403 if not authorized, 404 if not found, 409 if not pending.

**Auth:** Required

---

## claim

Claim a pending escalation for the authenticated user.

```typescript
const result = await lt.escalations.claim({
  id: 'esc_123',
  durationMinutes: 60,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |
| `durationMinutes` | `number` | No | Claim duration (default: 30) |

**Returns:** `LTApiResult<{ escalation, isExtension }>` -- returns 403 if user lacks the role, 404 if not found, 409 if not available.

**Auth:** Required

---

## release

Release a claimed escalation back to the pool.

```typescript
const result = await lt.escalations.release({ id: 'esc_123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |

**Returns:** `LTApiResult<{ escalation }>` -- returns 409 if not claimed by the caller.

**Auth:** Required

---

## resolve

Resolve a pending escalation with a human-provided payload.

Supports two resolution paths: signal-routed (sends payload to a paused workflow) and re-run (restarts the workflow with resolver data injected). Password fields are replaced with ephemeral tokens.

```typescript
const result = await lt.escalations.resolve({
  id: 'esc_123',
  resolverPayload: { approved: true, comment: 'Looks good' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |
| `resolverPayload` | `Record<string, any>` | Yes | Human decision data |

**Returns:** `LTApiResult<{ signaled, escalationId, workflowId }>` (signal path) or `LTApiResult<{ started, escalationId, workflowId }>` (re-run path) -- returns 404 if not found, 409 if not pending.

**Auth:** Required

---

## conditionLT (workflow helper)

Wait for a signal and automatically resolve the associated escalation. This is the counterpart to `executeLT` — where `executeLT` wraps `startChild` + `condition`, `conditionLT` wraps `condition` + escalation resolution.

```typescript
import { conditionLT } from '@hotmeshio/long-tail';

export async function myWorkflow(envelope: LTEnvelope) {
  const signalId = `approval-${Durable.workflow.workflowId}`;

  // Create escalation with signal_id in metadata
  await activities.ltCreateEscalation({
    type: 'approval',
    role: 'reviewer',
    workflow_id: Durable.workflow.workflowId,
    workflow_type: 'myWorkflow',
    task_queue: 'my-queue',
    metadata: {
      signal_id: signalId,
      form_schema: {
        properties: {
          approved: { type: 'boolean', default: false },
          notes: { type: 'string', default: '' },
        },
      },
    },
    envelope: JSON.stringify(envelope),
  });

  // Pause — dashboard signals on resolve
  const decision = await conditionLT<{ approved: boolean; notes: string }>(signalId);
  // decision is clean: { approved: true, notes: "..." }
  // $escalation_id was stripped and the escalation was resolved via durable activity
}
```

**How it works:**

1. The workflow creates an escalation with `metadata.signal_id` pointing to its own signal key
2. The workflow calls `conditionLT(signalId)` and pauses
3. A reviewer claims and resolves the escalation in the dashboard
4. The resolve API injects `$escalation_id` into the payload and signals the workflow
5. `conditionLT` receives the signal, strips `$escalation_id`, calls `ltResolveEscalation` as a durable activity, and returns the clean payload

The escalation resolution happens inside the workflow as a durable activity — crash-safe and transactional within the workflow's execution context.

If you use raw `Durable.workflow.condition()` instead, the `$escalation_id` field will be present in the payload and you are responsible for resolving the escalation yourself.

---

## Resolver form schemas

When a reviewer claims an escalation in the dashboard, a typed form is rendered instead of a raw JSON editor — if a schema is available. There are two ways to provide one:

**Option 1 — Workflow config (static):** Set `resolver_schema` in the workflow registry wizard (Step 3, Certification). Every escalation from that workflow inherits the schema.

**Option 2 — Escalation metadata (dynamic):** Pass `form_schema` inside `metadata` when creating an escalation. This overrides any workflow-level schema.

### Schema shape

```typescript
{
  properties: {
    fieldName: {
      type: 'string',         // inferred from default value at runtime
      default: 'initial',     // pre-fills the form field
      description: 'Helper',  // text below the label
      enum: ['a', 'b'],       // renders a dropdown select
      format: 'password',     // masks input; stored as 15-min ephemeral token
    },
  },
}
```

### Field rendering by type

| Default value | Renders as |
|--------------|------------|
| `boolean` | Checkbox |
| `number` | Number input |
| `string` (short) | Text input |
| `string` (>80 chars) | Textarea |
| `string` + `enum` | Dropdown |
| `string` + `format: "password"` | Password input (ephemeral token on resolve) |
| `object` | Nested section with recursive fields |
| `array` | Read-only tag list |

### Hidden fields

Keys prefixed with `_` are stored in the payload but hidden from the form. `_form_schema` is reserved for round-trip schema access.

### Priority

`metadata.form_schema` takes precedence over `resolver_schema` from the workflow config.

---

## releaseExpired

Release all escalation claims past their `assigned_until` deadline.

```typescript
const result = await lt.escalations.releaseExpired();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ released: number }>`

**Auth:** Not required

---

## updatePriority

Update priority for one or more escalations.

```typescript
const result = await lt.escalations.updatePriority({
  ids: ['esc_1', 'esc_2'],
  priority: 1,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Array of escalation UUIDs |
| `priority` | `number` | Yes | New priority (1=critical, 2=high, 3=medium, 4=low) |

**Returns:** `LTApiResult<{ updated: number }>`

**Auth:** Required

---

## bulkClaim

Claim multiple escalations at once for the authenticated user.

```typescript
const result = await lt.escalations.bulkClaim({
  ids: ['esc_1', 'esc_2'],
  durationMinutes: 60,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Array of escalation UUIDs |
| `durationMinutes` | `number` | No | Claim duration (default: 30) |

**Returns:** `LTApiResult<{ claimed, skipped }>`

**Auth:** Required

---

## bulkAssign

Assign multiple escalations to a specific user.

```typescript
const result = await lt.escalations.bulkAssign({
  ids: ['esc_1', 'esc_2'],
  targetUserId: 'user_456',
  durationMinutes: 60,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Array of escalation UUIDs |
| `targetUserId` | `string` | Yes | User to assign to |
| `durationMinutes` | `number` | No | Assignment duration (default: 30) |

**Returns:** `LTApiResult<{ assigned, skipped }>`

**Auth:** Required

---

## bulkEscalate

Route multiple escalations to a different role.

```typescript
const result = await lt.escalations.bulkEscalate({
  ids: ['esc_1', 'esc_2'],
  targetRole: 'senior-reviewer',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Array of escalation UUIDs |
| `targetRole` | `string` | Yes | Destination role |

**Returns:** `LTApiResult<{ updated: number }>`

**Auth:** Required

---

## bulkTriage

Trigger AI triage for multiple escalations.

Resolves each escalation and starts a triage workflow that uses MCP tools to analyze and potentially auto-resolve the issue.

```typescript
const result = await lt.escalations.bulkTriage({
  ids: ['esc_1', 'esc_2'],
  hint: 'Check if the content violates policy section 3.2',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Array of escalation UUIDs |
| `hint` | `string` | No | Natural-language guidance for the triage AI |

**Returns:** `LTApiResult<{ triaged, workflows }>`

**Auth:** Required
