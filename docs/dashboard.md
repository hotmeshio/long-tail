# Dashboard Guide

The Long Tail dashboard is a React single-page application for managing durable workflows, MCP pipelines, escalations, and system administration. It connects to the Long Tail backend over REST and receives real-time updates via NATS subscriptions.

## Sidebar Navigation

The sidebar organizes pages into five groups.

### Workflows

| Page | Route | Purpose |
|------|-------|---------|
| **Workflow Registry** | `/workflows/registry` | All discovered workflows with tier, queue, and access columns. Configure, certify, or invoke from here. |
| **Invoke Workflow** | `/workflows/start` | Start a workflow immediately or schedule it on a cron. Two-panel layout with workflow selector and envelope editor. |
| **Durable Executions** | `/workflows/executions` | All workflow runs with status, duration, and tier. Click through to task records and escalation history. |

### MCP Workflows

| Page | Route | Purpose |
|------|-------|---------|
| **MCP Tool Designer** | `/mcp/queries` | Design and compile MCP tools. Three modes: Plan (multi-workflow sets), Builder (single tool from execution), and Composer (manual tool design). |
| **MCP Server Tools** | `/mcp/servers` | Browse registered MCP servers and their tools. Register new servers via guided wizard. |
| **MCP Pipeline Tools** | `/mcp/workflows` | YAML pipeline tools available to the orchestrator. Shows compiled deterministic workflows. |
| **Pipeline Executions** | `/mcp/executions` | Execution history for MCP pipelines — both dynamic (agentic) and compiled (deterministic) runs. |

### Work

| Page | Route | Purpose |
|------|-------|---------|
| **Recent Activity** | `/` | Live event stream and business process overview. |
| **Operations** | `/operations` | COO shop-floor view — pace chart of actual-vs-target flow across all ops-visible roles, station table with live metrics, and the station detail panel. Visible to any user with ops or builder access. |
| **Capabilities** | `/capabilities` | Browse MCP servers grouped by capability category. |
| **Agent Automations** | `/agents` | Autonomous event-driven automations. Configure subscriptions, schedules, and knowledge domains. |
| **Topics** | `/topics` | Topic catalog — browse all known event topics with descriptions, schemas, and subscriber counts. |

### Storage

| Page | Route | Purpose |
|------|-------|---------|
| **Files** | `/files` | Browse and manage files in connected storage (MinIO/S3/GCS). |
| **Knowledge** | `/knowledge` | Knowledge base entries for workflow context and retrieval. |

### Admin

| Page | Route | Purpose |
|------|-------|---------|
| **Accounts** | `/admin/users` | User accounts and service accounts (bots). Create, edit, assign roles, manage API keys. |
| **Roles & Permissions** | `/admin/roles` | Define roles and escalation chains. Roles control escalation visibility and invocation access. |
| **DB Maintenance** | `/admin/maintenance` | Database housekeeping — vacuum, reindex, table statistics. |
| **Task Queues** | `/admin/controlplane` | Active task queues, connected workers, queue depth, and worker health. |

### Header

The top navigation bar contains:

- **Home logo** — links to the home page (`/`), which shows all business processes.
- **Quick Query** — a search/prompt field for launching MCP queries directly from the header.
- **Documentation** (BookOpen icon) — toggles an in-app documentation drawer. Each page also has a contextual docs link next to its title that opens the drawer to the relevant section.
- **Inbox** (Inbox icon) — links to `/escalations/queue` (My Escalations). Shows a badge count of pending escalations for the current user's roles.
- **NATS status indicator** — shows connection health.
- **User menu** (User icon) — dropdown with Credentials and Sign Out options.

## Key Pages

### Workflow Registry

Shows every workflow the system has discovered across all registered workers. Each workflow displays one of three tiers:

- **Certified** (ShieldCheck icon) — has an `lt_config_workflows` entry with roles or consumes. Full interceptor tracking, escalation chains, and invocation controls.
- **Configured** (Settings icon) — has a config entry but no roles. Invocation controls and schema-driven forms, but no automatic escalation routing.
- **Durable** (Wrench icon) — registered as a HotMesh worker but not configured. Checkpointed execution and retries, but no interceptor wrapping.

