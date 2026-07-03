# Data Model

Long Tail stores all state in PostgreSQL. The tables handle workflow tracking, escalation management, user identity, configuration, MCP server registration, compiled workflows, OAuth tokens, service tokens, ephemeral credentials, and namespace isolation. A single migration file (`services/db/schemas/001_initial.sql`) creates the full schema; the migration runner (`services/db/migrate.ts`) tracks applied files in `lt_migrations` so migrations are idempotent.

## Tables

### lt_roles

Canonical role registry. Roles referenced by other tables are seeded here.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `role` | `TEXT` | — | Primary key |
| `title` | `TEXT` | — | Display name |
| `description` | `TEXT` | — | Short human-readable purpose |
| `form_schema` | `JSONB` | — | Live (latest) JSON Schema for the escalation resolve form |
| `metadata_schema` | `JSONB` | — | Live (latest) JSON Schema validating `lt_escalations.metadata` at creation |
| `current_schema_version` | `INTEGER` | — | Version of the live schema pair; advances on every schema change (null until the role first carries a schema) |
| `properties` | `JSONB` | `'{}'` | Free user-owned bag (icons, colors, tags) |
| `ops_visible` | `BOOLEAN` | `false` | Show as a station on the Operations view |
| `parent_role` | `TEXT` | — | FK to `lt_roles(role)` — process dependency graph |
| `sla_minutes` | `NUMERIC` | — | Target resolution time |
| `target_per_hour` | `NUMERIC` | — | Throughput target |
| `worker_count` | `NUMERIC` | — | Station capacity |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

**Seeds:** `reviewer`, `engineer`, `admin`, `superadmin`.

### lt_role_schemas

