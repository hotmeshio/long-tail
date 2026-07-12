# lt.escalations

Manage human-in-the-loop escalations -- list, claim, resolve, and bulk-operate on workflow escalations.

## Work-Surface Scope

Escalation methods enforce the caller's role work-surface scope server-side; the SDK method signatures are unchanged. For a `member`:

- `read_scope` governs **search** — `list`, `listAvailable`, `findByMetadata`, `getStats`, and a single `get` return only the escalations the member is allowed to see. `read_scope=self` limits this to items assigned to the member; `read_scope=all` exposes the whole role queue.
- `write_scope` governs **claim / ack (resolve) / delete (cancel)** — a member with `write_scope=self` may only `claim`, `resolve`, and `cancel` items already assigned to them. `release`, `escalate`, and `create` (standalone) are queue-management verbs and require `write_scope=all`.

`admin` and `superadmin` ignore scope and act on the whole queue. Scope is set when a role is assigned — see [`lt.users.addRole`](users.md) and [Roles API — Work-Surface Scope](../http/roles.md).

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

// Faceted query — a "facet" is a key/value INSIDE the row's metadata JSONB. The
// filter AND the count run in SQL, role-scoped; nothing is filtered client-side.
const faceted = await lt.escalations.list({
  status: 'pending',
  facets: { flags: 'too_short' },                  // metadata @> { flags: 'too_short' }
  range: [{ facet: 'confidence', op: '<=', value: 0.7 }],
  block: [{ outcome: 'success' }],                 // exclude completed
  exists: ['needsReview'],
  orderBy: [{ field: 'metadata.confidence', numeric: true, direction: 'asc' }],
  limit: 50,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | No | Filter by `pending`, `resolved`, `cancelled`, or `expired` |
| `role` | `string` | No | Filter by assigned role |
| `roles` | `string[]` | No | Restrict to these roles (`role = ANY`) — narrows within the caller's scope, never widens past it |
| `type` | `string` | No | Filter by workflow type |
| `subtype` | `string` | No | Filter by subtype |
| `assigned_to` | `string` | No | Filter by assigned user ID |
| `priority` | `number` | No | Filter by priority (1--4) |
| `facets` | `Record<string, any>` | No | Required metadata facets — `metadata @> facets` (AND, GIN-served). `{ k: v }` means `metadata.k == v` for a top-level scalar; for nested/arrays it is JSONB **containment** |
| `block` | `Record<string, any>[]` | No | Exclude rows whose metadata contains ANY of these facet sets — `NOT (metadata @> ANY(block))` |
| `range` | `{ facet, op, value }[]` | No | Numeric range over a metadata facet, e.g. `{ facet: 'confidence', op: '<=', value: 0.7 }` |
| `exists` | `string[]` | No | Metadata keys that must be present — `metadata ? key` |
| `available` | `boolean` | No | `true` = unclaimed/expired only; `false` = held now |
| `search` | `string` | No | Exact-match by correlation id — escalation id, workflow id, or origin id (index-served). To match a value inside metadata, use `facets` instead |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |
| `sort_by` | `string` | No | Column to sort by (e.g. `created_at`, `priority`) |
| `order` | `string` | No | `asc` or `desc` |
| `orderBy` | `{ field, direction?, numeric? }[]` | No | Multi-key sort over columns or a metadata path written `metadata.<key>` (set `numeric` for numeric sort) |

When any faceted element (`facets`/`block`/`range`/`exists`/`roles`/`available`/`orderBy`) is
present the request runs through the scoped faceted query; otherwise the simple list path is used.
See [Faceted Routing — the human / operations query](../../faceted-routing.md#the-human--operations-query).

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

Also accepts the same faceted parameters as [`list`](#list) (`facets`, `block`, `range`,
`exists`, `roles`, `orderBy`), pinned to the available pool.

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
  metadata: { outcome: 'approved', reviewedBy: 'alice', durationMs: 1_240 },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |
| `resolverPayload` | `Record<string, any>` | Yes | Human decision data — resumes the paused workflow; not indexed |
| `metadata` | `Record<string, any>` | No | Outcome facets merged into the row's GIN-indexed metadata. Records *what happened* (disposition, timing) next to *what was asked*; `@>`-queryable. See [Recording the outcome](#recording-the-outcome-on-resolve) |

**Returns:** `LTApiResult<{ signaled, escalationId, workflowId }>` (signal path) or `LTApiResult<{ started, escalationId, workflowId }>` (re-run path) -- returns 404 if not found, 409 if not pending.

**Auth:** Required

---

## Recording the outcome on resolve

Every resolve path — `resolve`, `resolveBySignalKey`, the HTTP routes, the MCP tools, and the
in-process `EscalationService.resolveEscalation` — takes an optional `metadata` patch. It is
merged, not replaced, into the row's GIN-indexed metadata, recording the **outcome** on the
same row that carried the **intent**.

```typescript
await lt.escalations.resolve({
  id: 'esc_123',
  resolverPayload: { approved: true },           // resumes the workflow; not indexed
  metadata: { outcome: 'approved', durationMs: 1_240 }, // recorded on the row; @>-queryable
});
```

The patch is distinct from `resolverPayload`: the payload is delivered to the waiting workflow
as `condition()`'s return value; the patch is the durable, queryable record. Intent and
outcome live on one row — no side table:

```typescript
await lt.escalations.findByMetadata({ key: 'outcome', value: 'approved' });
// every resolved row that was approved — with its disposition and duration
```

The in-process library takes the same patch as a third argument:
`resolveEscalation(id, payload, metadata)` and `resolveEscalationBySignalKey(signalKey, payload, metadata)`.

---

## conditionLT (workflow helper)

Wait for a signal and automatically resolve the associated escalation. This is the counterpart to `executeLT` — where `executeLT` wraps `startChild` + `condition`, `conditionLT` wraps `condition` + escalation resolution.

```typescript
conditionLT<T>(signalId: string, escalation?: ConditionQueueConfig): Promise<T | false | null>
```

### Two ways to pause on an escalation

There are two ways to make a workflow pause as a claimable escalation, and they are not equivalent in cost:

- **Native `condition(signalId, escalationConfig)` — the efficient primitive.** HotMesh's `condition` takes an optional escalation config as its second argument. The row is written inside the workflow's Leg1 checkpoint, with `signal_key = signalId`. Resolving it (`resolve` / `resolveBySignalKey`) marks the row resolved **and** delivers the signal in one guarded transaction, resuming the job in place. No create activity, no enrich step, and **no proxy-activity round-trip on the resume** — the resolve is the whole transaction. This is the path to prefer.

- **`conditionLT(signalId, config?)` — long-tail sugar.** With a config it delegates to the native efficient `condition` above (same atomic behavior — use it freely). Without a config it also supports the older **two-step** pattern: an escalation created separately, where the resume injects `$escalation_id` and `conditionLT` resolves it through a durable `proxyActivity` (`ltResolveEscalation`). That extra activity round-trip is the cost of the two-step form; the efficient form (and native `condition`) avoid it.

Reach for native `condition(signalId, config)` when you want the leanest path; reach for `conditionLT` for the ergonomic wrapper or to support the legacy two-step flow. Both resume the same row, and both accept the resolve-time `metadata` patch (the efficient path merges it in the single guarded UPDATE; the two-step path forwards it through `ltResolveEscalation` into that same atomic resolve).

### Atomic form (recommended)

Pass an escalation config as the second argument. The escalation row is written inside the workflow's Leg1 checkpoint — one commit, crash-safe: no separate `ltCreateEscalation` activity, no enrich step. `signal_key` is set to `signalId`, so the dashboard resolve endpoint (resolve-by-id → Path 0) and `POST /escalations/resolve-by-signal-key` resume *this* job in place, and `system.escalation.{id}.created` fires automatically.

`conditionLT` returns `T | false | null`:
- `T` — the resolver's payload (normal resolution)
- `false` — the SLA timer fired first (`config.timeout`); the row is now `status='expired'`
- `null` — the escalation was cancelled (workflow terminated or explicit `POST /api/escalations/:id/cancel`)

Always guard for `null` and `false` before accessing the payload:

```typescript
import { conditionLT } from '@hotmeshio/long-tail';

export async function stationWorker(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `station-done-${ctx.workflowId}`;

  const decision = await conditionLT<{ approved: boolean }>(signalId, {
    role: 'qc-inspector',
    type: 'orderPipeline',
    subtype: 'qc',
    priority: 2,
    description: 'Inspect the order and approve',
    workflowType: 'stationWorker',
    metadata: { orderId: envelope.data.orderId, station: 'qc' },
    envelope: { instructions: 'Review and approve or reject' },
    timeout: '24h',   // SLA for this worklist row (hotmesh 0.25.1+)
  });

  if (decision === false) {
    // SLA passed: the workflow resumed on the timer and the engine transitioned
    // the row pending → expired atomically. A late resolve returns
    // already-expired, and system.escalation.{id}.expired fired for dashboards.
    return { type: 'return' as const, data: { autoRejected: 'sla' } };
  }
  if (decision === null) {
    return { type: 'return' as const, data: { cancelled: true } };
  }
  // decision is clean — the escalation was resolved by the resolve endpoint
}
```

### SLA-gated waits (`timeout`)

`ConditionQueueConfig.timeout` (hotmesh 0.25.1+) arms the same resume timer as
`condition(signalId, '24h')` **in the same single Leg1 write** that creates the
escalation row. The race is resolved atomically on both sides: a signal that
arrives first resolves the row normally and the timer is inert; a timer that
fires first resumes the workflow with `false` and expires the row in a guarded
UPDATE, so operators can never resolve into a workflow that already moved on.
`expiresAt`, by contrast, is display metadata on the row — it arms nothing.

### Two-step form

Create the escalation first (e.g. to enrich routing metadata), then wait:

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

  if (!decision) {
    // null = cancelled, false = timeout
    return { type: 'return' as const, data: { cancelled: true } };
  }
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

**Option 1 — Role `form_schema` (versioned):** The escalation form is owned by the target role as a versioned `form_schema`. A workflow pins a version through `conditionLT`'s `schemaVersion`; unpinned escalations resolve against the role's latest. Fields may carry `x-lt-bind` to map a form value to a path in the resolver payload. The deprecated workflow-config `resolver_schema` remains only as a legacy fallback.

**Option 2 — Escalation metadata (dynamic):** Pass `form_schema` inside `metadata` when creating an escalation. This overrides any role-level schema.

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

The form is resolved by precedence: `metadata.form_schema` (legacy inline on the row) > the role's `form_schema` (resolved to the escalation's pinned `metadata.schema_version`, or the role's latest when unpinned) > the deprecated workflow-config `resolver_schema` legacy fallback.

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

Rows backing a live `condition()` waiter (`signal_key` set) stay `pending` and are excluded from `triaged` — their resolution must carry the workflow's wake, which only the targeted `resolve` delivers. Settle those individually with `resolve` or `cancel`.

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

---

## cancel

Permanently cancel a pending or claimed escalation. The workflow waiting on `conditionLT` receives `null`.

```typescript
const result = await lt.escalations.cancel({ id: 'esc_123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Escalation UUID |

**Returns:** `LTApiResult<{ escalation }>` — 404 if not found, 409 if already terminal.

**Auth:** Required (admin or superadmin for the escalation's role)

---

## bulkCancel

Cancel multiple escalations at once. Skips any already in a terminal state.

```typescript
const result = await lt.escalations.bulkCancel({
  ids: ['esc_1', 'esc_2'],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Array of escalation UUIDs |

**Returns:** `LTApiResult<{ cancelled: number; skipped: number }>`

**Auth:** Required (admin or superadmin for the escalation roles)

---

## findByMetadata

Find escalations by a metadata key-value pair. Uses JSONB containment backed by a GIN index.

```typescript
const result = await lt.escalations.findByMetadata({
  key: 'orderId',
  value: 'order-123',
  status: 'pending',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Metadata field name |
| `value` | `string` | Yes | Metadata field value |
| `status` | `string` | No | Filter by status |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<{ escalations, total }>`

**Auth:** Required (RBAC-scoped to visible roles)

---

## claimByMetadata

Find and claim an escalation by metadata key-value pair in one atomic call. RBAC is enforced in the SQL WHERE clause.

```typescript
const result = await lt.escalations.claimByMetadata({
  key: 'orderId',
  value: 'order-123',
  durationMinutes: 30,
  assignee: 'jane.doe',
  metadata: { claimedBy: 'jimbo', station: 'scanning' },
  provisionIfAbsent: {
    displayName: 'Jane Doe',
    email: 'jane@example.com',
    roles: [{ role: 'station-operator', type: 'member' }],
  },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Metadata field name |
| `value` | `string` | Yes | Metadata field value |
| `durationMinutes` | `number` | No | Claim duration (default: 30) |
| `assignee` | `string` | No | Claim as a Long Tail user (resolved via `getUserByExternalId`) |
| `metadata` | `object` | No | Merge into escalation metadata (single atomic SQL call with the claim) |
| `provisionIfAbsent` | `object` | No | JIT-provision the assignee if they don't exist or lack the required role (superadmin only) |

`provisionIfAbsent` accepts `{ displayName?, email?, roles?: [{ role, type?, read_scope?, write_scope? }] }`. Each role entry forwards the optional work-surface scope fields `read_scope` (`self` or `all`, default `all`) and `write_scope` (`none`, `self`, or `all`, default `all`), subject to the **write ⊆ read** constraint; scope is ignored for `admin`/`superadmin`. To JIT-provision a one-time user who sees and acts on exactly the item being claimed, provision them `read_scope: 'self'` + `write_scope: 'self'`. Only callers with global escalation access can use this flag. The happy path (user exists, has role) adds zero extra queries.

**Returns:** `LTApiResult<{ escalation, isExtension }>` -- 404 if no match, 409 if already claimed.

**Auth:** Required

---

## resolveByMetadata

Find and resolve an escalation by metadata key-value pair. Single atomic query with signal guard.

If the escalation has `metadata.signal_id` (created by `conditionLT`), the endpoint signals the running workflow instead of resolving directly in the DB. `conditionLT` receives the signal and resolves the escalation durably inside the workflow. This preserves the same transactional integrity as the standard resolve-by-ID path.

```typescript
// Non-signal escalation → resolved atomically
const result = await lt.escalations.resolveByMetadata({
  key: 'orderId',
  value: 'order-123',
  resolverPayload: { approved: true },
});
// result.data.escalation.status === 'resolved'

// Signal-backed escalation → workflow signaled
const result = await lt.escalations.resolveByMetadata({
  key: 'orderId',
  value: 'order-123',
  resolverPayload: { approved: true },
});
// result.data.signaled === true, result.data.workflowId === '...'
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Metadata field name |
| `value` | `string` | Yes | Metadata field value |
| `resolverPayload` | `object` | Yes | Resolution data passed to the workflow |
| `assignee` | `string` | No | Resolve as a Long Tail user (resolved via `getUserByExternalId`) |
| `metadata` | `object` | No | Merge into escalation metadata before resolving |

**Returns:** `LTApiResult<{ escalation }>` for non-signal, `LTApiResult<{ signaled, escalationId, workflowId }>` for signal-backed. 404 if no match.

**Auth:** Required

## resolveByIds

Resolve a set of escalations by id in one guarded statement (the set-based sibling of `resolve`). For bookkeeping rows woken collectively — it does not deliver a per-row signal, and the store enforces that: rows backing a live `condition()` waiter (`signal_key` set) stay `pending` and are excluded from the result. Settle waiter rows individually with `resolve`, which carries the wake. RBAC: a scoped caller may only resolve rows whose role they hold.

```typescript
const result = await lt.escalations.resolveByIds({
  ids: ['esc_1', 'esc_2', 'esc_3'],
  resolverPayload: { printerId: 'p-7' },
  metadata: { outcome: 'settled' },
});
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Escalation ids to resolve as one set |
| `resolverPayload` | `Record<string, any>` | Yes | Payload applied to every row |
| `metadata` | `Record<string, any>` | No | Outcome patch merged into each row |

**Returns:** `LTApiResult<{ resolved: number; escalationIds: string[] }>` — only still-`pending` rows are resolved.

## resolveAllOrNone

Atomic bulk resolve with per-row payloads: every listed escalation resolves with its own `resolverPayload` in one SQL statement, or nothing resolves. Rows backing a live `condition()` waiter are first-class — each waiter's wake commits with its resolve, delivering that row's payload as the condition's return value (the same wake contract as `resolve`). Use it for gang handoffs where each member must receive a distinct mandate and a partial batch is unacceptable.

RBAC matches `resolveByIds`: per-item write scope, and any missing or out-of-scope id returns 404 with nothing resolved. `requireClaimed` additionally asserts — inside the same guarded statement — that every row is currently assigned to the caller, closing the window where another principal re-claims a member between the caller's claim and the resolve.

```typescript
const result = await lt.escalations.resolveAllOrNone({
  items: [
    { id: 'esc_left', resolverPayload: { gcodeRef: 'gcode-left', unit: 'left' } },
    { id: 'esc_right', resolverPayload: { gcodeRef: 'gcode-right', unit: 'right' } },
  ],
  metadata: { outcome: 'gang-dispatched' },
  requireClaimed: true,
});

if (result.status === 409) {
  // nothing resolved — result.data.failed names exactly the blocking rows
  // (not-found | already-resolved | already-cancelled | already-expired |
  //  assignee-mismatch | unsupported-resolution-path); re-gang around them
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | `Array<{ id, resolverPayload }>` | Yes | The batch — each row resolves with its own payload. Ids must be unique; max 100 items (`LT_ESCALATION_BULK_RESOLVE_MAX`) |
| `metadata` | `Record<string, any>` | No | Shared outcome patch merged into every row's GIN-indexed metadata |
| `requireClaimed` | `boolean` | No | Assert every row is currently assigned to the caller, inside the atomic statement |

**Returns:** `LTApiResult<{ resolved: number; escalationIds: string[] }>` on success. On 409 the data carries `{ error, failedIds, failed: [{ id, reason }] }` — only the rows that blocked the batch are listed; resolvable members stay pending, untouched.

Rows that resolve through legacy signal routing (`metadata.signal_id` / `metadata.signal_routing`) require the single `resolve` path, which delivers their workflow signal; including one blocks the batch with reason `unsupported-resolution-path`. Password-format fields are redacted per row against that row's own `form_schema` before the payload enters the signal store.

**Auth:** Required

## resolveBySignalKey

Resolve an efficient (atomic) escalation directly by its `signal_key` and resume the waiting workflow in place. For callers that know the deterministic signal id and want to skip the id lookup. RBAC-scoped to the escalation's role.

```typescript
const result = await lt.escalations.resolveBySignalKey({
  signalKey: 'signal-scan-ar-order-42',
  resolverPayload: { approved: true },
});
```

**Returns:** `LTApiResult<{ signaled: true; escalationId; workflowId }>`.

## searchByFacets

Item-level faceted search over a single pond `role`, scoped to the caller's role. The faceted-routing read primitive.

```typescript
const result = await lt.escalations.searchByFacets({
  role: 'printer-pool-diabetic',
  status: 'pending',
  available: true,
  facets: { state: 'ready' },
  limit: 50,
});
```

**Returns:** `LTApiResult<{ escalations; total }>`.

## claimGroups

Batch-claim complete origin groups (e.g. all units of an order) in priority order over a pond, assigned to the caller. RBAC-scoped to the pond role.

```typescript
const result = await lt.escalations.claimGroups({
  query: { role: 'print-farm-diabetic', available: true, facets: { filament: 'pla', size_class: 'standard' } },
  limit: 4,
  durationMinutes: 30,
  sizeFacet: 'order_size',
});
```

**Returns:** `LTApiResult<{ groups }>`.

## claimByFacets

Batch-claim individual rows matching a facet query (`FOR UPDATE SKIP LOCKED`), assigned to the caller. With `allOrNone`, commits only when the full `limit` is acquired. RBAC-scoped to the pond role.

```typescript
const result = await lt.escalations.claimByFacets({
  query: { role: 'printer-pool-diabetic', facets: { state: 'ready', filament: 'pla' } },
  limit: 3,
});
```

**Returns:** `LTApiResult<{ claimed }>`.

---

## getStationMetrics

Retrieve per-role throughput and latency metrics for all stations visible to the caller. Used by the Operations view to power the pace chart and station table.

```typescript
const result = await lt.escalations.getStationMetrics({ period: '24h' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `period` | `'1h' \| '24h' \| '7d' \| '30d' \| '15m'` | No | Lookback window for resolved/percentile stats (default `'24h'`) |

**Returns:** `LTApiResult<{ stations: StationMetric[] }>`

### StationMetric type

```typescript
interface StationMetricPeriod {
  p99: number | null;   // minutes
  p50: number | null;
  avg: number | null;
  max: number | null;
}

interface StationMetric {
  role: string;
  pending: number;        // currently queued (status = pending and not claimed)
  claimed: number;        // active — claimed and assignment not expired
  resolved: number;       // resolved within the lookback period
  priority_count: number; // pending unclaimed items past the role's age threshold
  throughput_pct: number | null;  // resolved / (target_per_hour × hours) × 100
  wait: StationMetricPeriod;      // queue time: created_at → claimed_at
  work: StationMetricPeriod;      // processing time: claimed_at → resolved_at
}
```

`pending` reflects the live queue depth regardless of period. `claimed`, `resolved`, and both percentile objects use the lookback window. `priority_count` covers pending, unclaimed items whose age exceeds the role's threshold — age from the `priority_facet` metadata timestamp (`created_at` when unset) against `priority_threshold_minutes` (`sla_minutes` when unset); stations with neither threshold always return `0`. `throughput_pct` is `null` when `target_per_hour` is not set.

**Auth:** Same RBAC as `getStats` — callers see only the stations for roles they hold.
