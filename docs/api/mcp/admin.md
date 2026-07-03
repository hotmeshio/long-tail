# Admin

Unified system management — tasks, escalations, workflows, diagnostics, agents, bot accounts, control plane, pipelines, topics, users, roles, and settings.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-admin` |
| Category | System |
| AI required | No |
| Credential providers | — |

## Access

Each tool below is marked **Read-safe**. A service-account key scoped `mcp:read` can call the Read-safe tools; the rest (Read-safe: No) change state and require an `mcp:full` key, and the account's role must permit the action on the target. See the MCP guide's [Access](../../mcp.md#access-which-tools-and-which-records) section for the full model.

## Compile Hints

Admin tools modify system configuration. certify_workflow and decertify_workflow change interceptor behavior.

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

Resolve escalations for triage and start mcpTriage workflows.

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

## Workflow Configuration

### list_workflow_configs

List all certified workflow configurations with roles and settings.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### upsert_workflow_config

Create or replace a workflow configuration (certify). Activates the interceptor for task tracking and escalation chains.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_type | string | Yes | Workflow type identifier |
| invocable | boolean | No | Whether the workflow can be invoked externally |
| task_queue | string | No | HotMesh task queue |
| default_role | string | No | Default escalation role |
| description | string | No | Workflow description |
| execute_as | string | No | Execution identity |
| roles | string[] | No | Allowed roles |
| invocation_roles | string[] | No | Roles allowed to invoke |
| consumes | string[] | No | Event topics consumed |
| tool_tags | string[] | No | Tool tags for routing |
| cron_schedule | string | No | Cron schedule expression |

### delete_workflow_config

De-certify a workflow by removing its config entry.

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

Start a certified workflow by type. Returns workflow ID immediately.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_type | string | Yes | Workflow type to invoke |
| data | object | Yes | Input data |
| metadata | object | No | Workflow metadata |
| execute_as | string | No | Execution identity |

### get_workflow_status

Check workflow status and result. Returns status (`running` | `complete`) and the
result when complete. Resolution is namespace-aware — pass `app_id` to read a
workflow (e.g. a child) running in a non-default HotMesh namespace.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID to check |
| app_id | string | No | HotMesh namespace for resolution (default: durable) |

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
`updated_at` is therefore the *normal* signature of a wait, **not** a fault. The
genuinely broken signals are: a dead-lettered message (retries exhausted), a
reservation leak (claimed but never ACK'd past the reclaim window), and a
suspended waiter with **no** escalation row.

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

Export workflow state as a structured execution event history.

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

### get_export_status

Return the numeric status semaphore for a workflow.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID |

## Ortho Pipeline

AI-operable tools for driving the orthotic manufacturing pipeline. Each order passes through eight sequential stages (design → review → print → grind → glue → finish → qa → ship). The pipeline is a HotMesh durable workflow; each stage suspends at a `conditionLT` checkpoint until an escalation is resolved.

A Claude agent loop calls `ortho_submit` to start an order, polls `ortho_pending` to see what's waiting, drives each stage forward with `ortho_complete_stage`, and monitors progress with `ortho_status`.

### ortho_submit

Start a new orthotic manufacturing order through the 8-stage pipeline.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | `string` | Yes | Unique order identifier (e.g. `"ORD-001"`) |
| `item_type` | `string` | Yes | Item type (e.g. `"insole-standard"`, `"insole-diabetic"`) |
| `stages` | `string[]` | No | Override the stage sequence. Default: `["design","review","print","grind","glue","finish","qa","ship"]` |
| `metadata` | `object` | No | Additional order metadata passed through to each stage escalation |

**Returns:** `{ workflow_id, order_id, item_type, stages, message }`

---

### ortho_pending

List open ortho-pipeline stage escalations waiting to be completed.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stage` | `string` | No | Filter to a specific stage (e.g. `"design"`). Omit to see all stages |
| `limit` | `integer` | No | Max results (default: 50) |

**Returns:** `{ count, escalations }` where each escalation includes `id`, `stage`, `order_id`, `item_type`, `description`, `created_at`, `workflow_id`.

---

### ortho_complete_stage

Complete a pending ortho pipeline stage. Claims the escalation and resolves it with notes and outcome data. Resolving automatically advances the workflow — a new escalation for the next stage appears within seconds.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `escalation_id` | `string` | Yes | Escalation ID from `ortho_pending` |
| `notes` | `string` | Yes | Completion notes — what was done, any decisions made |
| `outcome` | `object` | No | Structured outcome data specific to this stage |

**Returns:** `{ resolved, escalation_id, status, message }`

---

### ortho_status

Get the current status and completed stage results for an ortho pipeline workflow.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_id` | `string` | Yes | Workflow ID from `ortho_submit` |

**Returns:** `{ workflow_id, status }` where `status` is `"running"` while in progress or `"complete"` with `result` containing all stage outputs once finished.

---

**Agent loop example:**

```
ortho_submit({ order_id: "ORD-042", item_type: "insole-diabetic" })
→ { workflow_id: "wf-abc123", stages: ["design", "review", ...] }

ortho_pending({ stage: "design" })
→ [{ id: "esc-001", stage: "design", order_id: "ORD-042" }]

ortho_complete_stage({ escalation_id: "esc-001", notes: "3mm heel, D-width approved", outcome: { spec_version: "v2" } })
→ { resolved: true }

... repeat through all 8 stages ...

ortho_status({ workflow_id: "wf-abc123" })
→ { status: "complete", result: { order_id: "ORD-042", results: [...] } }
```
