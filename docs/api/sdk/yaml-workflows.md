# lt.yamlWorkflows

Manage YAML workflow lifecycle: create, deploy, invoke, version, and schedule cron jobs.

## list

List YAML workflows with optional filtering and pagination.

```typescript
const result = await lt.yamlWorkflows.list({ status: 'active', app_id: 'longtail', limit: 20 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | No | Lifecycle filter (`draft`, `deployed`, `active`, `archived`) |
| `graph_topic` | `string` | No | Filter by HotMesh subscription topic |
| `app_id` | `string` | No | Filter by namespace (MCP server name) |
| `search` | `string` | No | Free-text search across name/description |
| `source_workflow_id` | `string` | No | Filter by source execution trace ID |
| `set_id` | `string` | No | Filter by compositional set membership |
| `limit` | `number` | No | Max rows to return |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<YamlWorkflow[]>`

**Auth:** Not required

---

## create

Compile an execution trace into a new YAML workflow draft via the LLM-based generator.

```typescript
const result = await lt.yamlWorkflows.create({
  workflow_id: 'wf_abc',
  task_queue: 'v1',
  workflow_name: 'screenshot_analyze',
  name: 'screenshot_analyze_store',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_id` | `string` | Yes | ID of the source execution trace to compile from |
| `task_queue` | `string` | Yes | HotMesh task queue the source execution ran on |
| `workflow_name` | `string` | Yes | Type name of the source workflow |
| `name` | `string` | Yes | Tool name for the new workflow (no dashes) |
| `description` | `string` | No | Human-readable description passed to the generator |
| `app_id` | `string` | No | Target namespace (defaults to `"longtail"`) |
| `subscribes` | `string` | No | Explicit subscription topic override |
| `tags` | `string[]` | No | Additional tags merged with auto-derived tags |
| `compilation_feedback` | `string` | No | Natural-language feedback to steer the LLM compilation |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## createDirect

Create a YAML workflow directly from user-supplied YAML content (no compilation).

