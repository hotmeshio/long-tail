# Data Model

Long Tail stores all state in PostgreSQL. Fourteen tables handle workflow tracking, escalation management, user identity, configuration, MCP server registration, compiled workflows, and namespace isolation. A single migration file (`services/db/schemas/001_initial.sql`) creates the full schema; the migration runner (`services/db/migrate.ts`) tracks applied files in `lt_migrations` so migrations are idempotent.

## Tables

### lt_roles

Canonical role registry. Roles referenced by other tables are seeded here.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `role` | `TEXT` | — | Primary key |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

**Seeds:** `reviewer`, `engineer`, `admin`, `superadmin`.

### lt_tasks

Tracks every workflow execution. Created by the LT interceptor when a workflow starts; updated when it completes or fails.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_id` | `TEXT NOT NULL` | — | HotMesh workflow ID (unique per execution) |
| `workflow_type` | `TEXT NOT NULL` | — | Registered workflow name (e.g., `reviewContent`) |
| `lt_type` | `TEXT NOT NULL` | — | Classification set by the interceptor |
| `task_queue` | `TEXT` | — | Task queue the workflow ran on |
| `modality` | `TEXT` | — | Modality from workflow config |
| `status` | `TEXT NOT NULL` | `'pending'` | `pending` or `completed` |
| `priority` | `INTEGER NOT NULL` | `2` | Numeric priority (lower = higher priority) |
| `signal_id` | `TEXT NOT NULL` | — | HotMesh signal ID for resume/replay |
| `parent_workflow_id` | `TEXT NOT NULL` | — | ID of the orchestrator that started this workflow |
| `origin_id` | `TEXT` | — | Correlation ID shared by sibling workflows under the same orchestrator |
| `parent_id` | `TEXT` | — | Direct parent workflow ID |
| `trace_id` | `TEXT` | — | Distributed tracing trace ID |
| `span_id` | `TEXT` | — | Distributed tracing span ID |
| `initiated_by` | `UUID` | — | FK to `lt_users(id)` — user or bot that started this task |
| `principal_type` | `TEXT` | `'user'` | `user` or `bot` (for audit filtering) |
| `started_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | When the workflow began |
| `completed_at` | `TIMESTAMPTZ` | — | When the workflow finished (null while pending) |
| `envelope` | `TEXT NOT NULL` | — | JSON-serialized input envelope |
| `metadata` | `JSONB` | — | Arbitrary metadata attached at workflow start |
| `error` | `TEXT` | — | Error message if the workflow failed |
| `milestones` | `JSONB NOT NULL` | `'[]'` | Array of milestone objects emitted during execution |
| `data` | `TEXT` | — | JSON-serialized workflow return data |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification (auto-updated by trigger) |

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_lt_tasks_status_type` | `(status, workflow_type, created_at DESC)` | Filter tasks by status and type |
| `idx_lt_tasks_parent` | `(parent_workflow_id, created_at DESC)` | Find all tasks under an orchestrator |
| `idx_lt_tasks_lt_type` | `(lt_type, status, created_at DESC)` | Filter by interceptor classification |
| `idx_lt_tasks_completed` | `(completed_at, status)` | Maintenance queries for old completed tasks |
| `idx_lt_tasks_signal` | `(signal_id)` | Look up task by HotMesh signal |
| `idx_lt_tasks_origin` | `(origin_id, created_at DESC)` | Consumer/provider data injection — find sibling tasks sharing an origin |
| `idx_lt_tasks_workflow_id` | `(workflow_id)` | Resolve workflow handle by workflow ID |
| `idx_lt_tasks_origin_id` | `(origin_id)` | Look up tasks by origin ID |
| `idx_lt_tasks_trace` | `(trace_id)` | Look up tasks by trace ID |

### lt_escalations

Records human intervention requests. Created when a workflow returns `type: 'escalation'`. Updated when claimed or resolved.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `type` | `TEXT NOT NULL` | — | Escalation category (e.g., `review`, `verification`) |
| `subtype` | `TEXT NOT NULL` | — | Subcategory for finer routing |
| `modality` | `TEXT NOT NULL` | — | Modality from workflow config |
| `description` | `TEXT` | — | Human-readable reason for the escalation |
| `status` | `TEXT NOT NULL` | `'pending'` | `pending` or `resolved` |
| `priority` | `INTEGER NOT NULL` | `2` | Numeric priority |
| `task_id` | `UUID` | — | FK to `lt_tasks(id)` — the task that triggered this escalation |
| `origin_id` | `TEXT` | — | Correlation ID from the parent orchestrator |
| `parent_id` | `TEXT` | — | Direct parent workflow ID |
| `workflow_id` | `TEXT` | — | HotMesh workflow ID of the escalated workflow |
| `task_queue` | `TEXT` | — | Task queue the workflow runs on (needed for resolution re-run) |
| `workflow_type` | `TEXT` | — | Workflow name (needed for resolution re-run) |
| `role` | `TEXT NOT NULL` | — | Target role — users with this role see the escalation |
| `assigned_to` | `TEXT` | — | User ID of the claimer |
| `assigned_until` | `TIMESTAMPTZ` | — | Claim expiry — after this time the escalation returns to the queue |
| `resolved_at` | `TIMESTAMPTZ` | — | When the escalation was resolved |
| `claimed_at` | `TIMESTAMPTZ` | — | When the escalation was claimed |
| `envelope` | `TEXT NOT NULL` | — | JSON-serialized original workflow envelope |
| `metadata` | `JSONB` | — | Arbitrary metadata |
| `escalation_payload` | `TEXT` | — | JSON-serialized data the workflow attached to the escalation |
| `resolver_payload` | `TEXT` | — | JSON-serialized decision from the human reviewer |
| `trace_id` | `TEXT` | — | Distributed tracing trace ID |
| `span_id` | `TEXT` | — | Distributed tracing span ID |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

**Claiming is implicit.** There is no separate status for "claimed". An escalation is considered claimed when `assigned_to IS NOT NULL` and `assigned_until > NOW()`. When the claim expires, the escalation is available again without any status change. The `/available` endpoint uses this logic:

```sql
WHERE status = 'pending'
  AND (assigned_to IS NULL OR assigned_until <= NOW())
