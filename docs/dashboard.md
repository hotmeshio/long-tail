# Dashboard Guide

The Long Tail dashboard is a React single-page application for managing procedural and graph workflows, escalations, automations, and system administration. It connects to the Long Tail backend over REST and receives real-time updates via socket subscriptions.

## Sidebar Navigation

The sidebar organizes pages into six groups.

### Monitor

The reactive, event-driven surface — where operations watch the floor and builders configure choreography.

| Page | Route | Purpose |
|------|-------|---------|
| **Pace Board** | `/operations` | COO shop-floor view — pace chart of actual-vs-target flow across every station role, station table with live metrics, and the station detail panel. Visible to any user with ops or builder access. |
| **Event Topics** | `/topics` | Topic catalog — browse all known event topics with descriptions, schemas, and subscriber counts. |
| **Agents** | `/agents` | Autonomous event-driven automations (labeled **Automations** when AI is not configured). Configure subscriptions, schedules, and knowledge domains. |
| **Capabilities** | `/capabilities` | Browse MCP tools grouped by capability category, with a live run panel. |

### Orchestrate

Top-down durable orchestration, authorable two ways. Both flavors are durable and transactional; they differ in form:

- **Procedural** — imperative TypeScript. Readable, familiar, and the fastest way to author a resilient workflow — no DAG authoring required. It is emulated atop the graph engine, so an equivalent flow costs roughly 6× the activity count of its compiled form. Modern hardware makes that an easy trade in most cases: buy the vCPU, save the engineering time.
- **Graph** — the compiled YAML DAG, the substrate everything ultimately runs on. Roughly 3× the speed; the right choice when performance genuinely matters. Procedural workflows can be compiled down to graphs, so the Graph executions list shows a mix of hand-authored flows and compiled procedural ones.

Each flavor exposes the same shape: configure, invoke, executions.

| Page | Route | Purpose |
|------|-------|---------|
| **Procedural → Registry** | `/workflows/registry` | All discovered workflows with tier, queue, and access columns. Configure, certify, or invoke from here. |
| **Procedural → Invoke** | `/workflows/durable/invoke` | Start any invocable procedural workflow. Two-panel layout with workflow selector and envelope editor. |
| **Procedural → Executions** | `/workflows/executions` | All procedural runs with status, duration, and tier. Click through to task records and escalation history. |
| **Graph → Configure** | `/mcp/workflows` | Graph workflows available to the orchestrator — compiled deterministic YAML DAGs, grouped by namespace. |
| **Graph → Invoke** | `/mcp/workflows/invoke` | Start any active graph flow. Same two-panel layout as procedural invoke. |
| **Graph → Executions** | `/mcp/executions` | Execution history for graph runs — both dynamic (agentic) and compiled (deterministic). |

### Design

The LLM authoring add-on. Appears when an Anthropic key is configured.

| Page | Route | Purpose |
|------|-------|---------|
| **Designer** | `/mcp/queries` | Design and compile MCP tools. Three modes: Plan (multi-workflow sets), Builder (single tool from execution), and Composer (manual tool design). |
| **Servers & Tools** | `/mcp/servers` | Browse registered MCP servers and their tools. Register new servers via guided wizard. |

### Storage

| Page | Route | Purpose |
|------|-------|---------|
| **Files** | `/files` | Browse and manage files in connected storage (MinIO/S3/GCS). |
| **Knowledge** | `/knowledge` | Knowledge base entries for workflow context and retrieval. |

### Identity & Access

| Page | Route | Purpose |
|------|-------|---------|
| **Accounts** | `/admin/users` | User accounts and service accounts (bots). Create, edit, assign roles, manage API keys. |
| **Roles** | `/admin/roles` | Define roles — the queues, forms, and membership that connect workflows to people. Escalation chains, capacity settings, and versioned schemas live here. |

### Infrastructure

Builder-only.

