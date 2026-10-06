# lt.workflows

Invoke, inspect, and configure HotMesh Durable workflows.

## invoke

Start a workflow execution.

Resolves the task queue, enforces auth/role constraints, builds the LTEnvelope with IAM context, and delegates to the Durable client. Any `WorkflowOptions` field (`workflowId`, `expire`, `entity`, `namespace`, `search`, `signalIn`, `pending`, etc.) can be passed via `options`.

```typescript
const result = await lt.workflows.invoke({
  type: 'reviewContent',
  data: { url: 'https://example.com/page' },
  metadata: { source: 'dashboard' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Workflow function name |
| `data` | `Record<string, any>` | No | Envelope data payload |
| `metadata` | `Record<string, any>` | No | Envelope metadata |
| `execute_as` | `string` | No | Account id or `external_id` to run as. Requires admin access and the act-as rule below. |
| `options` | `Record<string, any>` | No | Passthrough to Durable WorkflowOptions |

**Returns:** `LTApiResult<{ workflowId, message }>`  (status 202)

**Auth:** Required. When `invocation_roles` is set, the caller must hold one of them; roles are read from the caller's current grants in the database. Empty `invocation_roles` admits any authenticated caller. A superadmin grant, or the `admin` role held with `admin` type, invokes any workflow. `capabilityInvoke` requires a superadmin grant. For `execute_as`, a superadmin may act as anyone, and a caller holding an `admin`-type grant may act as an account that holds no superadmin grant and whose every role the caller holds at the same or higher type; otherwise `403`.

---

## getStatus

Get the execution status of a workflow.

```typescript
const result = await lt.workflows.getStatus({ workflowId: 'wf_abc' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | HotMesh workflow ID |

**Returns:** `LTApiResult<{ workflowId, status, state, terminated, error? }>`. Returns 404 if not found.

| Field | Meaning |
|-------|---------|
| `status` | HotMesh job status: above 0 running, 0 closed, below 0 terminated |
| `state` | `running`, `completed`, or `failed`. A run that closed with an error is `failed` at status 0; a terminated run is `failed` |
| `terminated` | `true` when an interrupt ended the run |
| `error` | the failure message, when HotMesh still holds it |

```typescript
// after lt.workflows.terminate({ workflowId: 'wf_abc' })
// result.data → { workflowId: 'wf_abc', status: -999999999, state: 'failed', terminated: true }
```

Terminate acts on the named run; a child run is terminated by its own id.

**Auth:** Not required

---

## getEnvelopes

The workflow's input and output envelopes — two narrow lookups, never blocking. `output` is `null` with `status: 'running'` while the run is in flight; a failed run answers `status: 'failed'` with the workflow's `error` message.

```typescript
const result = await lt.workflows.getEnvelopes({ workflowId: 'reviewContent-a1b2c3d4' });
// result.data → { workflow_id, status, input, output, error? }
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | The workflow's unique identifier |

**Returns:** `LTApiResult<{ workflow_id, status: 'running' | 'completed' | 'failed', terminated?, input, output, error? }>` — `terminated: true` when an interrupt ended the run; 404 when the workflow is unknown or expired.

**Auth:** Not required

---

## getResult

Get the result of a completed workflow.

Returns 202 if the workflow is still running, and a failed or terminated run answers at once with its error. Never blocks.

```typescript
const result = await lt.workflows.getResult({ workflowId: 'wf_abc' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | HotMesh workflow ID |

**Returns:** one of
- `LTApiResult<{ workflowId, state: 'completed', result }>` (200)
- `LTApiResult<{ workflowId, state: 'failed', terminated, error?, result: null }>` (200)
- `LTApiResult<{ workflowId, status: 'running' }>` (202)

Returns 404 if not found.

**Auth:** Not required

---

## terminate

Terminate a running workflow.

```typescript
const result = await lt.workflows.terminate({ workflowId: 'wf_abc' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | HotMesh workflow ID |

**Returns:** `LTApiResult<{ terminated: true, workflowId }>` -- returns 404 if not found.

**Auth:** Not required

---

## export

Export the full state of a workflow.

Returns the serialized workflow state including all activity results, signals, and metadata.

```typescript
const result = await lt.workflows.export({ workflowId: 'wf_abc' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | HotMesh workflow ID |

**Returns:** `LTApiResult<ExportedState>` -- returns 404 if not found.

**Auth:** Not required

---

## listWorkers

List active workflow workers with their registration status.

```typescript
const result = await lt.workflows.listWorkers({ include_system: false });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `include_system` | `boolean` | No | Include system workflows (default: false) |

**Returns:** `LTApiResult<{ workers: [{ name, task_queue, registered, system }] }>`

**Auth:** Not required

---

## listDiscovered

Discover all known workflow types from workers, history, and config.

Merges three sources: active in-memory workers, historical entities from the durable jobs table, and registered workflow configs.

```typescript
const result = await lt.workflows.listDiscovered({ include_system: false });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `include_system` | `boolean` | No | Include system workflows (default: false) |

**Returns:** `LTApiResult<{ workflows: [{ workflow_type, task_queue, tier, registered, active, invocable, system, description, roles, invocation_roles, execute_as }] }>` — `tier` is `certified`, `registered`, or `durable`.

**Auth:** Not required

---

## getCronStatus

List all cron-scheduled workflows and their active state.

```typescript
const result = await lt.workflows.getCronStatus();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ schedules: [{ workflow_type, cron_schedule, description, task_queue, invocable, active, envelope_schema }] }>`

**Auth:** Not required

---

## listConfigs

List all registered workflow configurations.

```typescript
const result = await lt.workflows.listConfigs();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ workflows: LTWorkflowConfig[] }>`

**Auth:** Not required

---

## getConfig

Get a single workflow configuration by type.

```typescript
const result = await lt.workflows.getConfig({ type: 'reviewContent' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Workflow type name |

**Returns:** `LTApiResult<LTWorkflowConfig>` -- returns 404 if not found.

**Auth:** Not required

---

## upsertConfig

Create or replace a workflow configuration.

Invalidates the config cache and restarts the cron schedule if one is defined. Idempotent.

```typescript
const result = await lt.workflows.upsertConfig({
  type: 'reviewContent',
  invocable: true,
  task_queue: 'content-review',
  default_role: 'reviewer',
  description: 'Review flagged content',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Workflow type name |
| `invocable` | `boolean` | No | Whether the workflow can be started via the API |
| `certified` | `boolean` | No | Explicit HITL certification (interceptor treatment). Omitted → derived from roles/consumes presence. |
| `task_queue` | `string \| null` | No | HotMesh task queue |
| `default_role` | `string` | No | Default escalation role |
| `description` | `string \| null` | No | Human-readable description |
| `execute_as` | `string \| null` | No | Service account for proxy invocation |
| `roles` | `string[]` | No | Interceptor default for who resolves interceptor-raised escalations |
| `invocation_roles` | `string[]` | No | Roles that can invoke this workflow |
| `consumes` | `string[]` | No | Workflow types whose data this workflow consumes |
| `tool_tags` | `string[]` | No | MCP tool tags for discovery |
| `envelope_schema` | `any` | No | JSON Schema for envelope.data validation |
| `resolver_schema` | `any` | No | **Deprecated** legacy fallback only. There is no resolver-payload validation; the escalation form is owned by the target role as a versioned `form_schema`. |
| `cron_schedule` | `string \| null` | No | Cron expression for scheduled execution |

**Returns:** `LTApiResult<LTWorkflowConfig>`

**Auth:** Not required

---

## deleteConfig

Delete a workflow configuration.

Removes the config record and invalidates the cache. Active workers continue running.

```typescript
const result = await lt.workflows.deleteConfig({ type: 'reviewContent' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Workflow type name |

**Returns:** `LTApiResult<{ deleted: true, workflow_type }>` -- returns 404 if not found.

**Auth:** Not required