```

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_lt_escalations_available` | `(status, role, assigned_until, created_at DESC)` | Available escalation query |
| `idx_lt_escalations_available_v2` | `(role, priority, created_at DESC) WHERE status = 'pending'` | Partial index for priority-ordered available queries |
| `idx_lt_escalations_assigned` | `(assigned_to, assigned_until, created_at DESC)` | Find escalations claimed by a specific user |
| `idx_lt_escalations_expiry` | `(assigned_until, assigned_to)` | Expire stale claims |
| `idx_lt_escalations_role_type` | `(role, status, type, created_at DESC)` | Filter by role + type |
| `idx_lt_escalations_role_subtype` | `(role, status, type, subtype, created_at DESC)` | Filter by role + type + subtype |
| `idx_lt_escalations_status` | `(status, created_at DESC)` | General status queries |
| `idx_lt_escalations_task` | `(task_id)` | Join escalations to their parent task |
| `idx_lt_escalations_origin` | `(origin_id, created_at DESC)` | Find escalations sharing an origin |
| `idx_lt_escalations_workflow` | `(workflow_id)` | Look up escalation by workflow ID |
| `idx_lt_escalations_type` | `(type)` | Filter by escalation type |
| `idx_lt_escalations_pending_sort` | `(status, priority, created_at DESC)` | Sort pending escalations by priority |
| `idx_lt_escalations_origin_id` | `(origin_id)` | Look up escalations by origin ID |
| `idx_lt_escalations_trace` | `(trace_id)` | Look up escalations by trace ID |
| `idx_lt_escalations_created_desc` | `(created_at DESC)` | Sort by creation time descending |
| `idx_lt_escalations_updated_desc` | `(updated_at DESC)` | Sort by update time descending |
| `idx_lt_escalations_priority_desc` | `(priority DESC)` | Sort by priority descending |

