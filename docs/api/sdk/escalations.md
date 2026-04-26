# lt.escalations

Manage human-in-the-loop escalations -- list, claim, resolve, and bulk-operate on workflow escalations.

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