Immutable version history of each role's schema pair. Every change to a role's `form_schema` or `metadata_schema` (via `PATCH /api/roles/:role`, the SDK, or the `update_role` MCP tool) appends the next `(role, version)` snapshot in the same atomic statement that updates `lt_roles`. Escalations pin a version via `metadata.schema_version` (`conditionLT`'s `schemaVersion` field) so the resolver form they render stays exactly what their author specified; unpinned escalations use the live columns on `lt_roles`.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `role` | `TEXT NOT NULL` | — | FK to `lt_roles(role)` `ON DELETE CASCADE`; part of the primary key |
| `version` | `INTEGER NOT NULL` | — | Monotonic per role; part of the primary key |
| `form_schema` | `JSONB` | — | Snapshot of the form schema at this version |
| `metadata_schema` | `JSONB` | — | Snapshot of the metadata schema at this version |
| `change_summary` | `TEXT` | — | Optional label supplied with the change |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | When this version was created |

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

### lt_escalations (view) → hmsh_escalations

Records human intervention requests. Created when a workflow returns
`type: 'escalation'`, when `ltCreateEscalation` runs, or atomically when a
workflow calls `condition(signalId, config)` / `conditionLT(signalId, config)`.
Updated when claimed or resolved.

Since v0.5.3 the storage is the **shared HotMesh table `public.hmsh_escalations`**
(written by both long-tail and the HotMesh SDK). `lt_escalations` remains as a
backward-compatible **view** over it — `SELECT *` plus a computed `available`
column — so existing read queries and the public API are unchanged. Indexes are
managed by the SDK on `hmsh_escalations` (see below).

Role read/write scope does **not** add columns here. An escalation carries a `role`
and an optional `assigned_to`; work-surface scope lives on the membership table
(`lt_user_roles`) and is applied at read time. `condition()` / `conditionLT()` and
the escalation engine are unaffected.

The columns below are the `hmsh_escalations` table. The public API record
(`LTEscalationRecord`) is mapped from these: the JSONB `envelope` /
`escalation_payload` / `resolver_payload` are serialized to JSON **strings**, and
`type` / `subtype` / `role` are coerced to non-null (`''` when absent) so the API
contract is stable.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `namespace` | `TEXT NOT NULL` | — | HotMesh namespace scope |
| `app_id` | `TEXT NOT NULL` | — | HotMesh app scope |
| `signal_key` | `TEXT` | — | Atomic resume key set by `condition(signalId, config)` — resuming this row signals the waiting workflow in place. `NULL` for service-created rows. Unique per `(namespace, app_id, signal_key)`. |
| `topic` | `TEXT` | — | Hook topic used to deliver the resume signal |
| `workflow_id` | `TEXT` | — | HotMesh workflow ID of the escalated workflow |
| `task_queue` | `TEXT` | — | Task queue the workflow runs on (needed for resolution) |
| `workflow_type` | `TEXT` | — | Workflow name (needed for resolution) |
| `type` | `TEXT` | — | Escalation category (e.g., `review`, `orderPipeline`). Non-null in the API record. |
| `subtype` | `TEXT` | — | Subcategory for finer routing. Non-null in the API record. |
| `entity` | `TEXT` | — | Entity/workflow tag (replaces the former `modality`) |
| `description` | `TEXT` | — | Human-readable reason for the escalation |
| `role` | `TEXT` | — | Target role name — users with this role see the escalation. Matched by name (logical pointer to `lt_roles.role`, one role → many escalations); not an FK. Non-null in the API record. |
| `status` | `TEXT NOT NULL` | `'pending'` | `pending`, `resolved`, or `cancelled` |
| `priority` | `INTEGER NOT NULL` | `5` | Numeric priority (long-tail's `createEscalation` defaults rows to `2`) |
| `assigned_to` | `TEXT` | — | User ID of the claimer |
| `assigned_until` | `TIMESTAMPTZ` | — | Claim expiry — after this time the escalation returns to the queue |
| `claimed_at` | `TIMESTAMPTZ` | — | When the escalation was claimed |
| `claim_expires_at` | `TIMESTAMPTZ` | — | SDK claim-expiry timestamp |
| `resolved_at` | `TIMESTAMPTZ` | — | When the escalation was resolved |
| `task_id` | `TEXT` | — | ID of the `lt_tasks` row that triggered this escalation |
| `origin_id` | `TEXT` | — | Correlation ID from the parent orchestrator |
| `parent_id` | `TEXT` | — | Direct parent workflow ID |
| `initiated_by` | `TEXT` | — | Identity that initiated the escalation |
| `created_by` | `TEXT` | — | Identity that created the row |
| `envelope` | `JSONB` | — | Original workflow envelope (serialized to a JSON string in the API record) |
| `metadata` | `JSONB` | — | Arbitrary metadata (GIN-indexed; holds claim/filter keys) |
| `escalation_payload` | `JSONB` | — | Data the workflow attached (JSON string in the API record) |
| `resolver_payload` | `JSONB` | — | Human reviewer's decision (JSON string in the API record) |
| `milestones` | `JSONB NOT NULL` | `'[]'` | Audit trail of lifecycle milestones |
| `trace_id` | `TEXT` | — | Distributed tracing trace ID |
| `span_id` | `TEXT` | — | Distributed tracing span ID |
| `expires_at` | `TIMESTAMPTZ` | — | Optional deadline for the escalation |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

The `lt_escalations` view adds one computed column on top of the above:

| Column | Type | Description |
|--------|------|-------------|
| `available` | `BOOLEAN` | `true` when claimable — `assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW()` |

**Claiming is implicit.** There is no separate status for "claimed". An escalation is considered claimed when `assigned_to IS NOT NULL` and `assigned_until > NOW()`. When the claim expires, the escalation is available again without any status change. The `/available` endpoint uses this logic:

```sql
WHERE status = 'pending'
  AND (assigned_to IS NULL OR assigned_until <= NOW())
```

**Indexes** (SDK-managed, on `hmsh_escalations`):

| Index | Columns | Purpose |
|-------|---------|---------|
| `hmsh_escalations_pkey` | `(id)` | Primary key |
| `idx_hmsh_esc_available` | `(namespace, app_id, role, priority, created_at) WHERE status = 'pending'` | Priority-ordered available-by-role query |
| `idx_hmsh_esc_available_expiry` | `(namespace, app_id, role, assigned_until, created_at DESC)` | Available-by-role with claim expiry |
| `idx_hmsh_esc_assigned` | `(assigned_to, assigned_until, created_at DESC) WHERE status = 'pending' AND assigned_to IS NOT NULL` | Escalations claimed by a specific user |
| `idx_hmsh_esc_signal_key` | `UNIQUE (namespace, app_id, signal_key) WHERE signal_key IS NOT NULL` | Resolve/look up an atomic escalation by its resume key |
| `idx_hmsh_esc_metadata` | `GIN (metadata jsonb_path_ops)` | Metadata key/value filters (claim-by-metadata) |
| `idx_hmsh_esc_entity` | `(namespace, app_id, entity, created_at DESC) WHERE entity IS NOT NULL` | Filter by entity |
| `idx_hmsh_esc_origin` | `(origin_id) WHERE origin_id IS NOT NULL` | Find escalations sharing an origin |
| `idx_hmsh_esc_task` | `(task_id) WHERE task_id IS NOT NULL` | Join escalations to their parent task |
| `idx_hmsh_esc_workflow` | `(workflow_id) WHERE workflow_id IS NOT NULL` | Look up escalation by workflow ID |

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
| `type` | `TEXT NOT NULL` | `'member'` | `superadmin`, `admin`, or `member` — the management tier |
| `read_scope` | `TEXT NOT NULL` | `'all'` | `self` or `all` — search breadth for a `member`: which escalations in the role queue the member sees. `self` = items where `assigned_to = user`; `all` = the whole queue. Ignored for `admin`/`superadmin`, which always see the whole queue. |
| `write_scope` | `TEXT NOT NULL` | `'all'` | `none`, `self`, or `all` — claim/ack/delete breadth for a `member`. `none` = read-only; `self` = items assigned to the member; `all` = the whole queue. Ignored for `admin`/`superadmin`. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | When the role was assigned |

Primary key: `(user_id, role)` — a user can hold each role at most once.

Type is enforced by a CHECK constraint: `type IN ('superadmin', 'admin', 'member')`. Scope is enforced by CHECK constraints: `read_scope IN ('self', 'all')`, `write_scope IN ('none', 'self', 'all')`, and **write ⊆ read** — `write_scope = 'all'` requires `read_scope = 'all'` (a member cannot act on what it cannot see). Both scopes default to `all`, the full-queue worker.

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

### lt_oauth_tokens

Encrypted per-user, per-provider OAuth tokens. Supports multiple credentials per provider via the `label` column.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `user_id` | `UUID NOT NULL` | — | FK to `lt_users(id)`, CASCADE on delete |
| `provider` | `TEXT NOT NULL` | — | OAuth provider name (e.g., `google`, `github`) |
| `label` | `TEXT NOT NULL` | `'default'` | Label for multiple credentials per provider per user |
| `access_token_enc` | `TEXT NOT NULL` | — | AES-encrypted access token |
| `refresh_token_enc` | `TEXT` | — | AES-encrypted refresh token |
| `token_type` | `TEXT NOT NULL` | `'bearer'` | Token type |
| `scopes` | `TEXT[] NOT NULL` | `'{}'` | Granted scopes |
| `expires_at` | `TIMESTAMPTZ` | — | Token expiry |
| `provider_user_id` | `TEXT NOT NULL` | — | User ID at the provider |
| `provider_email` | `TEXT` | — | Email at the provider |
| `metadata` | `JSONB` | — | Arbitrary metadata |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

Unique constraint: `(user_id, provider, label)`.

### lt_service_tokens

Service tokens for external MCP servers. Each token is hashed — the raw token is returned once at creation.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `name` | `TEXT UNIQUE NOT NULL` | — | Human-readable token name |
| `token_hash` | `TEXT NOT NULL` | — | Hashed token value |
| `server_id` | `UUID` | — | FK to `lt_mcp_servers(id)`, CASCADE on delete |
| `scopes` | `TEXT[] NOT NULL` | `'{}'` | Allowed scopes |
| `expires_at` | `TIMESTAMPTZ` | — | Optional expiry |
| `last_used_at` | `TIMESTAMPTZ` | — | Updated on each use |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

### lt_ephemeral_credentials

Short-lived credential store for sensitive fields in waitFor signal payloads. Supports use-count limits and TTL-based expiry.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `UUID` | `gen_random_uuid()` | Primary key |
| `value` | `BYTEA NOT NULL` | — | Encrypted credential value |
| `label` | `TEXT` | — | Human-readable label |
| `max_uses` | `INTEGER NOT NULL` | `0` | Maximum retrievals (0 = unlimited) |
| `use_count` | `INTEGER NOT NULL` | `0` | Current retrieval count |
| `expires_at` | `TIMESTAMPTZ` | — | TTL-based expiry |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

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
lt_oauth_tokens                (user_id → lt_users.id, CASCADE)
lt_service_tokens              (standalone — service token registry)
lt_ephemeral_credentials       (standalone — short-lived credential store)
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

This fires `BEFORE UPDATE` on `lt_tasks`, `lt_users`, `lt_config_workflows`, `lt_mcp_servers`, `lt_yaml_workflows`, and `lt_namespaces`. Escalations are not in this list: `lt_escalations` is a view, and `updated_at` on the underlying `hmsh_escalations` table is maintained by the HotMesh SDK.

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