### lt_users

User and bot identity records. Users are created via the API and assigned roles that determine which escalations they can claim. Bot accounts (`account_type = 'bot'`) are service identities that authenticate with API keys.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `external_id` | `TEXT UNIQUE NOT NULL` | — | Your application's user identifier |
| `email` | `TEXT` | — | Email address (optional) |
| `display_name` | `TEXT` | — | Display name (optional) |
| `password_hash` | `TEXT` | — | Hashed password for authentication |
| `account_type` | `TEXT NOT NULL` | `'user'` | `user` or `bot` |
| `status` | `TEXT NOT NULL` | `'active'` | `active`, `inactive`, or `suspended` |
| `metadata` | `JSONB` | — | Arbitrary user metadata |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

Status is enforced by a CHECK constraint: `status IN ('active', 'inactive', 'suspended')`. Account type is enforced by: `account_type IN ('user', 'bot')`.

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_lt_users_status` | `(status)` | Filter users by status |

### lt_user_roles

Maps users to roles. Each user can hold multiple roles with different permission types.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `user_id` | `UUID NOT NULL` | — | FK to `lt_users(id)`, CASCADE on delete |
| `role` | `TEXT NOT NULL` | — | Role name (e.g., `reviewer`, `senior-reviewer`) |
| `type` | `TEXT NOT NULL` | `'member'` | `superadmin`, `admin`, or `member` |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | When the role was assigned |

Primary key: `(user_id, role)` — a user can hold each role at most once.

Type is enforced by a CHECK constraint: `type IN ('superadmin', 'admin', 'member')`.

### lt_bot_api_keys

API keys for bot accounts. Each key is bcrypt-hashed — the raw key is returned once at creation and never stored.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `name` | `TEXT NOT NULL` | — | Human-readable key name |
| `user_id` | `UUID NOT NULL` | — | FK to `lt_users(id)`, CASCADE on delete |
| `key_hash` | `TEXT NOT NULL` | — | bcrypt hash of the raw API key |
| `scopes` | `TEXT[] NOT NULL` | `'{}'` | Allowed scopes (e.g., `mcp:tool:call`) |
| `expires_at` | `TIMESTAMPTZ` | — | Optional expiry (null = no expiry) |
| `last_used_at` | `TIMESTAMPTZ` | — | Updated on each successful validation |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

Unique constraint: `(user_id, name)` — each bot can have at most one key per name.

### lt_config_workflows

Workflow registration. Every workflow that uses the LT interceptor must have a row here (or be registered at runtime via the API).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_type` | `TEXT UNIQUE NOT NULL` | — | Workflow function name |
| `invocable` | `BOOLEAN NOT NULL` | `false` | Allow invocation via `POST /api/workflows/:type/invoke` |
| `task_queue` | `TEXT` | — | Default task queue name |
| `default_role` | `TEXT NOT NULL` | `'reviewer'` | Role assigned to escalations when the workflow doesn't specify one |
| `default_modality` | `TEXT NOT NULL` | `'portal'` | Default modality |
| `description` | `TEXT` | — | Human-readable description |
| `consumes` | `TEXT[] NOT NULL` | `'{}'` | Array of workflow types whose completed data this workflow receives via `envelope.lt.providers` |
| `tool_tags` | `TEXT[]` | `'{}'` | Tags for MCP tool discovery |
| `envelope_schema` | `JSONB` | — | JSON Schema for the workflow input envelope |
| `resolver_schema` | `JSONB` | — | JSON Schema for the escalation resolver payload |
| `cron_schedule` | `TEXT` | — | Cron expression for scheduled execution |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_config_workflows_tool_tags` | `(tool_tags)` GIN | Tag-based workflow discovery |

### lt_config_roles

Allowed roles per workflow type. A workflow can have multiple roles; any user holding one of these roles can claim its escalations.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_type` | `TEXT NOT NULL` | — | FK to `lt_config_workflows(workflow_type)`, CASCADE on delete |
| `role` | `TEXT NOT NULL` | — | Role name |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