| Page | Route | Purpose |
|------|-------|---------|
| **Routers** | `/admin/controlplane` | Active task queues, connected engines and workers, queue depth, and worker health. |
| **Messages** | `/admin/streams` | Stream message browser for queue debugging. |
| **DB Maintenance** | `/admin/maintenance` | Database housekeeping — vacuum, reindex, table statistics. |

### Header

The top navigation bar contains:

- **Home logo** — links to the home page (`/`), Recent Activity.
- **all** — links to `/escalations/available` with a live count of unclaimed escalations.
- **mine** — links to `/escalations/queue` with a live count of escalations assigned to you.
- **events** — toggles the live event feed (builders and ops; doubles as the connection indicator).
- **docs** (BookOpen icon) — toggles the in-app documentation drawer. Each page also has a contextual docs link next to its title that opens the drawer to the relevant section.
- **User menu** — Credentials, theme picker (five accent themes), and Sign Out.

## Home — Recent Activity

The home page mirrors the navigation. Row 1 reflects the two header escalation links: **All Escalations** and **My Escalations**, each showing the five most recent items. Row 2 reflects the Orchestrate story and is tiered by role: superadmins and engineers see the **Pace Board** chart at a glance (click through to `/operations`) beside the five most recent **Procedural** and **Graph** executions; admins — who don't see workflows — get the Pace Board spanning the full row; operators see row 1 only.

## Key Pages

### Workflow Registry

Shows every workflow the system has discovered across all registered workers. Each workflow displays one of three tiers — direct states of the registration:

- **Certified** (ShieldCheck icon) — has an `lt_config_workflows` entry with `certified: true`. Full interceptor tracking, escalation defaults, and invocation controls.
- **Registered** (Settings icon) — has a registration with `certified: false`. Invocation controls and schema-driven forms, without interceptor wrapping.
- **Durable** (Wrench icon) — runs as a HotMesh worker with no registration. Checkpointed execution and retries only.

**Columns:** Workflow (pill + description), Queue (bordered pill), Tier (icon + label), Access (escalation roles with shield icon, invocation roles with user-check icon).

**Row actions** (on hover): Play (invoke), Wrench (register durable), ShieldPlus (certify registered), ShieldOff (unregister — deletes the registration). To demote certified → registered, open the workflow and uncheck **Certify for HITL Escalation**; escalation roles, dependencies, and schemas stay on the registration.

**Inline config via `start()`:** Developers can declare workflow profiles directly in the `start()` config by adding a `config` block to any worker entry. This auto-seeds the workflow into `lt_config_workflows` at startup — no manual API calls or dashboard wizard needed. Roles referenced in the config are auto-created.

```typescript
workers: [
  {
    taskQueue: 'my-queue',
    workflow: myWorkflow,
    config: {
      description: 'My workflow description',
      invocable: true,
      certified: true,
      roles: ['reviewer', 'admin'],
      envelopeSchema: { data: { field1: '', field2: 0 } },
      resolverSchema: { approved: true, notes: '' }, // deprecated legacy fallback — the escalation form is owned by the target role as a versioned form_schema
    },
  },
]
```

**API:** `GET /api/workflows/discovered` returns the unified list. `PUT /api/workflows/:type/config` creates or updates a config entry. `DELETE /api/workflows/:type/config` removes it.

### Invoke Workflow

A two-panel page for starting any invocable procedural workflow. The left panel lists invocable workflows grouped by task queue, with a queue select and search in the filter bar. Workflows with active cron schedules show a clock icon. Selecting a workflow opens the invocation form on the right:

- **Identity summary** — shows who will execute (current user, configured bot, or admin override).
- **Envelope editor** — dual-mode input: a structured form view (when `envelope_schema.data` has scalar fields) or a raw JSON editor. The form auto-generates fields from the schema with inferred types.
- **Start Workflow** button — invokes the workflow and navigates to the executions page.

Recurring (cron) execution is owned by Automations — schedule workflows from the Agents page.

**API:** `POST /api/workflows/:type/invoke` starts a workflow.

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

