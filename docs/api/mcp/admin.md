# Admin

Unified system management — tasks, escalations, workflows, agents, bot accounts, control plane, pipelines, topics, users, roles, and settings.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-admin` |
| Category | System |
| AI required | No |
| Credential providers | — |

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

### find_escalations

Search escalations with optional filters by status, role, type, priority.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | pending or resolved |
| role | string | No | Filter by role |
| type | string | No | Filter by type |
| priority | integer | No | Filter by priority |
| limit | integer | No | Max results |
| offset | integer | No | Pagination offset |

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

Find escalations by a metadata key-value pair.

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

Check workflow status and result. Returns status (0=complete, positive=running) and result if complete.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| workflow_id | string | Yes | Workflow ID to check |

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
| roles | object[] | No | Roles array (each: role, type: superadmin/admin/member) |

### add_user_role

Assign a role to a user.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User ID |
| role | string | Yes | Role name |
| type | string | Yes | Role type: superadmin, admin, or member |

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
| app_id | string | No | App namespace |
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
| appId | string | No | App namespace |
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
| app_id | string | No | App namespace |
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

## Pipelines

### list_pipeline_entities

List distinct entity (tool) names from pipeline jobs.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | No | App namespace |

### list_pipeline_jobs

List pipeline jobs with optional entity, search, and status filters.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| app_id | string | No | App namespace |
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
| app_id | string | No | App namespace |

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
| app_id | string | No | App namespace |

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