Unique constraint: `(workflow_type, role)`.

### lt_config_invocation_roles

Roles allowed to invoke a workflow via the API. When a workflow has `invocable: true` and this table has entries for it, only users holding one of these roles (or superadmins) can invoke.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_type` | `TEXT NOT NULL` | — | FK to `lt_config_workflows(workflow_type)`, CASCADE on delete |
| `role` | `TEXT NOT NULL` | — | Role name |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | When the role was assigned |

Unique constraint: `(workflow_type, role)`.

### lt_mcp_servers

MCP server registration. Stores connection details, cached tool manifests, and compilation hints.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `name` | `TEXT UNIQUE NOT NULL` | — | Server name |
| `description` | `TEXT` | — | Human-readable description |
| `transport_type` | `TEXT NOT NULL` | — | `stdio` or `sse` |
| `transport_config` | `JSONB` | `'{}'` | Connection configuration |
| `auto_connect` | `BOOLEAN` | `false` | Connect automatically on startup |
| `tool_manifest` | `JSONB` | — | Cached tool manifest from the server |
| `status` | `TEXT` | `'registered'` | `registered`, `connected`, `error`, or `disconnected` |
| `last_connected_at` | `TIMESTAMPTZ` | — | Last successful connection time |
| `metadata` | `JSONB` | — | Arbitrary metadata |
| `tags` | `TEXT[]` | `'{}'` | Tags for server discovery |
| `compile_hints` | `TEXT` | — | Hints for the workflow compiler |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_lt_mcp_servers_name` | `(name)` | Look up server by name |
| `idx_lt_mcp_servers_status` | `(status)` | Filter by connection status |
| `idx_lt_mcp_servers_auto_connect` | `(auto_connect) WHERE auto_connect = true` | Find servers that auto-connect |
| `idx_lt_mcp_servers_tags` | `(tags)` GIN | Tag-based server discovery |

### lt_config_role_escalations

Escalation routing between roles. Defines which roles can escalate to which other roles.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `source_role` | `TEXT NOT NULL` | — | FK to `lt_roles(role)` — the originating role |
| `target_role` | `TEXT NOT NULL` | — | FK to `lt_roles(role)` — the destination role |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

Primary key: `(source_role, target_role)`.

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_config_role_escalations_source` | `(source_role)` | Find escalation targets for a role |

### lt_yaml_workflows

Compiled deterministic workflows. Stores DAG definitions, activity manifests, and deployment state.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `name` | `TEXT UNIQUE NOT NULL` | — | Workflow name |
| `description` | `TEXT` | — | Human-readable description |
| `app_id` | `TEXT NOT NULL` | — | HotMesh application ID |
| `app_version` | `TEXT` | `'1'` | Application version |
| `source_workflow_id` | `TEXT` | — | ID of the workflow this was compiled from |
| `source_workflow_type` | `TEXT` | — | Type of the workflow this was compiled from |
| `yaml_content` | `TEXT NOT NULL` | — | YAML DAG definition |
| `graph_topic` | `TEXT NOT NULL` | — | HotMesh graph subscription topic |
| `input_schema` | `JSONB` | `'{}'` | JSON Schema for workflow input |
| `output_schema` | `JSONB` | `'{}'` | JSON Schema for workflow output |
| `activity_manifest` | `JSONB` | `'[]'` | Array of activity definitions used by this workflow |
| `status` | `TEXT` | `'draft'` | `draft`, `deployed`, `active`, or `archived` |
| `deployed_at` | `TIMESTAMPTZ` | — | When the workflow was deployed |
| `activated_at` | `TIMESTAMPTZ` | — | When the workflow was activated |
| `content_version` | `INTEGER` | `1` | Current content version number |
| `deployed_content_version` | `INTEGER` | — | Content version that is currently deployed |
| `tags` | `TEXT[]` | `'{}'` | Tags for workflow discovery |
| `input_field_meta` | `JSONB` | `'[]'` | Metadata about input fields |
| `metadata` | `JSONB` | — | Arbitrary metadata |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_lt_yaml_workflows_status` | `(status)` | Filter by deployment status |
| `idx_lt_yaml_workflows_app_id` | `(app_id)` | Look up workflows by application |
| `idx_lt_yaml_workflows_tags` | `(tags)` GIN | Tag-based workflow discovery |

