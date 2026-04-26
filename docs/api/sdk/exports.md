# lt.exports

Export workflow state, execution trees, and job metadata.

## listJobs

List export jobs with optional filtering, sorting, and pagination.

```typescript
const result = await lt.exports.listJobs({ limit: 25, offset: 0, status: 'completed' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | `number` | No | Maximum number of jobs to return |
| `offset` | `number` | No | Number of jobs to skip for pagination |
| `entity` | `string` | No | Filter by entity/workflow type |
| `search` | `string` | No | Free-text search across job fields |
| `status` | `string` | No | Filter by job status |
| `sort_by` | `string` | No | Field name to sort results by |
| `order` | `string` | No | Sort direction (`asc` or `desc`) |
| `registered` | `string` | No | Filter by registration status |

**Returns:** `LTApiResult<{ jobs, total, ... }>`

**Auth:** Not required

---

## exportState

Export the stored state (hash data) of a workflow. Fields can be filtered via allow/block lists.

```typescript
const result = await lt.exports.exportState({
  workflowId: 'wf_abc123',
  allow: ['data', 'status'],
  values: true,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | The workflow's unique identifier |
| `allow` | `LTExportField[]` | No | Whitelist of field names to include |
| `block` | `LTExportField[]` | No | Blacklist of field names to exclude |
| `values` | `boolean` | No | When true, include field values (not just names) |

`LTExportField` is one of: `'data'`, `'state'`, `'status'`, `'timeline'`, `'transitions'`

**Returns:** `LTApiResult<ExportedState>` -- returns 404 if the workflow is not found or data has expired.

**Auth:** Not required

---

## exportExecution

Export the full execution tree of a workflow, including activity inputs and results.

```typescript
const result = await lt.exports.exportExecution({
  workflowId: 'wf_abc123',
  excludeSystem: true,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | The workflow's unique identifier |
| `excludeSystem` | `boolean` | No | Omit system-generated activities from the export |
| `omitResults` | `boolean` | No | Exclude activity result payloads |
| `mode` | `ExportMode` | No | Export mode controlling output format (e.g., tree, flat) |
| `maxDepth` | `number` | No | Maximum depth to traverse in the execution tree |

**Returns:** `LTApiResult<ExecutionExport>` -- returns 404 if the workflow is not found or data has expired.

**Auth:** Not required

---

## getStatus

Get the current status of a workflow (e.g., running, completed, failed).

```typescript
const result = await lt.exports.getStatus({ workflowId: 'wf_abc123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | The workflow's unique identifier |

**Returns:** `LTApiResult<WorkflowStatus>` -- returns 404 if the workflow is not found or data has expired.

**Auth:** Not required

---

## getState

Get the current state data of a workflow.

```typescript
const result = await lt.exports.getState({ workflowId: 'wf_abc123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | Yes | The workflow's unique identifier |

**Returns:** `LTApiResult<WorkflowState>` -- returns 404 if the workflow is not found or data has expired.

**Auth:** Not required