```typescript
const result = await lt.yamlWorkflows.createDirect({
  name: 'my_tool',
  yaml_content: yamlString,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Tool name (sanitized to lowercase alphanumeric, periods, dashes, underscores) |
| `description` | `string` | No | Human-readable description |
| `yaml_content` | `string` | Yes | Raw HotMesh YAML definition |
| `input_schema` | `object` | No | JSON Schema describing the workflow's input (defaults to `{}`) |
| `activity_manifest` | `any[]` | No | List of activity declarations (defaults to `[]`) |
| `tags` | `string[]` | No | Classification tags (defaults to `[]`) |
| `app_id` | `string` | No | Target namespace (defaults to `"longtail"`) |
| `graph_topic` | `string` | No | Subscription topic override (defaults to sanitized name) |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## getAppIds

Retrieve all distinct app_id namespaces that have at least one YAML workflow.

```typescript
const result = await lt.yamlWorkflows.getAppIds({});
```

**Parameters:** None (pass `{}`).

**Returns:** `LTApiResult<{ app_ids: string[] }>`

**Auth:** Not required

---

## get

Fetch a single YAML workflow by its primary key.

```typescript
const result = await lt.yamlWorkflows.get({ id: 'uuid-here' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow record |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## update

Partially update a YAML workflow record.

```typescript
const result = await lt.yamlWorkflows.update({ id: 'uuid-here', name: 'new_name', tags: ['updated'] });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to update |
| `[key]` | `any` | No | Any mutable workflow field (name, description, yaml_content, tags, etc.) |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## regenerate

Re-compile an existing YAML workflow from its original execution trace.

```typescript
const result = await lt.yamlWorkflows.regenerate({
  id: 'uuid-here',
  compilation_feedback: 'Add error handling for the upload step',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to regenerate |
| `task_queue` | `string` | No | Override the task queue (otherwise resolved from source task) |
| `compilation_feedback` | `string` | No | Natural-language feedback to steer the re-compilation |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## delete

Permanently delete a YAML workflow record. Only draft or archived workflows can be deleted.

```typescript
const result = await lt.yamlWorkflows.delete({ id: 'uuid-here' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to delete |

**Returns:** `LTApiResult<{ deleted: true }>`

**Auth:** Not required

---

## deploy

Deploy a YAML workflow and all sibling workflows sharing its app_id namespace.

```typescript
const result = await lt.yamlWorkflows.deploy({ id: 'uuid-here' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to deploy |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## activate

Activate a previously deployed YAML workflow and its app_id siblings.

```typescript
const result = await lt.yamlWorkflows.activate({ id: 'uuid-here' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to activate |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## invoke

Invoke an active YAML workflow, executing its DAG pipeline.

```typescript
const result = await lt.yamlWorkflows.invoke({
  id: 'uuid-here',
  data: { url: 'https://example.com' },
  sync: true,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to invoke |
| `data` | `any` | No | Input payload passed to the workflow's entry point |
| `sync` | `boolean` | No | When true, block until the workflow completes and return its output |
| `timeout` | `number` | No | Max milliseconds to wait when `sync` is true |
| `execute_as` | `string` | No | Override identity for the execution context |

**Returns:** `LTApiResult<any>`

**Auth:** Optional (userId forwarded to invoke service when provided)

---

## archive

Archive a YAML workflow, removing it from active service.

```typescript
const result = await lt.yamlWorkflows.archive({ id: 'uuid-here' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to archive |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## getVersionHistory

Retrieve the version history for a YAML workflow.

```typescript
const result = await lt.yamlWorkflows.getVersionHistory({ id: 'uuid-here', limit: 10 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow |
| `limit` | `number` | No | Max versions to return (default 20) |
| `offset` | `number` | No | Pagination offset (default 0) |

**Returns:** `LTApiResult<VersionSnapshot[]>`

**Auth:** Not required

---

## getVersionSnapshot

Retrieve a specific version snapshot of a YAML workflow.

```typescript
const result = await lt.yamlWorkflows.getVersionSnapshot({ id: 'uuid-here', version: 3 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow |
| `version` | `number` | Yes | 1-based version number to retrieve |

**Returns:** `LTApiResult<VersionSnapshot>`

**Auth:** Not required

---

## getYamlContent

Retrieve the raw YAML content for a workflow, optionally at a specific version.

```typescript
const result = await lt.yamlWorkflows.getYamlContent({ id: 'uuid-here' });
const result = await lt.yamlWorkflows.getYamlContent({ id: 'uuid-here', version: 2 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow |
| `version` | `number` | No | Version number; when omitted, returns the current content |

**Returns:** `LTApiResult<string>`

**Auth:** Not required

---

## setCronSchedule

Set or update the cron schedule for a YAML workflow.

```typescript
const result = await lt.yamlWorkflows.setCronSchedule({
  id: 'uuid-here',
  cron_schedule: '0 * * * *',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to schedule |
| `cron_schedule` | `string` | Yes | Cron expression (e.g. `"0 * * * *"`) |
| `cron_envelope` | `any` | No | Payload passed to each scheduled invocation |
| `execute_as` | `string` | No | Identity override for scheduled executions |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## clearCronSchedule

Remove the cron schedule from a YAML workflow.

```typescript
const result = await lt.yamlWorkflows.clearCronSchedule({ id: 'uuid-here' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the workflow to unschedule |

**Returns:** `LTApiResult<YamlWorkflow>`

**Auth:** Not required

---

## getCronStatus

List all YAML workflows that have a cron schedule, with their live timer status.

```typescript
const result = await lt.yamlWorkflows.getCronStatus({});
```

**Parameters:** None (pass `{}`).

**Returns:** `LTApiResult<{ schedules: Array<{ id, name, graph_topic, app_id, cron_schedule, execute_as, active }> }>`

**Auth:** Not required
