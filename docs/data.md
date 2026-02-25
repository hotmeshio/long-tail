# Data Model

Long Tail stores all state in PostgreSQL. Seven tables handle workflow tracking, escalation management, user identity, and configuration. A single migration file (`services/db/schemas/001_initial.sql`) creates the full schema; the migration runner (`services/db/migrate.ts`) tracks applied files in `lt_migrations` so migrations are idempotent.

## Tables

### lt_tasks

Tracks every workflow execution. Created by the LT interceptor when a workflow starts; updated when it completes or fails.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_id` | `TEXT NOT NULL` | — | HotMesh workflow ID (unique per execution) |
| `workflow_type` | `TEXT NOT NULL` | — | Registered workflow name (e.g., `reviewContent`) |
| `lt_type` | `TEXT NOT NULL` | — | Classification set by the interceptor |
| `modality` | `TEXT` | — | Modality from workflow config |
| `status` | `TEXT NOT NULL` | `'pending'` | `pending` or `completed` |
| `priority` | `INTEGER NOT NULL` | `2` | Numeric priority (lower = higher priority) |
| `signal_id` | `TEXT NOT NULL` | — | HotMesh signal ID for resume/replay |
| `parent_workflow_id` | `TEXT NOT NULL` | — | ID of the orchestrator that started this workflow |
| `origin_id` | `TEXT` | — | Correlation ID shared by sibling workflows under the same orchestrator |
| `parent_id` | `TEXT` | — | Direct parent workflow ID |
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

### lt_users

User identity records. Users are created via the API and assigned roles that determine which escalations they can claim.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `external_id` | `TEXT UNIQUE NOT NULL` | — | Your application's user identifier |
| `email` | `TEXT` | — | Email address (optional) |
| `display_name` | `TEXT` | — | Display name (optional) |
| `status` | `TEXT NOT NULL` | `'active'` | `active`, `inactive`, or `suspended` |
| `metadata` | `JSONB` | — | Arbitrary user metadata |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

Status is enforced by a CHECK constraint: `status IN ('active', 'inactive', 'suspended')`.

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

### lt_config_workflows

Workflow registration. Every workflow that uses the LT interceptor must have a row here (or be registered at runtime via the API).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_type` | `TEXT UNIQUE NOT NULL` | — | Workflow function name |
| `is_lt` | `BOOLEAN NOT NULL` | `true` | Enables the LT interceptor for this workflow |
| `is_container` | `BOOLEAN NOT NULL` | `false` | `true` for orchestrators that coordinate child workflows |
| `task_queue` | `TEXT` | — | Default task queue name |
| `default_role` | `TEXT NOT NULL` | `'reviewer'` | Role assigned to escalations when the workflow doesn't specify one |
| `default_modality` | `TEXT NOT NULL` | `'portal'` | Default modality |
| `description` | `TEXT` | — | Human-readable description |
| `consumes` | `TEXT[] NOT NULL` | `'{}'` | Array of workflow types whose completed data this workflow receives via `envelope.lt.providers` |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Last modification |

**Seeded rows:** The initial migration inserts four built-in workflows: `reviewContent`, `reviewContentOrchestrator`, `verifyDocument`, `verifyDocumentOrchestrator`.

### lt_config_roles

Allowed roles per workflow type. A workflow can have multiple roles; any user holding one of these roles can claim its escalations.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_type` | `TEXT NOT NULL` | — | FK to `lt_config_workflows(workflow_type)`, CASCADE on delete |
| `role` | `TEXT NOT NULL` | — | Role name |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

Unique constraint: `(workflow_type, role)`.

### lt_config_lifecycle

Hook definitions that chain workflows together. An `onBefore` hook runs a workflow before the main workflow; an `onAfter` hook runs after.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `UUID` | `gen_random_uuid()` | Primary key |
| `workflow_type` | `TEXT NOT NULL` | — | FK to `lt_config_workflows(workflow_type)`, CASCADE on delete |
| `hook` | `TEXT NOT NULL` | — | `onBefore` or `onAfter` |
| `target_workflow_type` | `TEXT NOT NULL` | — | The workflow to invoke |
| `target_task_queue` | `TEXT` | — | Queue for the target workflow (optional) |
| `ordinal` | `INTEGER NOT NULL` | `0` | Execution order (lower runs first) |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` | Row creation time |

Hook type is enforced by a CHECK constraint: `hook IN ('onBefore', 'onAfter')`.

Unique constraint: `(workflow_type, hook, target_workflow_type)`.

## Entity-Relationship Diagram

```
lt_config_workflows
  ├──< lt_config_roles        (workflow_type → workflow_type, CASCADE)
  └──< lt_config_lifecycle    (workflow_type → workflow_type, CASCADE)

lt_users
  └──< lt_user_roles          (user_id → id, CASCADE)

lt_tasks
  └──< lt_escalations         (task_id → id)

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

This fires `BEFORE UPDATE` on `lt_tasks`, `lt_escalations`, `lt_users`, and `lt_config_workflows`.

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