**Columns:** Workflow (pill + description), Queue (bordered pill), Tier (icon + label), Access (escalation roles with shield icon, invocation roles with user-check icon).

**Row actions** (on hover): Play (invoke), Wrench (configure durable), ShieldPlus (certify configured), ShieldOff (de-certify).

**Inline config via `start()`:** Developers can declare workflow profiles directly in the `start()` config by adding a `config` block to any worker entry. This auto-seeds the workflow into `lt_config_workflows` at startup — no manual API calls or dashboard wizard needed. Roles referenced in the config are auto-created.

```typescript
workers: [
  {
    taskQueue: 'my-queue',
    workflow: myWorkflow,
    config: {
      description: 'My workflow description',
      invocable: true,
      roles: ['reviewer', 'admin'],
      envelopeSchema: { data: { field1: '', field2: 0 } },
      resolverSchema: { approved: true, notes: '' },
    },
  },
]
```

**API:** `GET /api/workflows/discovered` returns the unified list. `PUT /api/workflows/:type/config` creates or updates a config entry. `DELETE /api/workflows/:type/config` removes it.

### Invoke Workflow

A two-panel page for starting any invocable workflow. The left sidebar lists invocable workflows using the same pill styling as the registry. Workflows with active cron schedules show a clock icon. The right panel changes based on the selected mode.

**Mode toggle** (top right): Switch between **Start Now** and **Schedule**.

**Start Now** — immediate invocation:
- **Identity summary** — shows who will execute (current user, configured bot, or admin override).
- **Envelope editor** — dual-mode input: a structured form view (when `envelope_schema.data` has scalar fields) or a raw JSON editor. The form auto-generates fields from the schema with inferred types.
- **Start Workflow** button — invokes the workflow and navigates to the executions page.

**Schedule** — recurring cron execution:
- **Cron expression** — enter a standard cron expression (e.g., `0 9 * * 1-5`). A human-readable description appears below the input. Expressions firing more often than once per minute are rejected.
- **Common patterns** — clickable presets for frequent schedules.
- **Cron envelope** — template payload sent on each scheduled invocation.
- **Recent executions** — table showing the last 10 runs of the selected workflow.

**API:** `POST /api/workflows/:type/invoke` starts a workflow. `PUT /api/workflows/:type/config` with `cron_schedule` sets up recurring execution.

### MCP Tool Designer

The MCP Tool Designer page lists previous tool design sessions and provides entry points for creating new MCP tools. Three design modes are available:

**Plan mode** — decomposes a specification into a multi-workflow set. Four-step wizard:
1. **Plan** — submit a specification; the planner breaks it into individual tools.
2. **Profile** — configure each tool's namespace, name, description, and tags.
3. **Deploy** — review compiled YAML DAGs and deploy as a set.
4. **Test** — run the compiled workflows and verify results.

**Builder mode** — compiles a single tool from a completed dynamic execution. Four-step wizard:
1. **Describe** — view the original dynamic execution: input and structured output.
2. **Profile** — configure the tool's namespace, name, description, and tags.
3. **Deploy** — review the compiled YAML DAG, input/output schemas. Deploy and activate.
4. **Test** — run the compiled workflow and compare against the original execution.

**Composer mode** — manual tool design for building tools from scratch using the visual DAG editor.

Steps unlock sequentially in each wizard. Compiled tools appear in **MCP Pipeline Tools** and **Pipeline Executions**. See the [Compilation Pipeline](compilation.md) guide for details.

### MCP Server Tools

Browse all registered MCP servers and their exposed tools.

- **Server list** — each row shows server name, transport type (stdio, SSE, streamable HTTP), status (connected/disconnected), and tool count.
- **Register Server** button — opens a guided wizard: choose transport, configure connection, discover tools, review and save.
- **Server detail** — click any row to view and edit. Shows all exposed tools with their input schemas, tags, compile hints, and credential providers. Tools are the building blocks that the MCP Tool Designer compiles into deterministic pipelines.

**API:** `GET /api/mcp-servers` lists servers. `POST /api/mcp-servers` registers a new one. `GET /api/mcp-servers/:id/tools` lists tools for a server.

### MCP Pipeline Tools

Deterministic tools compiled from dynamic MCP executions. Each tool is a YAML DAG that the `mcpQueryRouter` discovers and invokes automatically — faster and cheaper than re-running the original agentic loop.