Steps unlock sequentially in each wizard. Compiled tools appear in **Graph Workflows** and **Graph Executions**. See the [Compilation Pipeline](compilation.md) guide for details.

### MCP Server Tools

Browse all registered MCP servers and their exposed tools.

- **Server list** — each row shows server name, transport type (stdio, SSE, streamable HTTP), status (connected/disconnected), and tool count.
- **Register Server** button — opens a guided wizard: choose transport, configure connection, discover tools, review and save.
- **Server detail** — click any row to view and edit. Shows all exposed tools with their input schemas, tags, compile hints, and credential providers. Tools are the building blocks that the MCP Tool Designer compiles into deterministic pipelines.

**API:** `GET /api/mcp-servers` lists servers. `POST /api/mcp-servers` registers a new one. `GET /api/mcp-servers/:id/tools` lists tools for a server.

### Graph Workflows

The Graph → Configure page. Deterministic workflows compiled from dynamic MCP executions or authored directly. Each is a YAML DAG that the `mcpQueryRouter` discovers and invokes automatically — faster and cheaper than re-running the original agentic loop.

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

### Graph Executions

Execution history for all graph runs — both dynamic (agentic LLM loops) and compiled (deterministic YAML DAGs). Because procedural workflows compile down to graphs, this list mixes hand-authored flows with compiled procedural ones.

- **Columns:** Workflow ID, type (dynamic/deterministic), status, duration, and start time.
- **Duration comparison** — deterministic runs are typically faster and cheaper than their dynamic counterparts. Use this page to verify that compiled tools match or exceed the quality of dynamic executions.
- **Click any row** to view the full execution detail: input envelope, output, tool call timeline, and activity checkpoints.

**API:** `GET /api/pipelines` lists executions with status, type, and pagination filters.

### Procedural Executions

Lists all procedural workflow runs across the system.

- **Tier filter** (top) — switch between All, Certified, and Durable to focus on specific workflow types.
- **Columns:** Workflow name, workflow ID, status (running/completed/failed), start time, and duration.
- **Click any row** to see the full execution detail: the swimlane timeline and events fill the main column, and a full-height side panel carries the record's facts. The main header stays quiet — just the title and a panel toggle; status, the refresh/copy toolbar, and the **Actions** menu (a small caret anchor at the right of the panel's icon row) all live in the panel. The panel and main column share the width as a flex set — the main column narrows as the panel expands.
  - **Details** — status, workflow identity (type, ID, parent), task queue, start/end times, duration, history size, and activity counts.
  - **Escalations** — every escalation the workflow raised, each a row with type, role, age, and status badge, so multiple escalations across the run's lifecycle read as a table rather than running on; related child tasks list the same way below.
- **Duration** is computed from start to completion — useful for identifying slow workflows or comparing performance across versions.

**API:** `GET /api/workflows/executions` lists runs with tier, status, and pagination filters.

### Accounts

User Accounts and Service Accounts live on the same page, separated by a tab toggle.