### lt_yaml_workflow_versions

Version history for compiled workflows. Created on each edit.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_id` | `UUID NOT NULL` | — | FK to `lt_yaml_workflows(id)`, CASCADE on delete |
| `version` | `INTEGER NOT NULL` | — | Version number |
| `yaml_content` | `TEXT NOT NULL` | — | YAML DAG definition for this version |
| `activity_manifest` | `JSONB` | `'[]'` | Activity definitions for this version |
| `input_schema` | `JSONB` | `'{}'` | Input schema for this version |
| `output_schema` | `JSONB` | `'{}'` | Output schema for this version |
| `input_field_meta` | `JSONB` | `'[]'` | Input field metadata for this version |
| `change_summary` | `TEXT` | — | Description of what changed |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

Unique constraint: `(workflow_id, version)`.

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_lt_yaml_workflow_versions_wf` | `(workflow_id, version DESC)` | Look up latest version for a workflow |

### lt_namespaces

Multi-tenant namespace registry.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `name` | `TEXT UNIQUE NOT NULL` | — | Namespace name |
| `description` | `TEXT` | — | Human-readable description |
| `schema_name` | `TEXT NOT NULL` | — | PostgreSQL schema name for this namespace |
| `is_default` | `BOOLEAN` | `false` | Whether this is the default namespace |
| `metadata` | `JSONB` | — | Arbitrary metadata |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

**Seeds:** `longtail` namespace with `is_default = true`.

## Entity-Relationship Diagram

```
lt_roles
  ├──< lt_config_role_escalations  (source_role → role)
  └──< lt_config_role_escalations  (target_role → role)

lt_config_workflows
  ├──< lt_config_roles              (workflow_type → workflow_type, CASCADE)
  └──< lt_config_invocation_roles   (workflow_type → workflow_type, CASCADE)

lt_users
  ├──< lt_user_roles          (user_id → id, CASCADE)
  ├──< lt_bot_api_keys        (user_id → id, CASCADE)
  ├──< lt_oauth_tokens        (user_id → id, CASCADE)
  └──< lt_tasks.initiated_by  (initiated_by → id, SET NULL)

lt_tasks
  └──< lt_escalations         (task_id → id)

lt_yaml_workflows
  └──< lt_yaml_workflow_versions   (workflow_id → id, CASCADE)

lt_mcp_servers                 (standalone — MCP server registry)
lt_namespaces                  (standalone — namespace registry)
lt_migrations                  (standalone — tracks applied schema files)
```

Arrows point from child to parent. `CASCADE` means deleting the parent deletes the children.

## Trigger

All tables with `updated_at` use a shared trigger function:

```sql
CREATE OR REPLACE FUNCTION lt_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

This fires `BEFORE UPDATE` on `lt_tasks`, `lt_escalations`, `lt_users`, `lt_config_workflows`, `lt_mcp_servers`, `lt_yaml_workflows`, and `lt_namespaces`.

## Migrations

The migration runner (`services/db/migrate.ts`) reads `.sql` files from `services/db/schemas/`, sorted alphabetically. Each file runs at most once, tracked in `lt_migrations`:

```sql
CREATE TABLE IF NOT EXISTS lt_migrations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Migrations are safe to run from multiple containers simultaneously — the `UNIQUE` constraint on `name` prevents double-application. Both API and worker containers can call `migrate()` at startup.
