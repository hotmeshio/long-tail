# YAML Workflows API (Process Servers)

Manage YAML workflow definitions — the compiled deterministic pipelines generated from successful MCP triage executions. Each namespace (`app_id`) acts as a process server; each workflow is a tool within that server. All endpoints require authentication.

## List workflows

```
GET /api/yaml-workflows
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | Filter by status: `draft`, `deployed`, `active`, `archived` |
| `graph_topic` | `string` | Filter by graph topic (tool name) |
| `app_id` | `string` | Filter by namespace/server (exact match) |
| `search` | `string` | Search name, graph topic, description, or app ID (case-insensitive) |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:**

```json
{
  "workflows": [
    {
      "id": "a1b2c3d4-...",
      "name": "rotate-and-verify",
      "description": "Rotate document, extract info, validate",
      "app_id": "lt-yaml",
      "app_version": "3",
      "source_workflow_id": "mcp-triage-abc123",
      "source_workflow_type": "mcpTriage",
      "yaml_content": "app:\n  id: lt-yaml\n  version: \"3\"\n...",
      "graph_topic": "rotate_and_verify",
      "input_schema": { "type": "object", "properties": { "image_ref": { "type": "string" } } },
      "output_schema": {},
      "activity_manifest": [
        {
          "activity_id": "a0",
          "title": "Rotate Page",
          "type": "worker",
          "topic": "rotate_and_verify/a0",
          "tool_source": "mcp",
          "mcp_server_id": "srv-1",
          "mcp_tool_name": "rotate_image",
          "input_mappings": {},
          "output_fields": ["rotated_url"]
        }
      ],
      "status": "active",
      "deployed_at": "2025-01-10T00:00:00Z",
      "activated_at": "2025-01-10T00:01:00Z",
      "metadata": null,
      "created_at": "2025-01-09T00:00:00Z",
      "updated_at": "2025-01-10T00:01:00Z"
    }
  ],
  "total": 1
}
```

## Create a workflow (from execution)

```
POST /api/yaml-workflows
```

Generates a YAML workflow from a completed MCP triage execution.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_id` | `string` | Yes | Source execution workflow ID |
| `task_queue` | `string` | Yes | Task queue of the source execution |
| `workflow_name` | `string` | Yes | Source workflow type name |
| `name` | `string` | Yes | Name for the new workflow |
| `description` | `string` | No | Human-readable description |
| `app_id` | `string` | No | Namespace/app ID (default: auto-generated) |
| `subscribes` | `string` | No | Topic subscription |

**Response 201:** Created workflow record.

**Response 400:** Missing required fields.

**Response 409:** Workflow name already exists.

## Get a workflow

```
GET /api/yaml-workflows/:id
```

**Response 200:** Workflow record.

**Response 404:** Workflow not found.

## Update a workflow

```
PUT /api/yaml-workflows/:id
```

**Request body:** Partial update — `yaml_content`, `name`, `description`.

**Response 200:** Updated workflow record.

**Response 404:** Workflow not found.

## Delete a workflow

```
DELETE /api/yaml-workflows/:id
```

Only allowed for `draft` or `archived` workflows.

**Response 200:**

```json
{ "deleted": true }
```

**Response 400:** Cannot delete active or deployed workflows.

**Response 404:** Workflow not found.

## Deploy a workflow

```
POST /api/yaml-workflows/:id/deploy
```

Deploys all YAML workflows sharing this workflow's `app_id` as a merged version. Bumps the version and marks all non-archived siblings as `deployed`.

**Response 200:** Updated workflow record (with new version).

**Response 404:** Workflow not found.

## Activate a workflow

```
POST /api/yaml-workflows/:id/activate
```

Activates the deployed version and registers workers for all workflows in the same `app_id`. Requires status `deployed` or `active`.

**Response 200:** Updated workflow record.

**Response 400:** Workflow must be deployed first.

**Response 404:** Workflow not found.

## Invoke a workflow

```
POST /api/yaml-workflows/:id/invoke
```

Invoke an active YAML workflow with parameters.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | `object` | No | Input data matching the workflow's `input_schema` |
| `sync` | `boolean` | No | Wait for result (default: false) |
| `timeout` | `integer` | No | Timeout in ms for sync invocations (default: 120000) |

**Async response 200:**

```json
{ "job_id": "hmsh:lt-yaml:j:abc123..." }
```

**Sync response 200:**

```json
{
  "job_id": "hmsh:lt-yaml:j:abc123...",
  "result": {
    "metadata": { "jid": "abc123", "tpc": "rotate_and_verify" },
    "data": { "rotated_url": "https://...", "verified": true }
  }
}
```

**Response 400:** Workflow must be active to invoke.

**Response 404:** Workflow not found.

## Regenerate a workflow

```
POST /api/yaml-workflows/:id/regenerate
```

Re-generate the YAML from the original source execution. Only allowed for `draft` workflows.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_queue` | `string` | No | Override task queue (default: from source) |

**Response 200:** Updated workflow record.

**Response 400:** Only draft workflows can be regenerated.

**Response 404:** Workflow not found.

## Archive a workflow

```
POST /api/yaml-workflows/:id/archive
```

Stops accepting invocations. If active, stops the engine.

**Response 200:** Updated workflow record with status `archived`.

**Response 404:** Workflow not found.

## List app IDs

```
GET /api/yaml-workflows/app-ids
```

Returns distinct `app_id` values from non-archived workflows.

**Response 200:**

```json
{
  "app_ids": ["lt-yaml", "my-custom-app"]
}
```

## Get version history

```
GET /api/yaml-workflows/:id/versions
```

Returns version history for a YAML workflow.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `integer` | Max results (default: 20) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:** Version history records.

**Response 404:** Workflow not found.

## Get version snapshot

```
GET /api/yaml-workflows/:id/versions/:version
```

Returns a single version snapshot with YAML content, schemas, and activity manifest.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Workflow UUID |
| `version` | Version number (positive integer) |

**Response 200:** Version snapshot object.

**Response 400:**

```json
{ "error": "Invalid version number" }
```

**Response 404:**

```json
{ "error": "Version 3 not found" }
```

## Get raw YAML

```
GET /api/yaml-workflows/:id/yaml
```

Returns the raw YAML content as `text/yaml`. Supports an optional `version` query parameter to retrieve YAML for a specific version.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `version` | `integer` | Return YAML for this version instead of current |

**Response 200:** YAML content (Content-Type: text/yaml).

**Response 404:** Workflow or version not found.