- **User Accounts** — human operators. Create users, assign display names, and grant roles. Roles determine which escalations a user can see and claim, and which workflows they can invoke from the dashboard. A `member` grant carries a work-surface scope (read/write breadth) chosen from the Scope picker; the five named profiles are documented under [Role Detail](#role-detail).
- **Service Accounts** — programmatic callers (bots, CI pipelines, external systems). Each service account has an API key for authentication. Assign roles to control access just like human users. Service accounts with the `reviewer` role can claim and resolve escalations programmatically.
- **Role assignment** — both account types participate in the same role system. Click any account to edit roles, change display name, or manage credentials.

**API:** `GET /api/users` lists accounts. `POST /api/users` creates. `PUT /api/users/:id/roles` assigns roles.

### Roles

Roles are the system's central organizer and gatekeeper: every hand-off between the digital side (running workflows) and the outside world crosses a role. When a workflow needs something only a person or external actor can provide, it raises an escalation into exactly one role's queue and pauses. Membership in the role grants access to that queue and every escalation it contains; each member's scopes determine which specific combinations of activities they may perform via those escalations — which items appear, which they can claim, resolve, or forward. Resolving an item resumes the workflow exactly where it paused.

Because roles carry the queue, the form schema, the membership, and the capacity targets in one place, they are also the unit everything else is built on: [Accounts](#accounts) grant them, escalation views filter by them, and the [Pace Board](#pace-board) renders them as stations.

**Master list** (`/admin/roles`) — one row per role:

- **Ops dot** — a green dot marks roles that appear as stations on the [Pace Board](#pace-board).
- **Role / Label / Description** — the role key and its human-facing identity.
- **Preceded By** — the role's prior step (`parent_role`), linked. Prior steps compose the Pace Board's sequences.
- **Escalates To** — the chain targets this role can forward work to.
- **Member Count** — how many accounts hold the role.
- **Capacity** — SLA (minutes), Target (per hour), and Staff side by side. These drive the Pace Board's computed metrics.

Search filters by key, label, or description. **+ Add Role** creates a role here; roles referenced in workflow configs are also auto-created at startup. Click any row to open [Role Detail](#role-detail).

**API:** `GET /api/roles` lists roles. `POST /api/roles` creates. `GET /api/roles/details` returns full `RoleDetail` shapes. `GET /api/roles/escalation-chains` lists chains.

### Role Detail

Accessible at `/admin/roles/:role`. One page per role — a header plus three columns covering identity, routing and people, and schemas.

**Header** — the role key with its prior step, the capacity set, and the **Ops** toggle that shows the role as a station on the [Pace Board](#pace-board). The capacity set holds `sla_minutes`, `target_per_hour`, and `worker_count`; enter any two and the header hints the derived third (`throughput = workers / (sla / 60)`). Beside it, the priority set holds `priority_threshold_minutes` and `priority_facet` — the age threshold and metadata timestamp key driving the Pace Board priority count (blank = `sla_minutes` and `created_at`). Save applies header and identity edits via `PATCH /api/roles/:role`.

**Identity** — display name and description, shown on role rows and station labels.

**Sequence placement** — appears when the Ops toggle is on:

- **Prior Step** — places the role in one Pace Board sequence; a role with no prior step starts its own.
- **Upstream Inputs** — the roles this station also draws from in other sequences. Mixin-like, many allowed, saved live. Rendered on the Pace Board as a merge glyph on the station, never a bend in the line: an upstream is an input, not a descendant.

**Escalation Targets** — the chain out of this role, saved live. When a member escalates an item, these targets receive it. Chains are directional and support multiple targets per source.

**Members** — who holds the role: admins manage it; members work its queue according to their read/write work-surface scope (read = which items appear; write = which they can claim and resolve). A `member` grant carries a scope chosen from five named profiles: full worker (`all`/`all`, default), see-all-act-own (`all`/`self`), own-items-only (`self`/`self`), read-only auditor (`all`/`none`), and read-only own (`self`/`none`). The picker enforces **write ⊆ read**. `admin` and `superadmin` grants always work the whole queue.

**Escalation Schema** — shows the schema version currently in use and links to the [Escalation Schema](#escalation-schema) editor page.

**Metadata Schema** — JSON Schema that validates each escalation's `metadata` at creation time. Its keys appear in faceted search autocomplete.

**Properties** — a free JSON bag for custom per-role values.

**API:** `PATCH /api/roles/:role` updates identity, capacity, placement, and schemas. `POST /api/roles/escalation-chains` adds a chain target; `DELETE /api/roles/escalation-chains` removes one.

### Escalation Schema

Accessible at `/admin/roles/:role/schema`. The versioned form behind a role's escalations — the form a person completes to resolve items in the role's queue.

- **Editor** — form fields as JSON Schema in a full-width editor, with an optional change summary recorded on the version the save creates. **Save Version** writes only the schema: every save that changes it appends an immutable snapshot and advances the current version.
- **Version rail** — the full history with the current version marked. Expand any version to view its snapshot or load it into the editor as the base for the next save.
- **Pinning** — workflows pin a version via `schemaVersion` in the `conditionLT` config, so their resolver form keeps that exact shape for the life of the run. Escalations without a pin render the latest version.

**API:** `GET /api/roles/:role/schema` fetches the latest or a pinned version. `GET /api/roles/:role/schema/versions` lists the history. `PATCH /api/roles/:role` with `form_schema` (+ optional `change_summary`) saves a new version.

### Escalations List Schema

Accessible at `/admin/roles/:role/list-schema`. The versioned rich view for the role's escalation **list** page — the list-page analog of the resolve form. Opt-in: when a role owns a `list_schema`, its list page renders a role-authored view (the live item as a card plus a load-on-demand history) instead of the engineer table, scoped to that one role. See [x-lt-list-schema.md](hitl/x-lt-list-schema.md) for the `x-lt-layout` / `x-lt-active` / `x-lt-history` vocabulary.

- **Editor + version rail** — same shape as the Escalation Schema editor, but on its own **independent** version timeline: editing the list view never advances the resolve form's version.
- The list always renders the latest version — no pinning (a display template, not a payload contract).

**API:** `GET /api/roles/:role/list-schema` (latest or `?version=`), `GET /api/roles/:role/list-schema/versions`, and `PATCH /api/roles/:role` with `list_schema` (+ optional `change_summary`).

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
- **Message detail** — click any row to slide open the inspector panel: a full-height column beside the table with its own scroll, like the left nav. The table narrows to make room, so no cells are covered. Shows timestamps, retry info, worker metadata, and the full JSON payload with expandable tree view.
- **Pagination & sorting** — standard controls. Sort by created time, stream name, or priority.

Messages are read-only. Status is derived from timestamps: pending (no timestamps set), claimed (reserved), processed (expired), or dead-lettered.

**API:** `GET /api/controlplane/stream-messages?namespace=durable&source=worker` with optional `status`, `stream_name`, `sort_by`, `order`, `limit`, `offset` parameters.

### All Escalations

The central queue for all escalation activity across every workflow.

- **Filter bar** — filter by status (pending/claimed/resolved), role, workflow type, priority, and time window.
- **Columns:** Escalation ID, workflow type, role, status, priority, created time, and claimed-by user.
- **Rich list view** — when the list is scoped to exactly one role (`?role=<role>`) and that role owns a [list schema](#escalations-list-schema), a role-authored view renders in place of the table (the live item as a card, plus a load-on-demand history), with a **Table view** toggle back to the columns.
- **Claim** — click the claim action to lock an escalation to your user. Only users with matching roles see pending escalations. The queue list and aggregate stats reflect `read_all` memberships — a member scoped to `read_self` lands directly on their own assigned item in user mode rather than browsing the full queue.
- **Resolve** — after claiming, submit a resolver payload. The form is pre-filled from the role's versioned `form_schema` field defaults and from the workflow's seeded `envelope.formDefaults` (reverse-mapped through each field's `x-lt-bind`). The dashboard maps the flat form to the nested payload via `x-lt-bind` and the submitted payload is stored as-is. Resolution triggers a workflow re-run with the resolver data injected. A `member` whose `write_scope` is `self` can resolve only items already assigned to them; `write_scope=none` is read-only.
- **Escalate** — forward a claimed escalation to a higher-tier role via the escalation chain.
- **Side panel** — a slide-in beside the resolve form with switchable views, selected by the icon set at its top: **Help** (the form's `x-lt-help` markdown, `{{domain.path}}`-interpolated against the live record, or a state-aware hint such as "Claim this escalation to enable the form"), **Details** (status, role, priority, claim provenance, timestamps, and — for builders — identifier links), **AI Analysis** (what triage diagnosed and corrected — shown when AI is enabled and triage data is present), **Metadata** (the row's metadata values), **Context** (input envelope, escalation context, resolver payload), and **Record** (the raw escalation JSON, builders only). The panel and form share the width as a flex set — the form column narrows as the panel expands. It opens expanded on Help when the form carries `x-lt-help`, stays hidden otherwise, and the page-header panel button toggles it either way.

**API:** `GET /api/escalations` lists with filters. `POST /api/escalations/:id/claim` claims. `POST /api/escalations/:id/resolve` resolves.

### Escalations Overview

Accessible at `/escalations`. A statistics dashboard for escalation health across the system.

- **Time window selector** — toggle between 1h, 24h, 7d, and 30d views.
- **Summary cards** — open (pending), claimed (in progress), created (new), and resolved counts for the selected window.
- **Role breakdown table** — groups escalations by role so you can see which teams have the most pending work. Useful for identifying bottlenecks and rebalancing workload.

### Pace Board

Accessible at `/operations`. The COO shop-floor view of the roles system: actual-vs-target flow across every station, rendered as a pace chart with a station table and detail panel below.

The board is [Roles](#roles) end-to-end. Every station is a role with its **Ops** toggle on; sequences are composed from each role's Prior Step (`parent_role`); cross-sequence feeds come from Upstream Inputs; the red target line comes from each role's capacity settings. Configuring the board *is* configuring roles — the **Configure** button in the header goes straight there.

Execution is a graph; this page tells its story as **sequences**. Each station role with no prior step (or whose prior step is outside the station set) starts a sequence, followed by its `parent_role` descendants in dependency order. The longest sequence leads. The table is always the ground truth of the queues; the SVG is the narrative line drawn through them.

- **Sequence picker** — when more than one sequence exists, tabs appear above the chart, one per sequence, named by its origin role with the station count alongside. The active sequence is deep-linked (`?fragment=<origin role>`) and each switch is a browser-history entry, so a shared URL opens the same sequence and back/forward walks between them.
- **Period selector** — `15m`, `1h`, `24h`, `7d`, `30d`. Controls the lookback window for resolved counts, percentile metrics, and throughput.
- **Pace chart** — connects the active sequence's stations in process dependency order and plots absolute counts for the selected window: a straight red target polyline (`target_per_hour × window hours`) against a smooth actual (resolved) curve with a light area fill. The queue splits into two stacked bands — claimed-and-worked (indigo) and waiting-unclaimed (sky). Station circles are colored by pace ratio (green ≥ 100%, amber ≥ 60%, red below).
- **Priority badge** — a station with unclaimed items past its age threshold carries a powder-blue circle with the count. Age is measured from the role's priority facet (a metadata timestamp such as the order's authorized date; `created_at` when unset) against its priority threshold (`sla_minutes` when unset). Clicking the badge opens that station's queue ordered oldest-first by the same facet — the counted items sit at the top, ready to pull to the front of the rack.
- **Merge affordance** — a station that declares upstream inputs shows a small dashed merge glyph at its floor position. It is deliberately a symbol, never a bend in the line: the upstream is an input, not a descendant. Hover names the feeding roles; click jumps to their sequence.
- **Station table** — one row per station: ROLE (with a merge icon marking cross-sequence inputs), TARGET/H, then PENDING, ACTIVE, RESOLVED in column bands carrying the chart's hues, P99 WAIT, P99 WORK, and a TREND mini-bar. TREND shows the live backlog-to-target ratio while the queue has items; when the queue is idle it shows the period's throughput efficiency, marked with `↩`. Stations with priority items show a powder-blue sub-row linking to the queue ordered oldest-first by the priority facet.
- **Station detail panel** — opens on row or circle click. Shows the role's identity, an independent period toggle, and the full metric breakdown (wait/work percentiles, SLA target, worker count, links to the queue).
- **Live updates** — escalation events refresh the metrics push-driven and debounced; the header's refresh button forces a reload.

A role joins the board via the **Ops** toggle on its [Role Detail](#role-detail) page; the capacity settings (`sla_minutes`, `target_per_hour`, `worker_count`) and the priority dials (`priority_threshold_minutes`, `priority_facet`) drive the computed metrics. See [Operations](operations.md) for the full concept doc.

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