**Page layout:** Tools are grouped by namespace (app_id). Expand a namespace to see its individual tools. Each tool row shows name, status, and action buttons.

**Tool lifecycle:** draft → deployed → active → archived. Only active tools are discoverable by the router. Archived tools are hidden but retained for history.

**Source workflows:** Tools originate from dynamic MCP executions (mcpQuery, mcpTriage) or the planner/builder wizards (mcpWorkflowPlanner, mcpWorkflowBuilder). Click "Design Pipeline" to start a new compilation in the MCP Tool Designer.

**Row actions:**
- **Try** — opens a side panel to invoke the tool with test input and see results.
- **Cron** — opens a side panel to configure a recurring schedule for the tool.
- **Wizard** — navigates back to the compilation wizard that produced the tool.
- **Workbench** — for plan-mode sets, navigates to the planner workbench.

**Empty state:** When no tools have been compiled yet, a Wand2 icon prompts users to visit the MCP Tool Designer to create their first deterministic tool.

**API:** `GET /api/yaml-workflows` lists pipeline tools. `POST /api/yaml-workflows/:id/deploy` deploys. `POST /api/yaml-workflows/:id/activate` activates. `POST /api/yaml-workflows/:id/invoke` invokes.

### Pipeline Executions

Execution history for all MCP pipeline runs — both dynamic (agentic LLM loops) and compiled (deterministic YAML DAGs).

- **Columns:** Workflow ID, type (dynamic/deterministic), status, duration, and start time.
- **Duration comparison** — deterministic runs are typically faster and cheaper than their dynamic counterparts. Use this page to verify that compiled tools match or exceed the quality of dynamic executions.
- **Click any row** to view the full execution detail: input envelope, output, tool call timeline, and activity checkpoints.

**API:** `GET /api/pipelines` lists executions with status, type, and pagination filters.

### Durable Executions

Lists all durable workflow runs across the system.

- **Tier filter** (top) — switch between All, Certified, and Durable to focus on specific workflow types.
- **Columns:** Workflow name, workflow ID, status (running/completed/failed), start time, and duration.
- **Click any row** to see the full execution detail: task record with milestones, activity checkpoints, resolver payloads, and any associated escalations.
- **Duration** is computed from start to completion — useful for identifying slow workflows or comparing performance across versions.

**API:** `GET /api/workflows/executions` lists runs with tier, status, and pagination filters.

### Accounts

User Accounts and Service Accounts live on the same page, separated by a tab toggle.

