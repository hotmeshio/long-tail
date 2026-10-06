# Admin

Unified system management: tasks, escalations, workflows, diagnostics, agents, bot accounts, control plane, pipelines, topics, users, roles, personas, scan codes, announcements, and settings.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-admin` |
| Category | System |
| AI required | No |
| Credential providers | — |

## Access

Each tool below is marked **Read-safe**. A service-account key scoped `mcp:read` can call the Read-safe tools; the rest (Read-safe: No) change state and require an `mcp:full` key, and the account's role must permit the action on the target. Each tool also declares a role gate (`caller`, `admin`, `builder`, or `roleManager`); a tool appears only to accounts that hold it. See the MCP guide's [Access](../../mcp.md#access-which-tools-and-which-records) section for the full model.

## Compile Hints

Admin tools modify system configuration. upsert_workflow_config's `certified` flag and delete_workflow_config change interceptor behavior.

## Tasks

### find_tasks

Search tasks with optional filters. Returns task records with workflow_id, status, workflow_type, and timestamps.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status |
| workflow_type | string | No | Filter by workflow type |
| workflow_id | string | No | Filter by workflow ID |
| origin_id | string | No | Filter by origin ID |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### get_process_detail

Get all tasks and escalations for a process (origin_id).

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| origin_id | string | Yes | The process origin ID |

## Escalations

Escalations belong to a role's queue. Which of them a person sees and acts on is set by their work-surface scope: a role membership carries a `type` (`member`, `admin`, or `superadmin`) plus `read_scope` (`self` | `all`) — which escalations a member sees — and `write_scope` (`none` | `self` | `all`) — which they may claim, resolve, or cancel — with write ⊆ read. `read_self`/`write_self` narrows a member to items assigned to them (`assigned_to = user`); an `admin` or `superadmin` acts on the whole queue. The tools below operate at whole-queue breadth and need a role permitted to act on the target (see [Access](#access) above). The `assigned_to` filter on `find_escalations` pairs with this model — it narrows results to one user's items, the same surface a `read_self` member sees. Defaults are `all`/`all`. See the [Roles API](../http/roles.md) for the full scope model.

### find_escalations

Search escalations with optional filters and sorting. Returns full records
including `metadata`, workflow linkage, assignment, and `signal_key`.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | pending, resolved, or cancelled |
| role | string | No | Filter by role |
| type | string | No | Filter by type |
| subtype | string | No | Filter by subtype |
| assigned_to | string | No | Filter by assigned user UUID (active claim holder) |
| search | string | No | Exact-match lookup by correlation id — escalation id, workflow id, or origin id (order/ticket). Index-served, server-side over the full result set. To match a value inside metadata (e.g. an order id), use `facets`. |
| priority | integer | No | Filter by priority |
| sort_by | string | No | Sort column: created_at, priority, updated_at |
| order | string | No | Sort direction (asc, desc) for sort_by |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### get_escalation

Get a single escalation by ID — the full record including metadata, payloads,
`signal_key`, and assignment state.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Escalation ID |

### get_escalations_by_workflow

List all escalations linked to a workflow ID, newest first. Returns full records
including metadata.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID to list escalations for |

### get_escalation_stats

Aggregated escalation statistics: pending, claimed, created, resolved counts with breakdown by role.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| period | string | No | Time period for stats |

### claim_escalation

Claim an escalation for a time-boxed lock.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Escalation ID |
| duration_minutes | integer | No | Lock duration |

### release_escalation

Release a claimed escalation back to the available pool (reverses `claim_escalation`).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Escalation ID to release |

### resolve_escalation

Resolve a pending escalation with a human-provided payload. Routes by escalation
shape: efficient (`signal_key`) escalations resume the waiting workflow in place;
legacy paths signal via routing metadata or re-run the original workflow. Password
fields in the payload are replaced with ephemeral tokens.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Escalation ID to resolve |
| resolverPayload | object | Yes | Resolution payload |

### resolve_by_signal_key

Resolve an efficient (atomic) escalation directly by its `signal_key` and resume
the waiting workflow in place. For callers that know the deterministic signal id
and want to skip the id lookup.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| signalKey | string | Yes | Deterministic signal key of the escalation |
| resolverPayload | object | Yes | Resolution payload |

### accumulate_item

Add one item to an open accumulator escalation. Interim adds return outcome `accepted` with the count held and the remaining slots. The add that reaches max completes the row and wakes the waiting workflow with the ordered collection. A reciprocal row is written in the same statement, both or neither.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Accumulator escalation UUID (the container) |
| itemKey | string | Yes | Key the item is held under |
| payload | object | No | Item payload, delivered inside `$accumulated` |
| metadata | object | No | Merge patch for the container metadata, same statement |
| reciprocal | object | No | A second accumulator row written in the same statement. Exactly one of `id`, `signalKey`, or `key`/`value` |
| initiatedBy | string | No | `lt_users.id` of the person the add is for, recorded as the entry actor (attribution only) |

### remove_item

Remove one held item from a pending open accumulator escalation. The row stays pending and the waiting workflow stays asleep.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Accumulator escalation UUID |
| itemKey | string | Yes | Held item key to remove |
| reciprocal | object | No | A second accumulator row written in the same statement. Exactly one of `id`, `signalKey`, or `key`/`value` |
| initiatedBy | string | No | `lt_users.id` of the person the removal is for, recorded as the entry actor (attribution only) |

### get_escalation_items

The held items of an accumulator or batch escalation in arrival order, with the count and max. Select by `id` or by `signalKey`.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | No | Accumulator or batch escalation UUID |
| signalKey | string | No | The row's `signal_key`, when the caller knows the signal id rather than the row id |

### escalate_escalation

Route a pending escalation to a different role per the escalation chain.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Escalation ID |
| targetRole | string | Yes | Role to route the escalation to |

### cancel_escalation

Permanently cancel a pending escalation (e.g. its workflow has terminated and can
never receive the resolution signal). Preserved for audit.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Escalation ID to cancel |

### release_expired_claims

Release all escalation claims that exceeded their lock duration.

| | |
|---|---|
| Read-safe | No |

**Parameters:** None.

### bulk_triage

Resolve escalations for triage and start mcpTriage workflows. Rows backing a
live `condition()` waiter (`signal_key` set) stay `pending` and are excluded
from the result — settle those with the targeted resolve, which carries the
workflow's wake.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation IDs to triage |
| hint | string | No | Triage hint |

### find_by_metadata

Find escalations by a metadata key-value pair — e.g. a correlation key (order id,
ticket id, request id) written into metadata when the escalation was raised.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Metadata key |
| value | string | Yes | Metadata value |
| status | string | No | Filter by status |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### claim_by_metadata

Find and claim an escalation by metadata key-value pair.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Metadata key |
| value | string | Yes | Metadata value |
| durationMinutes | integer | No | Lock duration |
| assignee | string | No | Assignee |
| metadata | object | No | Additional metadata |

### resolve_by_metadata

Find and resolve an escalation by metadata key-value pair.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Metadata key |
| value | string | Yes | Metadata value |
| resolverPayload | object | Yes | Resolution payload |
| assignee | string | No | Assignee |
| metadata | object | No | Additional metadata |

### bulk_claim

Claim multiple escalations in a single operation.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation IDs |
| durationMinutes | integer | No | Lock duration |

### bulk_assign

Assign multiple escalations to a specific user.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation IDs |
| targetUserId | string | Yes | User to assign to |
| durationMinutes | integer | No | Lock duration |

### bulk_unassign

Return claimed escalations to the available pool. This is the admin override of a live claim; a claimant returning their own row uses `release_escalation`. Unclaimed and terminal rows are skipped.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation UUIDs to return to the pool |

### bulk_escalate

Escalate multiple escalations to a different role.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation IDs |
| targetRole | string | Yes | Target role |

### bulk_cancel

Cancel multiple pending escalations in a single operation.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation IDs to cancel |

### update_priority

Update the priority of multiple escalations.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation IDs |
| priority | integer | Yes | New priority value |

### resolve_by_ids

Resolve a set of escalations by id in one guarded statement, for rows woken collectively (no per-row signal delivery). Callers may resolve only rows whose role they hold.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ids | string[] | Yes | Escalation ids to resolve as one set |
| resolverPayload | object | Yes | Resolution payload applied to every row |
| metadata | object | No | Outcome patch merged into each row |

### search_by_facets

Faceted search over a pond, scoped to the caller's role. Filter by type, status, availability, and metadata facets; sort by columns; page with `limit`/`offset`.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Pond role to target (the escalation role) |
| types | string[] | No | Only rows whose escalation type is one of these |
| subtypes | string[] | No | Only rows whose escalation subtype is one of these |
| status | string | No | Status filter (e.g. `pending`) |
| available | boolean | No | Only rows not currently claimed |
| facets | object | No | Metadata facet equality filters |
| orderBy | object[] | No | Sort order over columns |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### claim_groups

Batch-claim complete origin groups (orders) in priority order over a pond, assigned to the calling principal. Scoped to the pond role.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | object | Yes | Facet query selecting the pond |
| limit | integer | No | Max groups to claim |
| durationMinutes | integer | No | Claim TTL in minutes |
| sizeFacet | string | No | Metadata key holding the group size |

### claim_by_facets

Batch-claim individual rows matching a facet query (`FOR UPDATE SKIP LOCKED`), assigned to the calling principal. Scoped to the pond role.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | object | Yes | Facet query selecting the rows |
| limit | integer | No | Max rows to claim |
| durationMinutes | integer | No | Claim TTL in minutes |
| allOrNone | boolean | No | Commit only if the full limit was acquired |

### aggregate_by_facets

Grouped analytics over the escalation intervals. Every escalation is one open
interval `[created_at, ended_at)`; this tool reads it two ways: **membership**
(rows or, with `distinctBy`, distinct entities open at an instant — a past
`asOf` reconstructs the live set then) and **dwell** (open-seconds per group
within a half-open `[from, to)` window). Group by role/subtype/status columns
plus metadata facet keys; optional `states[]` label each group. One call
replaces N per-filter count round-trips. Mirrors
`POST /api/escalations/aggregate-by-facets`.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | object | Yes | The filter (WHAT only — no status/available/jeopardy): `role`/`roles` or `entity` (the entity facet key, resolved to every role declaring it — the entity's system), plus `facets`, `block`, `range`, `exists` |
| groupBy | object | Yes | Group keys: `columns` (`role`, `subtype`, `status`), `facets` (metadata keys), `state` (derived state label per each role's `entity_state_source`; mutually exclusive with `states`). Empty object → one total row |
| measure | object | Yes | `{ kind: "membership", asOf? }` or `{ kind: "dwell", window: { from, to } }` |
| distinctBy | string | No | Membership only: count DISTINCT of this metadata facet (entities, not rows) |
| states | array | No | Pure labeling: tag each group with the FIRST matching state name |
| liveStatuses | string[] | No | Statuses considered live (default `["pending"]`) |
| orderBy | array | No | Order the RESULT groups: `{ field, direction? }` |
| limit | integer | No | Max result groups (server-capped; `overflow` flag when more exist) |
| offset | integer | No | Result-group offset |

### timeline_by_facet

One entity's ordered interval sequence — every escalation the entity facet
(e.g. a machine id) appeared in, as `[startedAt, endedAt)` spans with durations,
in `created_at` order. Open intervals report `endedAt: null`. Gaps between
consecutive intervals are untracked time and are preserved, not filled. The
entity facet value must be stored as a JSON string (GIN containment match).
Mirrors `POST /api/escalations/timeline-by-facet`.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| facet | object | Yes | `{ key, value }` — the entity facet to trace |
| query | object | No | Optional extra filter / role scope (or `entity` — the derived system) |
| window | object | No | `{ from, to }` — only intervals overlapping this window (overlap-filtered, not clipped) |
| select | object | No | `columns` / `facets` to surface per interval (default: all three columns) |
| liveStatuses | string[] | No | Statuses considered live (default `["pending"]`) |
| limit | integer | No | Max intervals |

## Workflow Configuration

### list_workflow_configs

List all certified workflow configurations with roles and settings.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### get_workflow_config

The full configuration row for one workflow, plus `tier` (`registered` or `certified`) and `input_lookup_data`: the pinned `input_lookups` resolved into the form-context shape the input form reads, keyed `<as ?? key>`, or `null` when none are pinned. Call it before `invoke_workflow` to read the `input_schema` a payload must satisfy and the `envelope_schema.metadata` every run starts from.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_type | string | Yes | Registered workflow type name |

### upsert_workflow_config

Create or replace a workflow configuration (certify). Activates the interceptor for task tracking and escalation chains. Full replace, matching `PUT /api/workflows/:type/config`: omitted fields clear to their defaults, so send the whole profile (start from `get_workflow_config`).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_type | string | Yes | Workflow type identifier |
| invocable | boolean | No | Whether the workflow can be invoked externally |
| certified | boolean | No | Explicit HITL certification (interceptor treatment). Omitted → derived from roles/consumes presence. |
| task_queue | string | No | HotMesh task queue |
| default_role | string | No | Default escalation role |
| description | string | No | Workflow description |
| execute_as | string | No | Execution identity |
| roles | string[] | No | Interceptor default for who resolves interceptor-raised escalations |
| invocation_roles | string[] | No | Roles allowed to invoke |
| consumes | string[] | No | Event topics consumed |
| tool_tags | string[] | No | Tool tags for routing |
| cron_schedule | string | No | Cron schedule expression |
| envelope_schema | object | No | Envelope template; the dashboard stamps its `metadata` on runs it starts |
| input_schema | object | No | x-lt-* JSON Schema for the invoke form; invoke validates `data` against it |
| input_lookups | `{ domain, key, version, as? }[]` | No | Versioned knowledge refs the invoke form reads as `lookup.<as ?? key>`; malformed refs are refused |
| icon | string | No | Curated icon name from `WORKFLOW_ICONS`; unknown names are refused |
| read_safe | boolean | No | Side-effect-free; eligible for `invoke_workflow_read_safe` |

### delete_workflow_config

Unregister a workflow by deleting its config entry. To demote certified → registered while keeping the registration, use `upsert_workflow_config` with `certified: false`.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_type | string | Yes | Workflow type to remove |

## Workflows

### list_discovered_workflows

Unified list of all known workflows: active workers, historical entities, and registered configs.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| include_system | boolean | No | Include system workflows |

### invoke_workflow

Start a certified workflow by type. Returns workflow ID immediately. Call `get_workflow_config` for the `input_schema` the payload must satisfy. The input gate validates against the `metadata` the caller sends.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_type | string | Yes | Workflow type to invoke |
| data | object | Yes | Input data; validated against `input_schema` when the config declares one |
| metadata | object | No | Control flow metadata passed as `envelope.metadata` |
| execute_as | string | No | Execution identity |
| options | object | No | HotMesh WorkflowOptions passthrough (`workflowId`, `entity`, `expire`, `search`) |

**Errors:**

| Result | Meaning |
|--------|---------|
| `isError` with `{ "error": "data failed input schema validation (n violations)", "code": "schema_validation", "violations": [{ "field", "message" }], "role": null, "schemaVersion": null, "workflowType" }` | The config declares `input_schema` and `data` violates it; nothing starts |

### invoke_workflow_read_safe

Start a workflow registered read-safe (side-effect-free). Same contract as `invoke_workflow`, including the input gate and metadata merge, gated to configs carrying `read_safe: true`. Any workflow may be attempted; one without the flag, or one not invocable, fails with a clear error. The invocation surface for read-scoped callers.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** Same as `invoke_workflow`.

### get_workflow_status

Check workflow status and result. Returns status (`running` | `complete` | `failed`)
and the result when complete; a failed run carries `terminated` (true when an
interrupt ended it) and `error`. Resolution is namespace-aware — pass `app_id` to read a
workflow (e.g. a child) running in a non-default HotMesh namespace. Readable by a builder,
or by the person who started the run or the account it runs as.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID to check |
| app_id | string | No | HotMesh namespace for resolution (default: durable) |

### terminate_workflow

Terminate a workflow: kills the durable handle and cancels the workflow's pending escalations. Use this to stop a workflow. `interrupt_pipeline_job` is an engine-level interrupt that leaves escalation rows stranded as orphans.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | HotMesh workflow ID to terminate |

## MCP Servers

### list_mcp_servers

List registered MCP servers with optional filters by status, tags, or search.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status |
| tags | string | No | Filter by tags |
| search | string | No | Search term |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### update_mcp_server

Update an MCP server registration (tags, description, auto_connect).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Server ID |
| name | string | No | Server name |
| description | string | No | Description |
| tags | string[] | No | Tags |
| auto_connect | boolean | No | Auto-connect on startup |

### connect_mcp_server

Connect to a registered MCP server.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Server ID |

### disconnect_mcp_server

Disconnect from an MCP server.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Server ID |

## YAML Workflows

### list_yaml_workflows

List compiled YAML workflows with optional status, namespace, or search filter.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status |
| app_id | string | No | Filter by namespace |
| search | string | No | Search term |
| source_workflow_id | string | No | Filter by source workflow |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### get_yaml_workflow

Inspect a compiled workflow by ID. Returns activity manifest, schemas, and YAML content.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Workflow ID |

### create_yaml_workflow

Compile a completed execution into a deterministic YAML workflow. Stored as a draft.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Source execution workflow ID |
| task_queue | string | Yes | HotMesh task queue |
| workflow_name | string | Yes | Workflow name |
| name | string | Yes | Display name |
| description | string | No | Description |
| app_id | string | No | Namespace |
| tags | string[] | No | Tags |
| compilation_feedback | string | No | Compilation guidance |

### deploy_yaml_workflow

Deploy a compiled YAML workflow, activate it, and register workers.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Workflow ID to deploy |

### invoke_yaml_workflow

Run a compiled YAML workflow. Deterministic — no LLM. Set sync=true to wait.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Workflow ID to invoke |
| data | object | No | Input data |
| sync | boolean | No | Wait for result |
| timeout | integer | No | Max wait time in ms (sync mode) |

## Users & Roles

### list_users

List user accounts with optional role and status filters.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | No | Filter by role |
| status | string | No | Filter by status |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### create_user

Create a new user account with optional roles.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| external_id | string | Yes | External identifier |
| display_name | string | No | Display name |
| email | string | No | Email address |
| roles | object[] | No | Roles array (each: `role`, `type`: superadmin/admin/member, optional `read_scope`, `write_scope`) |

Each role entry may carry a member work-surface scope: `read_scope` (`self` \| `all`, default `all`) and `write_scope` (`none` \| `self` \| `all`, default `all`), with write ⊆ read. This is how a one-time user is provisioned — e.g. `{ "role": "customer-triage", "type": "member", "read_scope": "self", "write_scope": "self" }` for someone who only handles their own pre-assigned escalation.

### add_user_role

Assign a role to a user. For a `member`, optional scope narrows the work surface.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User ID |
| role | string | Yes | Role name |
| type | string | Yes | Role type: superadmin, admin, or member |
| read_scope | string | No | Member search breadth: `self` or `all` (default `all`) |
| write_scope | string | No | Member claim/ack/delete breadth: `none`, `self`, or `all` (default `all`) |

### patch_user_properties

Atomically patch a user's properties dictionary (`lt_users.metadata`) — set/remove/rename keys in one statement, never read-merge-write. Identity-binding keys (badge scheme target facets) assert uniqueness among active users.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User UUID |
| set | object | No | Properties to set — typed JSON values |
| remove | array | No | Property keys to delete |
| rename | object | No | `{ oldKey: newKey }` renames — values preserved |

### remove_user_role

Remove a role from a user.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User ID |
| role | string | Yes | Role name to remove |

### list_roles

List all distinct roles known to the system.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### create_role

Create a new role. Lowercase alphanumeric with hyphens/underscores.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Role name |

### update_role

Update a role's metadata: display name, description, form schema, metadata schema, free properties bag, operations visibility, process parent, and the typed operational targets (SLA minutes, throughput goal, worker count). Only provided fields are changed. A change to `form_schema` or `metadata_schema` snapshots the new pair into the role's schema version history and advances its current version.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Role key to update |
| `title` | `string \| null` | No | Display name |
| `description` | `string \| null` | No | Short description |
| `form_schema` | `object \| null` | No | JSON Schema for the escalation resolve form |
| `metadata_schema` | `object \| null` | No | JSON Schema for `lt_escalations.metadata` shape validation |
| `properties` | `object \| null` | No | Free user-owned bag (icon, color, tags, etc.) |
| `ops_visible` | `boolean` | No | When `true`, role appears as a station on the Operations view |
| `parent_role` | `string \| null` | No | Parent role in the process dependency graph |
| `sla_minutes` | `number \| null` | No | Target resolution time in minutes |
| `target_per_hour` | `number \| null` | No | Throughput goal (items resolved per hour) |
| `worker_count` | `number \| null` | No | Station capacity (staff or machines) |
| `priority_threshold_minutes` | `number \| null` | No | Priority age threshold in minutes; falls back to `sla_minutes` |
| `priority_facet` | `string \| null` | No | Metadata key for the priority age origin (ISO 8601 UTC); falls back to `created_at` |
| `upstream_roles` | `string[] \| null` | No | Replace the set of roles this station draws input from across other Operations sequences (omitted = preserve; `null` or `[]` = clear) |
| `change_summary` | `string` | No | Label recorded on the schema version snapshot when this update changes a schema field |

### get_role_schema

Fetch a role's `form_schema` + `metadata_schema` pair. With `version`, reads that immutable snapshot from the version history (the one an escalation pinned via `metadata.schema_version`); without it, reads the live (latest) schema and its current version number.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Role whose schema to fetch |
| version | number | No | Version pin (positive integer) |

### list_role_schema_versions

List a role's schema version history, newest first. Each entry carries the version, presence flags for the two schemas, the change summary, and whether it is the current version.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Role whose history to list |

### add_escalation_chain

Define an escalation path from one role to another.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| source_role | string | Yes | Source role |
| target_role | string | Yes | Target role |

## Personas

A persona is a named role bundle: each linked role carries a relationship scope, and assigning the persona to a user adds the user to every linked role at that scope. Holder memberships are reconciled whenever a link changes.

### list_personas

List all personas with their role links and holder counts.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### get_persona

Fetch one persona with its role links and current assignees.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Persona key |

### create_persona

Create a persona. Link roles with `link_persona_role`, then assign users with `assign_persona`.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Stable key (a-z, 0-9, hyphens, underscores; starts with a letter) |
| title | string | No | Display title, e.g. "Print Manager" |
| description | string | No | One-paragraph description of the persona's day |

### update_persona

Update a persona's title or description with PATCH semantics: omitted fields keep their values, `null` clears.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Persona key to update |
| title | string \| null | No | New display title (`null` clears) |
| description | string \| null | No | New description (`null` clears) |

### delete_persona

Delete a persona. Memberships it sustains are removed, or re-homed to a sibling persona the user still holds. Direct grants stay as they are.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Persona key to delete |

### link_persona_role

Link a role to a persona, or change an existing link's relationship. Every current holder's memberships are reconciled in the same transaction.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Persona key |
| role | string | Yes | Role to link (created if absent) |
| relationship | string | Yes | `write-all` (full worker), `write-self` (acts on own assignments), `read-all` (observer), or `write-none` (same as `read-all`) |

### unlink_persona_role

Remove a role link from a persona and reconcile every holder's memberships.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Persona key |
| role | string | Yes | Role link to remove |

### assign_persona

Assign a persona to a user, adding the user to each linked role at the linked scope. Idempotent: re-assigning overlays fresh from the persona's current links. When bundles overlap the highest allowance wins, and direct grants are only raised.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User UUID |
| key | string | Yes | Persona key |

### unassign_persona

Unassign a persona from a user. Removes only the memberships the persona sustains; rows another held persona still grants are re-homed to it, and direct grants stay as they are.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User UUID |
| key | string | Yes | Persona key |

### get_user_personas

The personas a user holds plus the composed role and scope map their memberships form. Each row names its sustaining persona, or `null` for a direct grant.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User UUID |

## Maintenance

### prune

Prune expired jobs, streams, and execution artifacts from the database.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| expire | string | No | Expiration threshold |
| jobs | boolean | No | Prune jobs |
| streams | boolean | No | Prune streams |
| entities | string[] | No | Specific entities to prune |
| prune_transient | boolean | No | Prune transient data |

## Agents

### list_agents

List agent automations with optional status and knowledge domain filters.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status |
| knowledge_domain | string | No | Filter by knowledge domain |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### get_agent

Get a single agent automation by ID with aggregated stats.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Agent ID |

### create_agent

Create a new agent automation with identity, goals, rules, and subscriptions.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Agent ID |
| description | string | No | Agent description |
| goals | string[] | No | Agent goals |
| rules | string[] | No | Agent rules |
| status | string | No | Initial status |
| knowledge_domain | string | No | Knowledge domain |
| schedules | array | No | Cron schedules |
| subscriptions | array | No | Event subscriptions |

### update_agent

Update an existing agent automation.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Agent ID |
| description | string | No | Agent description |
| goals | string[] | No | Agent goals |
| rules | string[] | No | Agent rules |
| status | string | No | Status |
| knowledge_domain | string | No | Knowledge domain |

### delete_agent

Delete an agent automation and all its subscriptions.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Agent ID |

## Agent Subscriptions

### list_agent_subscriptions

List all event subscriptions for an agent.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| agent_id | string | Yes | Agent ID |

### create_agent_subscription

Create an event subscription for an agent.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| agent_id | string | Yes | Agent ID |
| topic | string | Yes | Event topic |
| reaction_type | string | Yes | Reaction type |
| workflow_type | string | No | Workflow to trigger |
| pipeline_id | string | No | Pipeline to trigger |
| mcp_prompt | string | No | MCP prompt for dynamic reaction |
| input_mapping | object | No | Input data mapping |
| filter | object | No | Event filter |
| execute_as | string | No | Execution identity |

### delete_agent_subscription

Delete an event subscription by ID.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Subscription ID |

## Bot Accounts

### list_bot_accounts

List all bot (service) accounts with pagination.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### get_bot_account

Get a single bot account by ID.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Bot account ID |

### create_bot_account

Create a new bot (service) account with optional roles.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Bot account name |
| description | string | No | Description |
| display_name | string | No | Display name |
| roles | object[] | No | Roles (each: role, type) |

### update_bot_account

Update a bot account (display name, description, status).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Bot account ID |
| display_name | string | No | Display name |
| description | string | No | Description |
| status | string | No | Status |

### delete_bot_account

Delete a bot account and all its API keys.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Bot account ID |

### create_bot_api_key

Generate a new API key for a bot account. Returns the raw key ONCE.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Bot account ID |
| name | string | Yes | Key name |
| scopes | string[] | No | Access scopes |
| expires_at | string | No | Expiration timestamp |

### revoke_bot_api_key

Revoke (delete) an API key for a bot account.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key_id | string | Yes | API key ID |

## Control Plane

### list_apps

List available HotMesh application namespaces.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### rollcall

Execute a roll call — discovers all engines and workers in the mesh.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | **Yes** | App namespace |
| delay | integer | No | Delay in ms |

### apply_throttle

Apply a throttle to the mesh (-1=pause, 0=resume, >0=delay ms per message).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| throttle | integer | Yes | Throttle value (-1=pause, 0=resume, >0=delay ms) |
| appId | string | **Yes** | App namespace |
| topic | string | No | Topic to throttle |
| guid | string | No | Specific GUID |
| scope | string | No | Throttle scope |

### get_stream_stats

Stream processing statistics — pending count and processed volume by time range.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | **Yes** | App namespace |
| duration | string | No | Time range |
| stream | string | No | Specific stream |

### list_stream_messages

Browse stream messages with pagination, filtering, and sorting.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| namespace | string | Yes | App namespace |
| source | string | Yes | Stream source |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |
| sort_by | string | No | Sort field |
| order | string | No | asc or desc |
| status | string | No | Filter by status |
| stream_name | string | No | Filter by stream name |
| msg_type | string | No | Filter by message type |
| topic | string | No | Filter by topic |
| workflow_name | string | No | Filter by workflow name |
| jid | string | No | Filter by job ID |
| aid | string | No | Filter by activity ID |
| dad | string | No | Filter by dimension/ancestor path (worker-only) — pins one execution among siblings sharing an aid |

## Diagnostics

Read-only inspection of workflow execution. These tools never mutate state —
HotMesh execution only moves forward and cannot be unwound, so they describe what
happened and where to look, not how to "fix" a job.

**Read this first — what is and isn't a problem.** A workflow suspended at a
`condition()` / `waitFor()` / `sleepFor()` can sit idle for days legitimately,
and HotMesh only bumps `updated_at` when a job's status changes. A frozen
`updated_at` is therefore the *normal* signature of a wait, **not** a fault. A
reservation whose holder died self-heals: the message redelivers once the
reclaim window lapses (~90s worst case) and the activity re-executes. The
genuinely broken signals are: a dead-lettered message (retries exhausted), a
reservation still held past several reclaim windows, and a suspended waiter
with **no** escalation row.

**Recommended flow:** start fleet-wide with `find_orphaned_signals` (the
genuinely-broken case) or `find_stalled_jobs` (candidates worth a look), then run
`diagnose_job` on a specific id for root cause. `diagnose_job` is compact by
default — the verdict only. Opt into the heavy arrays with `include`, and for the
full raw JSONB of a specific message use `list_stream_messages` (Control Plane)
filtered by `jid` (and `aid`/`dad`).

### diagnose_job

Read-only diagnosis of one workflow. **Compact by default** — returns the verdict
only: `status`, `idle_for_ms`, `workflow_type`, `stream_summary` (counts), the
`escalation` summary, and structured `findings[]` with confidence, evidence, and
read-only guidance. Classifies a healthy long-wait as such rather than flagging it
as stalled.

To opt into the heavy arrays pass `include: ["events"]` for the execution timeline
and/or `include: ["streams"]` for raw engine+worker messages (`verbosity: "full"`
adds both). Large `result`/`message` payloads are summarized to
`{ bytes, preview, truncated }`; for full untruncated payloads use
`list_stream_messages` filtered by `jid` (surfaced as `raw_messages` when streams
are omitted).

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow (job) ID to diagnose |
| app_id | string | No | HotMesh namespace / DB schema (default: durable) |
| include | string[] | No | Heavy sections to add: `events`, `streams`. Omit for the compact verdict. |
| verbosity | string | No | `summary` (default, verdict only) or `full` (events + streams) |
| max_events | integer | No | Cap on execution events returned when included, most recent kept (default: 500). Use `list_stream_messages` for full payloads. |

### find_stalled_jobs

Find running jobs with no status change in N minutes (bounded, indexed). Each
result is classified `likely`: `waiting` (has a pending escalation — healthy) or
`no_recent_progress` (worth a closer look). Triage the `no_recent_progress` rows
with `diagnose_job`.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | No | HotMesh namespace / DB schema (default: durable) |
| idle_minutes | integer | No | Minimum minutes since last status change (default: 5) |
| workflow_type | string | No | Filter by workflow function name |
| limit | integer | No | Max results (default: 50, max: 200) |

### find_orphaned_signals

Find running workflows suspended at a `condition()` (waiter committed, signal
registered) that have **no** escalation row — the genuinely broken case: the
workflow waits for a signal nothing will send. Scans a recent time window only,
so it never degenerates into a full-history scan of the partitioned
`worker_streams` table.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | No | HotMesh namespace / DB schema (default: durable) |
| within_hours | integer | No | Recent window to scan, in hours (default: 24, max: 720). Widen to reach older orphans; narrow to go faster. |
| limit | integer | No | Max results (default: 100, max: 500) |

### Example prompts

- "Diagnose workflow `ortho-eff-1782084825-b9-3-2-printer-0` and tell me whether it's a healthy wait or genuinely stuck."
- "Find any orphaned signals in the last 48 hours and summarize the common cause."
- "List stalled jobs of type `printerEfficient` idle more than 30 minutes, then diagnose the ones classified `no_recent_progress`."
- "Are there dead-lettered messages or reservation leaks behind job `<id>`? Show the evidence."
- "Diagnose `<id>`, then pull the raw worker stream message for its failing activity so I can see the full input payload."
- "Scan the fleet for genuinely broken workflows (not normal waits) and give me the job IDs to investigate."

## Pipelines

### list_pipeline_entities

List distinct entity (tool) names from pipeline jobs.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | **Yes** | App namespace |

### list_pipeline_jobs

List pipeline jobs with optional entity, search, and status filters.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | **Yes** | App namespace |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |
| entity | string | No | Filter by entity |
| search | string | No | Search term |
| status | string | No | Filter by status |
| sort_by | string | No | Sort field |
| order | string | No | asc or desc |

### get_pipeline_execution

Export execution details for a specific pipeline job.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| job_id | string | Yes | Pipeline job ID |
| app_id | string | **Yes** | App namespace |

### interrupt_pipeline_job

Interrupt a running pipeline job.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| job_id | string | Yes | Pipeline job ID |
| topic | string | Yes | Pipeline topic |
| app_id | string | **Yes** | App namespace |

## Topics

### list_topics

List topics in the event catalog with optional category and search filters.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| category | string | No | Filter by category |
| search | string | No | Search term |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

### get_topic

Get a single topic by name, including schema and example payload.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Topic name |

### create_topic

Register a new topic in the event catalog.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Topic name |
| category | string | Yes | Topic category |
| description | string | No | Description |
| payload_schema | object | No | JSON Schema for payload |
| example_payload | object | No | Example payload |
| tags | string[] | No | Tags |

### update_topic

Update a topic in the event catalog.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Topic name |
| description | string | No | Description |
| category | string | No | Category |
| payload_schema | object | No | JSON Schema for payload |
| example_payload | object | No | Example payload |
| tags | string[] | No | Tags |

### delete_topic

Delete a topic from the catalog (system topics are protected).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Topic name |

## Settings

### get_settings

Get frontend-relevant configuration (no secrets). Returns feature flags, enabled capabilities, and system metadata.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

## Exports

### list_export_jobs

List workflow jobs with optional filtering and pagination.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |
| entity | string | No | Filter by entity |
| search | string | No | Search term |
| status | string | No | Filter by status |
| sort_by | string | No | Sort field |
| order | string | No | asc or desc |

### export_workflow_state

Export the full workflow state using HotMesh durable export.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID to export |
| allow | string[] | No | Fields to include |
| block | string[] | No | Fields to exclude |
| values | object | No | Override values |

### export_workflow_execution

Export workflow state as a structured execution event history. Readable by a builder, or by the person who started the run or the account it runs as.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID to export |
| excludeSystem | boolean | No | Exclude system events |
| omitResults | boolean | No | Omit result payloads |
| mode | string | No | Export mode |
| maxDepth | integer | No | Max traversal depth |

### get_workflow_envelopes

The workflow's input and output envelopes — two narrow lookups, no event stream. Output is `null` with status `running` until the workflow completes; a failed run carries its error message. The token-cheap read when you only need what went in and what came out.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID whose input/output envelopes to fetch |

### get_export_status

Return the numeric status semaphore for a workflow.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID |

## Overview

### get_system_overview

Triage-ready system state in one call: escalation queue pressure (aging, unclaimed, by role), task throughput (created, completed, failed), hourly trends, infrastructure status (MCP servers, agents, compiled workflows), and a business process summary.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| period | string | No | Time window for trends and throughput: `1h`, `24h` (default), or `7d` |

## Domain Context

### get_domain_context

The deployment's domain dictionary merged with live platform state: how the operation's jargon maps to roles, workflows, escalations, and metadata facets. With no arguments it returns the overview and index; `{ topic, name }` returns specific entries. Topic `term` looks a word or alias up across every kind. With no dictionary registered it serves a view derived from the live registries. See [Domain Dictionary](../../domain-dictionary.md).

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | No | `term`, `entity`, `role`, `workflow`, `facet`, `action`, `rule`, or `runbook`. Omit for the overview and index |
| name | string | No | One entry: a term or alias (case-insensitive), a live role name, a workflow type, or a runbook name |

## Scan Codes

Scan codes have the form `version:category:target`. A scheme defines how a code parses and which metadata facet the target resolves against; a rule defines the steps a category runs. See [Scan Codes](../../scan-codes.md).

### execute_scan_code

Execute a raw scan code. Parses it against the configured schemes, walks the rule's condition and action steps, and returns a structured outcome (`executed`, `confirm_required`, `matched_list`, `no_match_fallback`, `unconfigured`, `invalid_code`, `forbidden`, `conflict`). Identity schemes mint an acting-identity grant.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes | Raw scan string, e.g. `10:1:SN123` or `10175433211` |
| actingToken | string | No | Acting-identity grant (`eph:v1:acting_identity:*`); verbs run as the badged person |
| previousActingToken | string | No | The grant an identity scan replaces, revoked on mint (best effort) |

### execute_scan_choice

Execute one choice presented by a PRESENT step. The pointer (scheme, category, step, choice, escalation) is re-validated against live config, the row's current state, the acting-identity gate, and RBAC before the verb runs.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schemeVersion | integer | Yes | Scheme version of the presented choice |
| category | string | Yes | Rule category |
| stepIndex | integer | Yes | Index of the PRESENT step |
| choiceIndex | integer | Yes | Index of the chosen option |
| escalationId | string | Yes | Escalation the choice screen presented |
| actingToken | string | No | Acting-identity grant; the choice attributes to the badged person |

### list_scan_schemes

List all scan-code schemes: version, name, target facet, and encoding.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### upsert_scan_scheme

Create or replace a scan scheme: which metadata facet the scanned target resolves against and how the code string parses (fixed digits or delimited text). `kind: identity` makes the scheme a badge layer that mints acting-identity grants.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | integer | Yes | Two-digit scheme version (10-99) |
| name | string | Yes | Scheme display name |
| description | string | No | Scheme description |
| target_facet | string | Yes | Metadata key the target resolves against: an escalation metadata key for action schemes, an `lt_users.metadata` key (e.g. `badge_id`) for identity schemes |
| encoding | string | No | `fixed` (digits only, UPC) or `delimited` (text with separators) |
| delimiter | string | No | Separator for delimited encoding (default `:`) |
| target_length | integer | No | Target digit count for fixed encoding |
| kind | string | No | `action` (steps over escalations, default) or `identity` (a badge that mints a short-lived acting-identity grant) |
| grant_ttl_seconds | integer | No | Identity kind: lifetime of a minted grant |
| grant_max_uses | integer | No | Identity kind: `0` = TTL-bound; `n` = the grant covers n scan requests |
| enabled | boolean | No | Whether the scheme is active |

### upsert_scan_rule

Create or replace a scan rule for a scheme category: a friendly name, ordered condition and action steps (the first matching query wins), a fallback screen when nothing matches, and a not-primed screen for identity-required steps.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| scheme_version | integer | Yes | Scheme version |
| category | string | Yes | Single-digit category (0-9) |
| name | string | Yes | Friendly label printed next to the physical code |
| steps | object[] | Yes | Ordered condition/action steps; first match wins |
| fallback | object | No | Screen rendered when no step matches (identity schemes: the unknown-badge screen) |
| notPrimed | object | No | "Scan your badge" screen, rendered when an acting identity is required and absent |
| enabled | boolean | No | Whether the rule is active |

### delete_scan_rule

Delete one scan rule by scheme version and category.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| scheme_version | integer | Yes | Scheme version |
| category | string | Yes | Rule category |

## Announcements

### publish_announcement

Publish a dashboard announcement: a banner every targeted user sees live and on their next load until it expires or they dismiss it. Bodies broadcast to all authenticated subscribers, so keep secrets out of them.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| body | string | Yes | Markdown body |
| title | string | No | Headline shown on the collapsed banner |
| layout | string | No | Presentation form (default `banner`) |
| roles | string[] | No | Target roles; omitted = everyone |
| expires_at | string | No | ISO timestamp; omitted = 24 hours from now |