- **User Accounts** — human operators. Create users, assign display names, and grant roles. Roles determine which escalations a user can see and claim, and which workflows they can invoke from the dashboard. A `member` grant carries a work-surface scope (read/write breadth) chosen from the Scope picker; see [Roles](#roles).
- **Service Accounts** — programmatic callers (bots, CI pipelines, external systems). Each service account has an API key for authentication. Assign roles to control access just like human users. Service accounts with the `reviewer` role can claim and resolve escalations programmatically.
- **Role assignment** — both account types participate in the same role system. Click any account to edit roles, change display name, or manage credentials.

**API:** `GET /api/users` lists accounts. `POST /api/users` creates. `PUT /api/users/:id/roles` assigns roles.

### Roles

A role is where a running workflow hands work to a person. Work waits in the role's queue, the role's schema shapes the form the person completes, membership decides who can see and resolve which items, and submitting the form resumes the workflow exactly where it paused. Roles are also where escalation chains are configured — the paths work takes between teams when it needs another set of hands.

- **Role list** — all roles in the system. Each row shows the role key, title, description, user count, chain count, workflow count, and an OPS badge if `ops_visible` is set.
- **Role detail** — click a role to open its detail panel: identity fields (title, description), escalation chains, members, schemas with version history, and the capacity settings (`sla_minutes`, `target_per_hour`, `worker_count`). Edit these inline and save via `PATCH /api/roles/:role`.
- **Members** — who holds the role: admins manage it; members work its queue according to their read/write scope (read = which items appear; write = which they can claim and resolve).
- **Prior Step and Upstream Inputs** — Prior Step (`parent_role`) places the role in one Operations sequence; a role with no prior step starts its own. Upstream Inputs declare the roles it also draws from in other sequences — mixin-like, many allowed — rendered on the Operations chart as a merge glyph on the station rather than a bend in the line.
- **Schema versions** — every save that changes the role's form or metadata schema appends an immutable snapshot and advances the current version. Workflows pin a version via `schemaVersion` in the `conditionLT` config so their resolver form keeps that exact shape; escalations without a pin render the latest. The history section shows every version with its snapshot.
- **Create Role** — add a new role. Roles referenced in workflow configs are auto-created, but you can also create them here for organizational clarity.
- **Scope picker** — when granting a role at `member` type, a Scope picker offers the five named work-surface profiles: full worker (`all`/`all`, default), see-all-act-own (`all`/`self`), own-items-only (`self`/`self`), read-only auditor (`all`/`none`), and read-only own (`self`/`none`). `admin` and `superadmin` grants show no Scope picker — they always work the whole queue. The picker enforces **write ⊆ read**, so a write breadth wider than the read breadth cannot be selected.
- **Escalation chains** — define source → target role mappings. When a reviewer escalates, the chain determines which roles receive the escalation next. Chains are directional (reviewer → engineer → admin) and support multiple targets per source.

**API:** `GET /api/roles` lists roles. `POST /api/roles` creates. `PATCH /api/roles/:role` updates metadata and capacity fields. `GET /api/roles/details` returns full `RoleDetail` shapes. `GET /api/roles/:role/schema` fetches the latest or a pinned schema version; `GET /api/roles/:role/schema/versions` lists the history. `GET /api/roles/escalation-chains` lists chains. `POST /api/roles/escalation-chains` adds a chain.

### DB Maintenance

Database housekeeping tools for keeping PostgreSQL healthy under sustained workflow load.

- **Manual mode** — run vacuum, reindex, or analyze on individual tables. Useful after bulk operations or large data imports. Each operation shows estimated duration and last-run timestamp.
- **Scheduled mode** — configure automatic maintenance windows. Set a cron schedule for nightly vacuum and analyze runs so the database stays healthy without manual intervention.
- **Table statistics** — view row counts, dead tuple counts, table size, and last vacuum/analyze times for all tables. High dead tuple counts indicate tables that need vacuuming.

**API:** `POST /api/maintenance/vacuum`, `POST /api/maintenance/reindex`, `POST /api/maintenance/analyze`. `GET /api/maintenance/stats` returns table statistics.

### Task Queues

View active task queues and the workers connected to them.

- **Header stats** — total queues, total workers, and aggregate queue depth at a glance.
- **Queue list** — each row shows queue name, connected worker count, pending message depth, and consumer group health.
- **Worker detail** — expand a queue to see individual workers: their ID, connection status, uptime, and message processing rate.
- **Emergency controls** — admin actions for queue management when workers need intervention.

This page is useful for verifying that workers started correctly after deployment and for diagnosing processing backlogs.

**API:** `GET /api/workers` lists active workers. `GET /api/workers/queues` lists queue statistics.

### Messages

Browse individual stream messages from the Postgres engine and worker stream tables. Messages are schema-isolated by namespace and separated by source (engine or worker).

- **Namespace & Source** — required filters. Engine streams carry internal orchestration messages; worker streams carry task messages with workflow metadata (job ID, activity, message type).
- **Filters** — narrow by status (pending, claimed, processed, dead-lettered) and stream name (partial match).
- **Message detail** — click any row to open the inspector panel. Shows timestamps, retry info, worker metadata, and the full JSON payload with expandable tree view.
- **Pagination & sorting** — standard controls. Sort by created time, stream name, or priority.

Messages are read-only. Status is derived from timestamps: pending (no timestamps set), claimed (reserved), processed (expired), or dead-lettered.

**API:** `GET /api/controlplane/stream-messages?namespace=durable&source=worker` with optional `status`, `stream_name`, `sort_by`, `order`, `limit`, `offset` parameters.

### All Escalations

The central queue for all escalation activity across every workflow.

- **Filter bar** — filter by status (pending/claimed/resolved), role, workflow type, priority, and time window.
- **Columns:** Escalation ID, workflow type, role, status, priority, created time, and claimed-by user.
- **Claim** — click the claim action to lock an escalation to your user. Only users with matching roles see pending escalations. The queue list and aggregate stats reflect `read_all` memberships — a member scoped to `read_self` lands directly on their own assigned item in user mode rather than browsing the full queue.
- **Resolve** — after claiming, submit a resolver payload (pre-filled from the workflow's `resolver_schema` if configured). Resolution triggers a workflow re-run with the resolver data injected. A `member` whose `write_scope` is `self` can resolve only items already assigned to them; `write_scope=none` is read-only.
- **Escalate** — forward a claimed escalation to a higher-tier role via the escalation chain.

**API:** `GET /api/escalations` lists with filters. `POST /api/escalations/:id/claim` claims. `POST /api/escalations/:id/resolve` resolves.

### Escalations Overview

Accessible at `/escalations`. A statistics dashboard for escalation health across the system.

- **Time window selector** — toggle between 1h, 24h, 7d, and 30d views.
- **Summary cards** — open (pending), claimed (in progress), created (new), and resolved counts for the selected window.
- **Role breakdown table** — groups escalations by role so you can see which teams have the most pending work. Useful for identifying bottlenecks and rebalancing workload.

### Operations

Accessible at `/operations` (sidebar: Operations; page header: **Pace Board**). The COO shop-floor view — shows actual-vs-target flow across ops-visible roles as a pace chart, with a station table and detail panel below.

Execution is a graph; this page tells its story as **sequences**. Each ops-visible role with no prior step (or whose prior step is outside the ops set) starts a sequence, followed by its `parent_role` descendants in dependency order. The table is always the ground truth of the queues; the SVG is the narrative line drawn through them.

- **Sequence picker** — when more than one sequence exists, tabs appear above the chart, one per sequence, named by its origin role (station count alongside). The active sequence is deep-linked (`?fragment=<origin role>`) and each switch is a browser-history entry, so a shared URL opens the same sequence and back/forward walks between them.
- **Period selector** — `15m`, `1h`, `24h`, `7d`, `30d`. Controls the lookback window for resolved counts, percentile metrics, and the throughput metrics.
- **Pace chart** — connects the active sequence's stations in process dependency order and plots absolute counts for the selected window: a straight red target polyline (`target_per_hour × window hours`) against a smooth actual (resolved) curve with a light area fill. The queue splits into two stacked bands — claimed-and-worked (indigo) and waiting-unclaimed (sky). Station circles are colored by pace ratio (green ≥ 100%, amber ≥ 60%, red below).
- **Merge affordance** — a station that declares upstream inputs (roles feeding it from other sequences) shows a small dashed merge glyph at its floor position. It is deliberately a symbol, never a bend in the line: the upstream is an input, not a descendant. Hover names the feeding roles; click jumps to their sequence.
- **Station table** — one row per station with PENDING, ACTIVE, RESOLVED (column bands in the chart's hues), P99 WAIT, P99 WORK, and a TREND mini-bar. A merge icon next to the role name marks cross-sequence inputs. Stations with in-arrears items show a sub-row with a link to the oldest-first queue view.
- **Station detail panel** — opens on row or circle click. Shows the role's identity, an independent period toggle, and full metric breakdown (wait/work percentiles, SLA target, worker count, links to queue).

Roles appear on this view when `ops_visible = true` is set. The capacity settings (`sla_minutes`, `target_per_hour`, `worker_count`) drive the computed metrics. Set these via `PATCH /api/roles/:role` or the Roles admin page. See [Operations](operations.md) for the full concept doc.

**API:** `GET /api/escalations/station-metrics?period=24h`

### Processes Overview

Accessible at `/` (home page) and `/processes`. Shows all tracked business processes — each process is a group of related workflow executions sharing an origin ID.

- **Process list** — each row shows the origin workflow, status, number of child tasks, escalation count, and overall duration.
- **Time window selector** — filter by 1h, 24h, 7d, 30d to focus on recent activity.
- **Click any process** to drill into the Process Detail page.

A process represents the full lifecycle of a business operation — from initial invocation through all child workflows, escalations, and resolutions.

### Process Detail

Full detail view for a single business process, showing every workflow execution and escalation that shares the same origin.

- **Swimlane timeline** — visual timeline of all tasks and escalations, grouped by workflow type. Shows start/end times, durations, and dependencies between steps.
- **Header stats** — total tasks, active escalations, completed steps, and overall process duration.
- **Messages** — if the process includes human communication (escalation notes, resolver payloads), these appear in a conversation-style layout.
- **Task list** — every task in the process with status, workflow type, and links to individual execution details.

This is the primary view for understanding how a multi-step workflow progresses end-to-end.

### Files

Browse and manage files in connected storage backends (MinIO locally, S3/GCS in production).

- **File browser** — navigate directories with breadcrumbs. View files in a list with name, size, type, and last modified date.
- **Preview panel** — click a file to preview it in the side panel. Supports images, text, JSON, and PDF.
- **Upload** — drag and drop or click to upload files to the current directory.
- **Sidebar** — collapsible file tree for quick navigation across the storage hierarchy.

Storage backend is selected by the `STORAGE_BACKEND` env var. The same interface works against MinIO (local dev), S3, or GCS — no code changes needed.

**API:** `GET /api/files` lists files. `POST /api/files/upload` uploads. `GET /api/files/download/:path` downloads.

### Knowledge

Knowledge base for storing and retrieving domain-specific information used by workflows and MCP tools.

- **Entry list** — browse knowledge entries by domain and key. Each entry stores structured data that workflows can query at runtime.
- **Create/Edit** — add or update knowledge entries with a domain, key, and JSON value.
- **Search** — filter entries by domain or key prefix.

Knowledge entries are accessed by workflows via the `get_knowledge` MCP tool. This is how workflows retrieve domain context (product catalogs, configuration data, reference tables) without hardcoding values.

**API:** `GET /api/knowledge` lists entries. `PUT /api/knowledge/:domain/:key` creates or updates. `DELETE /api/knowledge/:domain/:key` removes.

### Topic Catalog

The persistent registry of all known event topics. Browse, search, and inspect what the event bus carries.

- **Topic list** — all registered topics with category pills, descriptions, subscriber counts, and last-seen timestamps. Filter by category (task, workflow, escalation, activity, knowledge, agent, app, milestone).
- **Topic detail** — click any topic to see its full payload schema (JSON Schema), example payload, tags, and a list of agents whose subscription patterns match the topic.
- **Subscriber discovery** — the detail page uses NATS-style pattern matching to show all agents that would receive this event. An agent subscribed to `task.*` appears on every `task.created`, `task.failed`, etc. detail page.
- **Schema preview in subscriptions** — when editing an agent's subscriptions, selecting a topic from the catalog shows its payload schema inline, so you know what `{event.data.*}` fields are available for input mapping.

Topics enter the catalog three ways: system topics are seeded at startup (22 built-in), config topics are declared in `startConfig.topics[]`, and runtime topics are auto-discovered when `publish_event` fires for the first time.

**API:** `GET /api/topics` lists topics. `GET /api/topics/by-name/:topic` returns detail with subscribers. `POST /api/topics` registers a new topic. See [Topics HTTP API](api/http/topics.md) and [TopicService SDK](api/sdk/topics.md).

### Credentials

Accessible via the user menu (or at `/credentials`). Manage OAuth provider connections and API keys for the current user.

- **Provider list** — shows all configured OAuth providers (Google, Anthropic, etc.) with connection status, credential type, and expiry.
- **Connect** — initiate an OAuth flow to link a provider. Tokens are stored encrypted and refreshed automatically.
- **Revoke** — disconnect a provider and delete stored tokens.
- **API keys** — view and manage service account API keys for programmatic access.

Credentials flow through the system via the `_scope` identity context — workflows inherit the invoking user's credentials for authenticated tool calls.

## Global Features

### Inbox

The Inbox icon in the header shows a badge count when the current user has pending escalations assigned to their roles. The count updates live via NATS — no polling needed.

### Event Feed

The bottom bar contains a collapsible live event stream showing workflow start/completion events, task state transitions, escalation activity, and activity checkpoints. Events stream via NATS subscription.

### Contextual Documentation

Each page header includes a documentation icon that opens the in-app docs drawer to the relevant section. The drawer supports navigation history, anchor linking, and markdown rendering.

### Page Transitions

Navigation between pages uses a smooth fade transition for responsive feel during client-side routing.
