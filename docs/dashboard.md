# Dashboard Guide

The Long Tail dashboard is a React single-page application for managing procedural and graph workflows, escalations, automations, and system administration. It connects to the Long Tail backend over REST and receives real-time updates via socket subscriptions.

## Sidebar Navigation

The sidebar organizes pages into six groups.

### Monitor

The reactive, event-driven surface — where operations watch the floor and builders configure choreography.

| Page | Route | Icon | Purpose |
|------|-------|------|---------|
| **Pace Board** | `/pace` | Gauge | Actual-vs-target flow across a segment of roles — a pace chart over the sequence, a live role table, and a role detail panel. Readable by every login (aggregate counts and trends) while `features.publicPaceBoard`, default on, stands. |
| **Trend Board** | `/trends` | TrendingUp | Where the time went — the entity lens over a metadata facet (`serialNumber`, `orderId`): a state-mix summary, dwell rankings, and per-entity cross-queue timelines. Shares the combined board selector with the Pace Board. |
| **Event Topics** | `/topics` | Radio | Topic catalog — browse all known event topics with descriptions, schemas, and subscriber counts. |
| **Agents** | `/agents` | Bot | Autonomous event-driven automations (labeled **Automations** when AI is not configured). Configure subscriptions, schedules, and knowledge domains. |
| **Capabilities** | `/capabilities` | Zap | Browse MCP tools grouped by capability category, with a live run panel. |

Pace Board and Trend Board are two anchors on one page — the pathname picks the board, and the shared board selector switches between a Pace segment and a Trend lens without a reload. `/operations` redirects to `/pace`. Both entries appear only for logins that may read the board (admins, superadmins, and every login while `features.publicPaceBoard` stands).

### Orchestrate

Top-down durable orchestration, authorable two ways. Both flavors are durable and transactional; they differ in form:

- **Procedural** — imperative TypeScript. Readable, familiar, and the fastest way to author a resilient workflow — no DAG authoring required. It is emulated atop the graph engine, so an equivalent flow costs roughly 6× the activity count of its compiled form. Modern hardware makes that an easy trade in most cases: buy the vCPU, save the engineering time.
- **Graph** — the compiled YAML DAG, the substrate everything ultimately runs on. Roughly 3× the speed; the right choice when performance genuinely matters. Procedural workflows can be compiled down to graphs, so the Graph executions list shows a mix of hand-authored flows and compiled procedural ones.

Each flavor exposes the same shape: configure, invoke, executions.

| Page | Route | Purpose |
|------|-------|---------|
| **Procedural → Registry** | `/workflows/registry` | All discovered workflows with tier, queue, and access columns. Configure, certify, or invoke from here. |
| **Procedural → Invoke** | `/workflows/durable/invoke` | Start a procedural workflow the caller may invoke. Grouped list beside the form; rich x-lt-* forms when a workflow declares `inputSchema`. Builders reach it under Orchestrate, everyone else under Tools. |
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
| **Knowledge** | `/knowledge` | Versioned knowledge base — domain data (catalogs, reference tables, cascade options) that workflows and resolver forms read at runtime, every edit an immutable edition. |

### Identity & Access

| Page | Route | Purpose |
|------|-------|---------|
| **Accounts** | `/admin/users` | User accounts and service accounts (bots). Create, edit, assign roles, manage API keys. |
| **Roles** | `/admin/roles` | Define roles — the queues, forms, and membership that connect workflows to people. Pace Board dials, capacity settings, versioned schemas, members, and default pins live here. |
| **Personas** | `/admin/personas` | Bundle roles into named, one-step assignments. Each linked role carries a relationship scope (write-all, write-self, read-all); assigning a persona composes the member's whole surface from its roles' pins and schemas. |
| **Scan Codes** | `/admin/scan-codes` | Configure barcode schemes and their scan-driven rules (event-condition-action over escalations). Shown when `features.scanCodes` stands. |

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
- **Search and run bar** — one input, two verbs: find an escalation by id, workflow, or a configured facet, or run a scan rule against a typed target. Search is opt-in via `search` in `start()` config or `LT_SEARCH_BAR`; run modes ride `features.scanCodes`. See [Search and run](#search-and-run).
- **all** — links to `/escalations/available` with a live count of unclaimed escalations.
- **mine** — links to `/escalations/queue` with a live count of escalations assigned to you.
- **scan** (Barcode icon) — opens the scan panel for manual code entry and capture settings, shown when `features.scanCodes` stands. See [Scan Codes](#scan-codes).
- **events** — toggles the live event feed (builders and ops; doubles as the connection indicator).
- **docs** (BookOpen icon) — toggles the in-app documentation drawer. Each page also has a contextual docs link next to its title that opens the drawer to the relevant section.
- **User menu** — **Credentials** (OAuth connections and API keys), **Link variables** (per-device facet bindings that scope pins and the Pace Board — see [Faceted Routing](faceted-routing.md#link-variables)), the **theme picker** (five accent themes), and **Sign Out**.

## Home — Recent Activity

The home page leads with the **Pace Board** for every login — the operational heartbeat on top, **All Escalations** and **My Escalations** panels below (each server-scoped to what the viewer may see). A role flagged **Home Segment** (Role Detail → Pace Board settings) picks which sequence the home board opens on; unset, the first sequence leads. When a deployment sets `features.publicPaceBoard: false`, homes re-tier: admins keep this layout, engineers see escalation panels beside their recent **Procedural** and **Graph** executions, and operators get their per-lane task-queue cards.

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

Accessible at `/workflows/durable/invoke` to anyone the server lists an invokable workflow for. The server decides the list with the same predicate the invoke gate runs (`invocationRoles` on each config; empty means every authenticated user; superadmin and admin see everything, including active durable workers with no registration). Builders keep Invoke under Orchestrate; every other persona gets a **Tools** nav section that appears only when the list is non-empty, and the route sends a caller with nothing to invoke home.

The list of workflows takes the left quarter of the row, grouped by task queue with a queue select and search stacked above; each row carries its tier. The first row is preselected and `?type=<WorkflowType>` tracks the choice, so the page opens on a form. The form fills the rest of the row:

- **Name and description** — the workflow pill with its tier, then the config's markdown description. Tables render.
- **Identity summary** — who will execute: the current user, the workflow's configured `execute_as` bot ("configured default"), or, for admins and superadmins, an override chosen from the bot picker ("admin override").
- **Certification checkbox** — for a certified workflow, stamps `metadata.certified` on this one run.
- **The form** — a workflow that declares `inputSchema` renders the x-lt-* form: sections, two columns, conditional fields and instruction blocks, and a side panel with **Instructions** (the interpolated `x-lt-help`) and **Issues** (violations, click to focus). Every other workflow renders the envelope template form from `envelopeSchema`, with its Form and JSON views. See [Invoke forms](hitl/invoke-form.md).
- **Start Workflow** — posts `{ data, metadata }` to the invoke endpoint. The page stays put and reports the started id; builders also get a **View workflow** link to its execution. A `422` from the input schema gate lands in the Issues view.

Below 1280px the list folds into a select and the form takes the full width.

Recurring (cron) execution is owned by Automations — schedule workflows from the Agents page. The graph equivalent, **Graph → Invoke** (`/mcp/workflows/invoke`), starts a compiled YAML flow.

**API:** `GET /api/workflows/invocable` backs the list and the nav. `POST /api/workflows/:type/invoke` starts a workflow (body `{ data, metadata?, execute_as? }`, returns `202` with the workflow id; `422` with the canonical validation body when `input_schema` rejects the data).

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

Accessible at `/workflows/executions`. Lists procedural workflow runs from one HotMesh namespace.

- **Namespace** — the `?namespace=` query param names the Postgres schema (HotMesh `app_id`) the list reads from; procedural runs live in `durable`, so the page defaults to `?namespace=durable`. Graph runs live in their own per-app namespaces and are browsed at [Graph Executions](#graph-executions) (`/mcp/executions`).
- **Tier filter** — All, Certified, or Durable. Certified narrows to workflows with a certified config; Durable narrows to those with none.
- **Type / Status / Search** — filter by workflow type, run status (running / completed / failed), or a workflow-id keyword.
- **Columns:** Workflow ID (status dot + id), Type (pill with tier variant), Created, Updated, Duration, and hover Actions (filter-by-type, filter-by-status, and — for superadmins — a jump to the workflow's registry entry).
- **Click any row** to open the execution detail (`/workflows/executions/:workflowId`). A tabbed main column — **Details** (input/output envelopes), **Execution Timeline** (the swimlane of activities, signals, timers, and child workflows), **Events** (the raw event stream) — sits beside a full-height side panel that carries the record's facts. The panel and main column share the width as a flex set.
  - **Details** (panel) — status, workflow identity (type, id, parent), task queue, start/end times, duration, history size, and activity counts.
  - **Escalations** (panel) — every escalation the workflow raised as a row (status dot, type, role, age), each linking to its detail page; related child tasks list below. Empty reads "This workflow has not escalated."
  - **Actions** menu — Restart (prefills a fresh invoke from the start event), Terminate (running runs only), Compile into Pipeline (runs with tool calls), and jumps to worker / engine stream messages.

**API:** `GET /api/workflow-states/jobs?namespace=durable` lists runs (params `entity` for type, `status`, `search`, `registered` for tier, `sort_by`, `order`, `limit`, `offset`). `GET /api/workflow-states/:workflowId/execution` returns the detail. `POST /api/workflows/:workflowId/terminate` stops a running one.

### Accounts

User Accounts and Service Accounts live on the same page, separated by a tab toggle.

- **User Accounts** — human operators. Create users, assign display names, and grant roles. The side panel's **Properties** table edits the user's free-form dictionary (badge bindings, shift, any per-person attribute) one key at a time — every edit is an atomic patch that never clobbers sibling keys, and keys the platform resolves identities against (badge scheme facets) carry a **system** mark with a confirm step. Roles determine which escalations a user can see and claim, and which workflows they can invoke from the dashboard. A `member` grant carries a work-surface scope (read/write breadth) chosen from the Scope picker; the five named profiles are documented under [Role Detail](#role-detail).
- **Service Accounts** — programmatic callers (bots, CI pipelines, external systems). Each service account has an API key for authentication. Assign roles to control access just like human users. Service accounts with the `reviewer` role can claim and resolve escalations programmatically.
- **Role assignment** — both account types participate in the same role system. Click any account to edit roles, change display name, or manage credentials.
- **Personas** — the role panel also assigns [personas](#personas): pick one to add the account to every linked role at the linked scope in one step. Memberships a persona sustains show a mask icon; direct grants show none and survive persona unassignment.

**API:** `GET /api/users` lists accounts. `POST /api/users` creates. `PUT /api/users/:id/roles` assigns roles. `GET/POST /api/users/:id/personas` reads and assigns personas.

### Roles

Roles are the system's central organizer and gatekeeper: every hand-off between the digital side (running workflows) and the outside world crosses a role. When a workflow needs something only a person or external actor can provide, it raises an escalation into exactly one role's queue and pauses. Membership in the role grants access to that queue and every escalation it contains; each member's scopes determine which specific combinations of activities they may perform via those escalations — which items appear, which they can claim, resolve, or forward. Resolving an item resumes the workflow exactly where it paused.

Because roles carry the queue, the form schema, the membership, and the capacity targets in one place, they are also the unit everything else is built on: [Accounts](#accounts) grant them, escalation views filter by them, and the [Pace Board](#pace-board) charts them.

**Master list** (`/admin/roles`) — one row per role:

- **Role** — an ops status dot (green marks roles shown on the [Pace Board](#pace-board)) beside the display name: the user-set title, else Title Case derived from the key.
- **Key** — the exact technical role id.
- **Description** — the role's human-facing summary.
- **Preceded By** — the role's prior step (`parent_role`), linked. Prior steps compose the Pace Board's sequences.
- **Members** — how many accounts hold the role.
- **Capacity** — SLA (minutes), Target (per hour), and Staff side by side. These drive the Pace Board's computed metrics.

Search filters by key, label, or description. **+ Add Role** creates a role here; roles referenced in workflow configs are also auto-created at startup. Click any row to open [Role Detail](#role-detail).

**API:** `GET /api/roles` lists roles. `POST /api/roles` creates. `GET /api/roles/details` returns full `RoleDetail` shapes.

### Role Detail

Accessible at `/admin/roles/:role`. One page per role — a quiet header carrying the role's identity, with the configuration organized into a five-section left sub-nav: **Identity · Pace Board · Schemas · Members · Pins**. The active section rides the URL (`?section=pace-board`), so deep links land on the right concern. One draft spans every section — switching sections never loses edits — and the **Save** button sits in the sub-nav footer, visible from every section. (Members, Pins, and Upstream Inputs save live.)

**Identity** — display name and description, shown on role rows and Pace Board labels. The danger zone lives here too: a role nothing references can be deleted.

**Pace Board** — everything the board consumes about this role, in one column:

- **Show this role on the Pace Board** — the visibility toggle (`ops_visible`) that charts the role on the [Pace Board](#pace-board).
- **Capacity** — `sla_minutes`, `target_per_hour`, and `worker_count`; enter any two and the section hints the derived third (`throughput = workers / (sla / 60)`).
- **Priority** — `priority_threshold_minutes` and the age facet (`priority_facet`) driving the Pace Board jeopardy count and the jeopardy filter (blank = `sla_minutes` and `created_at`). The dials stay editable while the role is hidden — they also drive jeopardy in the queues.
- **Entity** — the metadata key naming what moves through this role (`entity_facet`, e.g. `serialNumber`, `orderId`). Roles sharing a key form that entity's system: the [Trend Board](#trend-board) lens, per-entity dwell, and timelines all derive from it. Once a key is set, the **States from** picker (`entity_state_source`) chooses how the role names the entity's state — **Role** (being here is one state, e.g. a servicing queue) or **Subtypes** (this one role holds several states named by each escalation's subtype, e.g. a fleet role parking `idle` / `printing`).
- **Sequence** — board geometry, shown while the role is visible: **Prior Step** (places the role in one Pace Board segment; a role with no prior step starts its own), **Upstream Inputs** (the roles this role also draws from in other segments — mixin-like, many allowed, saved live, rendered as a merge glyph, never a bend in the line), and **Home Segment** (lead the home Pace Board with this role's segment; one role holds this).

**Schemas** — the role's contracts:

- **Enforcement** — the `enforce_schema` toggle: validate every resolve payload server-side against the role's form schema.
- **Escalation Schema** — shows the schema version currently in use and links to the [Escalation Schema](#escalation-schema) editor page.
- **Escalations List Schema** — shows the list-schema version in use and links to the [Escalations List Schema](#escalations-list-schema) editor page.
- **Metadata Schema** — JSON Schema that validates each escalation's `metadata` at creation time. Its keys appear in faceted search autocomplete.

**Members** — who holds the role: admins manage it; members work its queue according to their read/write work-surface scope (read = which items appear; write = which they can claim and resolve). A `member` grant carries a scope chosen from five named profiles: full worker (`all`/`all`, default), see-all-act-own (`all`/`self`), own-items-only (`self`/`self`), read-only auditor (`all`/`none`), and read-only own (`self`/`none`). The picker enforces **write ⊆ read**. `admin` and `superadmin` grants always work the whole queue.

**Pins** — two live-save groups. **Link Variables** leads: the facet names members bind per device (`properties.link_variables` — name, optional label, optional default). A pin below may reference a variable as a facet value, `facets={"facility":"{lt:facility}"}`; each member device opens it scoped to its own binding (set from the user menu → Link variables), falling back to the declared default or, unbound, applying no filter. A caption under each templated pin previews the binding on the viewing device (`facility = 'soleful'` / `facility = <empty>`). **Default Pins** follows — the pinned-view seeds this role hands its members (`default_pins`): label, dashboard-relative URL, optional badge. Members see them in their Pinned nav section from first login (marked role-provided) and may promote, hide, or reorder them via preferences; promoting a templated pin copies the template, so it keeps following the device's bindings. See [Faceted Routing — Link variables](faceted-routing.md#link-variables).

**API:** `PATCH /api/roles/:role` updates identity, Pace Board dials, placement, schemas, and pins.

### Escalation Schema

Accessible at `/admin/roles/:role/schema`. The versioned form behind a role's escalations — the form a person completes to resolve items in the role's queue.

- **Editor** — form fields as JSON Schema in a full-width editor, with an optional change summary recorded on the version the save creates. **Save Version** writes only the schema: every save that changes it appends an immutable snapshot and advances the current version.
- **Version rail** — the full history with the current version marked. Expand any version to view its snapshot or load it into the editor as the base for the next save.
- **Pinning** — workflows pin a version via `schemaVersion` in the `conditional` config, so their resolver form keeps that exact shape for the life of the run. Escalations without a pin render the latest version.

**API:** `GET /api/roles/:role/schema` fetches the latest or a pinned version. `GET /api/roles/:role/schema/versions` lists the history. `PATCH /api/roles/:role` with `form_schema` (+ optional `change_summary`) saves a new version.

### Escalations List Schema

Accessible at `/admin/roles/:role/list-schema`. The versioned rich view for the role's escalation **list** page — the list-page analog of the resolve form. Opt-in: when a role owns a `list_schema`, its list page renders a role-authored view (the live item as a card plus a load-on-demand history) instead of the engineer table, scoped to that one role. See [x-lt-list-schema.md](hitl/x-lt-list-schema.md) for the `x-lt-layout` / `x-lt-active` / `x-lt-history` vocabulary.

- **Editor + version rail** — same shape as the Escalation Schema editor, but on its own **independent** version timeline: editing the list view never advances the resolve form's version.
- The list always renders the latest version — no pinning (a display template, not a payload contract).

**API:** `GET /api/roles/:role/list-schema` (latest or `?version=`), `GET /api/roles/:role/list-schema/versions`, and `PATCH /api/roles/:role` with `list_schema` (+ optional `change_summary`).

### Personas

Accessible at `/admin/personas` for admins, superadmins, and engineers — the same audience that manages [Accounts](#accounts) and [Roles](#roles). A persona is a named bundle of roles with a per-role relationship scope: assigning it adds a user to every linked role at the linked scope in one step, and each role's own pins and schemas compose the member's sidebar and forms — the composition ("this human runs the floor, which means these roles") is a first-class, auditable record. Full semantics — provenance, highest-allowance union, overlay-on-reassign — are in [iam.md](iam.md#personas).

**Master list** — the working surface. One row per persona: display title, key, description, a preview of the linked role pills, and the holder count; search matches all of them. Select a row to target the **Assignees** panel on the right — assign a user there and they join every linked role in one step, sidebar pins and forms composing from the roles. Unassign from the same panel, or from the account's role panel on [Accounts](#accounts). The row's pencil opens configuration.

**Configuration** (`/admin/personas/:key`) —

- **Identity** — title and description, PATCH-saved.
- **Roles** — the bundle's rules. Each link shows the role pill, its scope badge, and a relationship picker (`Write · act on all`, `Write · act on self`, `Read-only observer`); changing a relationship or unlinking reconciles every holder immediately. Link new roles from the role picker.

**API:** `GET /api/personas` lists. `POST /api/personas` creates; `PATCH`/`DELETE /api/personas/:key` edit and remove. `PUT`/`DELETE /api/personas/:key/roles/:role` manage links. `POST /api/personas/seed` applies a declarative spec set idempotently.

### Scan Codes

Scan codes turn a barcode into an action on an escalation — a floor operator scans a printed code and an item is claimed, resolved, escalated, or opened, with no keyboard. The dashboard captures scans globally: an HID scanner types like a keyboard, and a pattern-anchored wedge accumulates keystrokes and fires on a terminator or a quiet period (scanner-speed keys plus a short silence auto-fire; hand-typed codes need Enter). The matched code is stripped byte-exact from whatever field had focus, so a scan never leaks into a form. The whole surface is gated by `features.scanCodes` in `start()` config (a per-browser toggle in the Features panel flips it for testing); the execute and config APIs work regardless.

A code encodes **`version:category:target`** (e.g. `10:1:SN-12345`):

- **version** (two digits) selects the **scheme** — how the target is parsed and which metadata facet it matches (`serialNumber`, `assetTag`).
- **category** (one digit) selects the **rule** under that scheme.
- **target** is the value matched against the scheme's facet.

**Rules are ECA over escalations.** A rule is an ordered list of event-condition-action steps, first match wins: the event is the scanned code, the condition is a query against the escalation (role, status, availability, metadata facets), and the action is a canonical verb (`show-detail`, `show-list`, `claim`, `claim-show-detail`, `release`, `resolve`, `escalate`, `cancel`, `present`). Mutations ride single-statement by-metadata operations under the caller's own role scope, and stamp provenance facets (`scanScheme`, `scanCategory`, `scanActionName`, `scannedAt`) on every transition. Ordering is the design: put the expected state first and a broad fallback last, since a scan is also a state query.

**Admin config** lives at `/admin/scan-codes` (scheme list) and `/admin/scan-codes/:version` (a scheme with its rules) — builder-gated (admin, engineer, superadmin). A scheme carries a name, its target facet, encoding, and — for identity schemes — a grant policy.

**Station surface.** `/scan/station` is a full-screen scan surface with an idle prompt, an info/choice screen (the current reality plus labeled choices when a rule presents options), and a badge prompt when identity is required. In **kiosk mode** — a login holding exactly one role whose `properties.kiosk` is set — the chrome falls away and only the role's list, escalation detail, and this scan screen are reachable. The header **scan** panel offers the same manual entry and capture settings on any page.

**Badge scanning grants acting identity.** A scheme of kind `identity` binds a badge value to a person (via a facet on `lt_users.metadata`). Scanning a badge primes an **ephemeral acting grant** minted through the internal keystore; it rides subsequent scans as the `X-LT-Acting-Token` header, and verbs then run **as the badged person under their own RBAC** — attribution, never privilege escalation. A badge on a work form belongs to the submission: the form names who will submit, holds if the wrong badge scans, and consumes the single-use grant on the write. A dead grant (expired, exhausted, revoked) fails loudly rather than executing silently.

**API:** `POST /api/scan-codes/execute` runs a code (`{ code, actingToken?, previousActingToken? }`, returning a structured outcome); `POST /api/scan-codes/execute-choice` runs a presented choice (the server re-validates config, row, identity, and RBAC). `GET/PUT/DELETE /api/scan-codes/schemes/:version` and `/schemes/:version/actions/:category` manage schemes and rules. See [Scan Codes](scan-codes.md) for the full concept doc and the four-corner printer demo.

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

Accessible at `/escalations/available`. The central queue for escalation activity across every workflow — every place a running workflow paused to wait on a person or external actor.

- **Title = queue selector** — the page title reads as the selected role's friendly title, or "All Escalations" when unfiltered; clicking it switches queues over the same `?role=` param the filter bar mirrors.
- **Filter bar** — status (available / claimed / resolved / cancelled / expired), role, workflow type, priority, and time window. `available` means pending and either unclaimed or past its claim expiry.
- **Columns:** a **Summary** cell (status dot + description or type), **Assignee** (claimant, or `—`), **Role** pill, **Priority**, and **Created**. The status dot distinguishes pending, claimed, resolved, cancelled, and expired; notification escalations show a bell.
- **Faceted query** — beyond the filter bar, the queue takes a structured metadata query, all URL-backed so a query copy-pastes: `?facets={"orderId":"..."}` (equality, AND-ed), `?block=` (exclude), `?range=` (numeric bounds), `?exists=` (key present), `?roles=` (union of role queues), and `?orderBy=` (JSON sort). `?jeopardy=1` narrows to rows past the role's age threshold. List rows omit the envelope by default; `?include=envelope` pulls the full envelope and payload columns for rich views.
- **Metadata value affordances** — each metadata key/value row carries a three-icon triad on hover: **filter** (scope the current role's queue to `key = value`), **search** (the same facet match across all roles), and **history** (open the entity's cross-queue interval timeline in the right panel — every role this value moved through, with durations and gaps). Filter-present, search-present, history-past. History renders for string values, since the timeline's GIN containment match serves JSON-string facets.
- **View modes** (`?view=`) — `table` (the columns above), `timeline` (100 rows per page of cross-queue movement), and `rich`. When a role owns a [list schema](#escalations-list-schema), the list defaults to the role-authored `rich` view (the live item as a card, plus a load-on-demand history) with a **Table view** toggle back.
- **Claim** — the claim action locks an item to your user for a claim window (default 30 min). Only members of the role see its pending items; a member scoped `read_self` lands directly on their own assigned item rather than browsing the queue. Re-claiming your own expired item extends it rather than failing.
- **Bulk actions (admin)** — row checkboxes surface a selection bar: **Claim**, **Assign**, **Unassign**, **Escalate** (move to another role), and **Cancel**. Assign opens a modal for the target user and claim duration; rows under a live claim are skipped unless the modal's takeover checkbox (shown when the selection includes live claims) reassigns them — admin/superadmin only. Unassign returns claimed rows to the pool. Each response reports how many rows were skipped and why. Scoped to a single role, the Cancel verb and its confirmation speak the role form's `x-lt-labels.cancel` vocabulary (`false` hides it). Assign also accepts a faceted query instead of an id list, so "claim everything matching this facet" is one call.

**API:** `GET /api/escalations` lists with filters; `POST /api/escalations/search-by-facets` backs the faceted query. `POST /api/escalations/bulk-claim`, `/bulk-assign`, `/bulk-unassign`, `PATCH /api/escalations/bulk-escalate`, `POST /api/escalations/bulk-cancel` drive the selection bar.

### My Escalations

Accessible at `/escalations/queue`. The personal inbox — the items currently assigned to you across your roles. It carries the same title-as-role-selector, the same rich/table views, and the same metadata affordances as All Escalations, minus the bulk selection bar (every row is already yours). A **Claim expiry** column counts down each item's remaining window. The shell also auto-navigates here on hand-off: when a workflow assigns a follow-on escalation to you (`assigned_to = you`), the dashboard opens that item's detail directly.

### Escalation Detail & Resolve Form

Accessible at `/escalations/detail/:id`. Where a person completes the work the workflow is waiting on. The main column is the resolve form; a switchable side panel carries context.

- **Lifecycle** — pending → claimed → resolved (or cancelled / expired). The sticky action bar shows the verbs valid for the current state: **Claim**, **Submit** (resolve), **Release**, **Cancel**. The form is read-only until you hold a live claim.
- **Form contract** — the form is the target role's versioned [`form_schema`](#escalation-schema), rendered flat. Fields pre-fill from two sources: the workflow's `envelope.formDefaults` (reverse-mapped through each field's `x-lt-bind` path) and the schema's own field defaults. On submit, the dashboard rebuilds the nested payload from the flat form via `x-lt-bind` and posts it as the resolver payload; password fields are redacted to short-lived ephemeral tokens before storage.
- **Validation** — one isomorphic pass runs on the client (to gate submit) and again on the server when the role sets `enforce_schema`, returning a canonical `422` with field-level errors. It covers required/type/enum/bounds, dynamic `x-lt-minimum`/`x-lt-maximum` (with `{{token}}` interpolation), and the root-level `x-lt-require-any` / `x-lt-require-sum` groups. Fields hidden by `x-lt-showIf` never block submission.
- **Resumption** — resolving resumes the paused workflow. When the escalation was created by `conditional()` (a HotMesh Leg1 write), the resolve is the signal: the run resumes in place with the payload injected, in one atomic Postgres statement — no re-run. A **notification** escalation (no `workflowType`) has no run to resume; **Acknowledge** still validates and submits the full form payload, resolving it atomically.
- **Canned actions** — a form may declare `x-lt-actions`: extra action-bar buttons that submit a preset payload in one click (Approve / Reject / Skip), bypassing field editing.
- **Submit guard** — `x-lt-submit-guard` gates a parent on a child query (e.g. "every item in this batch must resolve first"): the dashboard disables Submit with a live count while rows remain, and the server re-checks the guard atomically inside the resolving `UPDATE` so no race slips through. `autoResolveWhenEmpty` submits the parent the moment the query empties.
- **Transition hand-off** — `x-lt-transition` replaces the return-to-previous-page jump with a short wait screen: the workflow assigns a follow-on escalation back to the submitter, the screen detects it and navigates onward (or falls back to `x-lt-transition-done` after a bounded wait). This is the submit → side-effect → next-step chain (submit, a label prints, the harvest task opens).
- **Batch resolution** — a `conditional({ batch })` escalation accumulates N items on one row; `POST /api/escalations/:id/resolve-batch-item` submits each (claim-agnostic by default, `assertClaim` to require your own live claim), and the last item wakes the workflow with the full collection.
- **Side panel** — switchable views selected by the icon strip: **Help** (the form's `x-lt-help` markdown, `{{domain.path}}`-interpolated against the live record — escalation, metadata, envelope, payload, resolver, and `lookup.*` — or a state-aware hint like "Claim this escalation to enable the form"), **Details** (status, role, priority, claim provenance, timestamps, and for builders the identifier links), **AI Analysis** (what triage diagnosed and corrected, when AI is on), **Metadata** (the row's facets, with the same triad), **Context** (input envelope, escalation context, resolver payload), **Record** (the raw JSON, builders only), and **Errors** (the last submit's validation failures). The panel and form share the width as a flex set; it opens expanded on Help when the form carries `x-lt-help`.
- **Admin claim override** — when an item is held by someone else, admins and superadmins see **Reassign…** (hand the claim to another user, takeover implied) and **Return to queue** (unassign) in the action bar.

**API:** `POST /api/escalations/:id/claim` claims, `/release` releases, `/resolve` resolves; `/resolve-batch-item` submits one batch item; `/escalate` moves; `/cancel` cancels. The role's form and its versions come from `GET /api/roles/:role/schema`.

### Escalations Overview

Accessible at `/escalations`. A statistics dashboard for escalation health across the system.

- **Time window selector** — toggle between 1h, 24h, 7d, and 30d views.
- **Summary cards** — open (pending), claimed (in progress), created (new), and resolved counts for the selected window.
- **Role breakdown table** — groups escalations by role so you can see which teams have the most pending work; cells link into the filtered queue. Useful for identifying bottlenecks and rebalancing workload.

### Pace Board

Accessible at `/pace`. The live picture of how work flows across a segment of roles: actual-vs-target throughput, rendered as a pace chart over a role table with a role detail panel. It answers the question a COO actually asks — *are we keeping up, and where is work backing up?*

The board is [Roles](#roles) end-to-end. Every role on it has **Visible in Operations** on; segments are composed from each role's **Prior Step** (`parent_role`); cross-segment feeds come from **Upstream Inputs**; the target line comes from each role's capacity settings. Configuring the board *is* configuring roles — the **Configure** action opens [Role Detail](#role-detail). See [Operations](operations.md) for the full concept doc.

**Segments.** A segment is a sequence of roles. A role with no prior step (or whose prior step lies outside the visible set) starts a segment, followed by its `parent_role` descendants in dependency order; the longest segment leads. The table is the ground truth of the queues; the chart is the line drawn through them.

**The combined board selector.** One menu switches views. Its **Pace Board** group lists the segments (each row: the segment title, its role count, pending total, and a jeopardy count); its **Trend Board** group lists the entity [lenses](#trend-board) (each `by <facet>`, with a live in-queue count). Choosing a segment stays on `/pace`; choosing a lens navigates to `/trends`. The collapsed button reads the active segment title, or `by <facet>` on a lens.

- **Segment deep link** — the active segment rides `?fragment=<origin role>`; each switch is a history entry, so a shared URL opens the same segment and back/forward walk them.
- **Period** — `15m`, `1h`, `24h`, `7d`, `30d`, default `1h`. It is deep-linked as `?period=` (the default stays out of the URL for clean links) and carries across a Pace↔Trend switch. It bounds resolved counts and the percentile metrics; `pending` is always the live count.
- **Pace chart** — the segment's roles on the X axis in dependency order. A muted-gray dashed **target** polyline sits at each role's expected count (`target_per_hour × window hours`); a green **actual** (resolved) curve with a faint area fill reads against it. The live queue shows as two faint stacked bands beneath — **claimed/worked** (orange) and **waiting/unclaimed** (sky). Each role is a circle on the resolved curve whose radius grows with volume; the selected role gets a ring. A `lin | log` toggle switches the Y axis (log by default, so small and large queues stay legible together).
- **Jeopardy** — a role with unclaimed items past its age threshold carries a jeopardy count (warning triangle) in its row and on the segment menu. Age is measured from the role's **priority facet** (a metadata timestamp such as an order's authorized date; `created_at` when unset) against its **priority threshold** (`sla_minutes` when unset). Clicking it opens the jeopardy deep link — `/escalations/available?role=<r>&jeopardy=1&view=table&orderBy=[{…,"direction":"asc"}]` — the table filtered to exactly the counted items (one server-side predicate feeds both the count and the list, so totals always match), oldest-first by the same facet. A jeopardy pill above the list names the filter; clearing it widens back to the full queue.
- **Merge glyph** — a role that declares upstream inputs shows a small dashed merge glyph at its floor position: deliberately a symbol, never a bend in the line, because the upstream is an input, not a descendant. Hover names the feeding roles; click jumps to their segment.
- **Role table** — columns in order: **NAME**, **ROLE** (the id, wide viewports), **TARGET/H** and **SLA/M** (edit inline), **WORKERS** (derived — `workers = target ÷ (60 ÷ sla)`), then **PENDING**, **CLAIMED**, **RESOLVED** tinted with the chart's hues (each cell links into the queue filtered by that status), **P99 WAIT** and **P99 WORK** (wide viewports), a **MIX** time-in-state bar, a **TREND** mini-bar, and **ACTIONS** (view queue, configure, jeopardy). The TREND bar reads pending-to-target ratio: amber above 1.0 (backlog), gray below 0.2 (idle), green between.
- **Role detail panel** — opens on a row or circle click: the role's identity, its own independent period toggle, the full wait/work percentile breakdown, SLA target and worker count, the time-in-state mix and per-entity timelines inline, and links into the queue.
- **Scope pill** — when your roles declare [link variables](faceted-routing.md#link-variables), a scope pill sits in the header. Your device binding (`facility = north`) narrows the whole board — counts, mix, and every timeline — to that facet, or reads `All` when unbound. It opens the Link variables modal; the value picker's choices come from `GET /api/escalations/facet-values?key=<facet>`.
- **Live updates** — escalation events invalidate the metrics and analytics through the shared realtime scheduler (SUMMARY tier, coalesced); the refresh button forces a reload. Every login may read the board while `features.publicPaceBoard` (default on) stands; turning it off narrows metrics to role membership and the board to admins and superadmins.

A role joins the board from its [Role Detail → Pace Board](#role-detail) section: the visibility toggle, the capacity settings (`sla_minutes`, `target_per_hour`, `worker_count`), the priority dials (`priority_threshold_minutes`, `priority_facet`), and the sequence placement (`parent_role`, upstream inputs).

**API:** `GET /api/escalations/station-metrics?period=<window>&facets=<json>` returns the per-role live counts and windowed percentiles.

### Trend Board

Accessible at `/trends`. The entity lens — *where did the time go?* Instead of role-by-role throughput, it follows one **entity** (a `serialNumber`, an `orderId`) through every role that handles it and shows how its time splits across states. It shares the [combined board selector](#pace-board), the period, and the scope pill with the Pace Board.

The lens is driven by two dials on each role's [Role Detail → Pace Board](#role-detail) section:

- **`entity_facet`** — the `metadata` key naming what moves through the role (`serialNumber`, `orderId`). Roles sharing a key form that entity's **system**. Each distinct facet becomes one lens, deep-linked as `?lens=<facet>` (default: the first facet).
- **`entity_state_source`** — how a role names the entity's state: **Station** (being in this role is one state, e.g. a servicing queue) or **Subtypes** (one role holds several states named by each escalation's subtype, e.g. a fleet role parking `idle` / `printing`).

Three tiers, aggregate to individual:

- **Where the time went** — a ranked-bar legend of states by total dwell over the window (top rows, with a "+N more stages" fold), beside an insight panel: the leader's share as a headline percentage, `<state> is the biggest time sink`, and `across N stages · M <entity> in queue now` for the selected period.
- **Slice by** — `?slice=<facet>` splits the system into small-multiple columns, one per value of that key (e.g. `model` → `p1s` vs `h2s`), ranked by dwell. `?sliceValue=<value>` focuses one value with a paginated entity list.
- **Entity table** — one row per entity, ranked by tracked time: the entity value, a current-state dot, its own dwell band, its total tracked time, and a history action. A **find** box (`?find=<prefix>`) prefix-filters the entities.
- **Per-entity timeline** — `?entity=<value>` opens that entity's cross-queue interval timeline in the right panel: every role it moved through, with durations and gaps. The panel's copy-link emits a shareable `/trends?lens=<facet>&entity=<value>` URL.

The aggregate bands are counts-only and readable by any login while the public board flag stands; the slice and per-entity tiers group by facet values and require full (`read_all`) access to the system's queues.

**API:** `POST /api/escalations/aggregate-by-facets` (the state-mix and rankings) and `POST /api/escalations/timeline-by-facet` (the per-entity intervals). See [Escalation Analytics](escalation-analytics.md) for the query contract.

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

Accessible at `/files`. Browse and manage files in the connected storage backend (MinIO locally, S3/GCS in production).

- **File browser** — navigate directories with breadcrumbs; the list shows name, size, and last-modified. Paginated via a continuation token.
- **Preview panel** — click a file to preview it in the side panel: images inline, text and code inline, JSON, and a PDF open-in-tab. Everything else downloads.
- **Upload** — drag and drop, or the file input, into the current prefix; a confirmation names the target path.
- **Signed URLs** — generate a time-boxed download link for a file (expiry from a fixed set, 1h to 30d).

The backend is selected by the `LT_STORAGE_BACKEND` env var — `local` (filesystem) or `s3` (S3-compatible, including MinIO). The same interface serves every backend; only env changes.

**API:** `GET /api/file-browser/browse?prefix=<path>` lists. `POST /api/file-browser/upload?path=<path>` uploads raw bytes. `GET /api/file-browser/download/<path>` downloads; `DELETE /api/file-browser/delete/<path>` removes; `POST /api/file-browser/signed-url` mints a link. Token-scoped serving is at `GET /api/files/<path>?token=<jwt>`.

### Knowledge

Accessible at `/knowledge` (builder-only — superadmin or the `engineer` role). A **versioned** store of domain data that workflows and resolver forms read at runtime: product catalogs, reference tables, cascade option sets. An entry is keyed by `domain` + `key` and holds a JSON `data` value plus `tags`.

**Versioning is the defining property.** Every write that changes an entry's `data` mints an immutable edition and advances `current_version`; writes that leave the data identical (or touch only tags) are no-ops that never bump the version. The live entry is the current edition; past editions are retained and read-only.

- **Browse** — All Domains → a domain's entries (each row shows key, tags, field count, and current version) → an entry detail with a full JSON editor.
- **Version rail** — the entry detail's version dropdown lists every edition, newest first, the current one marked. Selecting a past edition sets `?version=<N>` and shows an immutable, read-only snapshot with a "back to current" affordance.
- **Field-level edits** — set or remove a value at a dot-path (`jsonb_set` / path delete) without clobbering sibling keys; each still mints an edition when the data changes.

**How workflows and forms consume it.** A workflow pins knowledge onto an escalation as versioned lookup refs on the reserved `envelope.lookups` key — `{ domain, key, version, as? }`. Because the ref names an exact edition, the resolver always sees the data the workflow was written against, even as the entry later evolves. Resolving those refs (`GET /api/escalations/:id/lookups`, in-process LRU cached) exposes a `lookup.<key>` domain to the form: a field's `x-lt-options` reads `lookup.materials.items`, and cascades interpolate the live form — `lookup.geo.regions.{{resolver.country}}` narrows the second select from the first. The reader needs no separate knowledge grant; the ref on an escalation they can read *is* the grant. Agents reach the same data through the `get_knowledge` MCP tool (with an optional `version`).

**API:** `GET /api/knowledge/domains` and `/entries?domain=` list; `GET /api/knowledge/entry?domain=&key=&version=` fetches the live entry or a pinned edition; `GET /api/knowledge/entry/versions?domain=&key=` returns the lineage. `POST /api/knowledge/entry` creates or merges, `PUT /api/knowledge/field` sets a path, `DELETE /api/knowledge/field` removes one, `DELETE /api/knowledge/entry` deletes (cascading its editions). See [Knowledge HTTP API](api/http/knowledge.md).

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

## Realtime Refresh Strategy

The dashboard is push-driven: broker events (Socket.IO or NATS) invalidate React Query keys and the mounted queries refetch — never polling. Every event-driven refetch flows through one shared scheduler (`dashboard/src/lib/realtime-refresh.ts`), which bounds the rate a surface can hit the API however heavy the event stream runs:

| Tier | Surfaces | Coalesce window | Minimum interval | Worst-case rate |
|------|----------|-----------------|------------------|-----------------|
| `DETAIL` | One record's page (escalation, workflow, process detail) | 300 ms | 2 s | 0.5 req/s |
| `LIST` | Queues and job lists (escalations, workflows, processes, agents, knowledge) | 500 ms | 3 s | 0.33 req/s |
| `SUMMARY` | Aggregates (pace board metrics, stats, mix and timeline analytics, header counts, pin badges) | 1 s | 10 s | 0.1 req/s |

- **Coalesce**: the first event opens a window; a burst inside it lands as one flush.
- **Minimum interval**: after a flush, the next waits at least this long — events during the cooldown collapse into exactly one trailing flush, so sustained load neither starves the surface nor exceeds the bound.
- **One scheduler per client**: identical query keys requested by several hooks in a window invalidate once, and a key wanted by two tiers flushes on the snappier lane.
- **Hidden tabs cost nothing**: a background tab's flushes mark queries stale without any network (`refetchType: 'none'`); one catch-up refetch runs when the tab becomes visible.
- **Mutations stay immediate**: a user's own action (claim, resolve, bulk ops) invalidates directly in its `onSuccess` — the tiers govern only event-driven refresh.

Every timing constant — the three tiers and the shared `SEARCH_DEBOUNCE_MS` input debounce — lives in `dashboard/src/lib/realtime-refresh.ts`. Tune there; nothing else in the event path carries a number.

## Global Features

### Announcements

A full-width notice line under the header carries published announcements —
maintenance windows, shift notes, anything the floor should read. Role
managers (superadmin, admin, engineer) publish through
`POST /api/announcements` or the `publish_announcement` admin tool; only the
markdown body is required, and title, layout, role targeting, and expiry
(default 24 hours) fill in. Connected dashboards show a new announcement live
over the `system.surfaces.dashboard` event; everyone else sees it on their
next load. The collapsed line shows the headline; expanding renders the
markdown body. Each user dismisses per-browser.

Role targeting scopes display, never access: the live event reaches every
authenticated subscriber, so announcement bodies must never carry secrets.

### Search and run

The header bar is one input with two verbs, chosen by the type chip that
trails it. **Find** modes look an escalation up; **Run** modes execute a scan
code composed from a chosen rule plus the typed target. The bar appears when
either verb is enabled and offers whichever modes the deployment provides.

**Find** is the opt-in global search. Configure it in the `start()` config —
`search: { enabled: true, facets: ['orderId', 'po'] }` — or by env
(`LT_SEARCH_BAR=true`, `LT_SEARCH_FACETS=orderId,po`; env wins). The chip
always offers `escalationId` and `workflowId` (long-tail-owned lookups) ahead
of the configured metadata facets.

- A metadata facet lands on the escalation list filtered by that facet across
  all statuses, newest first (the same deep link as clicking a facet value).
- `escalationId` opens the escalation detail directly; an unknown id shows an
  inline notice without navigating.
- `workflowId` opens the workflow's single escalation, lists several to pick
  from, or links straight to the workflow execution when none exist.

**Run** appears when `features.scanCodes` is on. Every enabled rule of every
enabled action scheme is a mode, grouped by scheme; pick one and the bar
shows its code head (`10:1:`) ahead of the input and names the target facet
in the placeholder. Type the target and press Enter: the bar composes
`10:1:<target>` and executes it through the same pipeline a scanner uses, so
the outcome navigates, confirms, or answers exactly as a physical scan would.
An outcome that answers in place (a fallback, a conflict, a closed row) is
narrated right under the bar. A whole code pasted into a Run mode executes
as-is; fixed-encoding rules accept digits only and say so inline. The menu
footer opens the scan panel for scanner settings and the barcode preview.
See [Scan codes](scan-codes.md).

The chip remembers the last-used mode per device. Kiosk sessions see the bar
too — a station can dump a PO or order id and jump straight to it, or run a
rule against a serial it can read but not scan; RBAC bounds what any search or
run can reach. See [Faceted Routing](faceted-routing.md) — a search is a
one-gesture facet deep link.

### Inbox

The Inbox icon in the header shows a badge count when the current user has pending escalations assigned to their roles. The count updates live via NATS — no polling needed.

### Event Feed

The bottom bar contains a collapsible live event stream showing workflow start/completion events, task state transitions, escalation activity, and activity checkpoints. Events stream via NATS subscription.

### Claim Hand-off

The shell monitors the role-scoped `claimed` events across the viewer's roles; when one carries `assigned_to = viewer`, the dashboard navigates to that escalation's detail page. Pre-assignment is the system saying "this is yours next," and the UI honors it: a resolve → side-effect → follow-on chain (e.g. submit, a label prints, the harvest task opens) lands the user on the next step instead of history's previous page.

Workflows need no UI coupling — assigning the follow-on escalation to the resolving user is the whole contract. The gesture is naturally idempotent: a claim the user made themselves resolves to the page their click already opened.

### Contextual Documentation

Each page header includes a documentation icon that opens the in-app docs drawer to the relevant section. The drawer supports navigation history, anchor linking, and markdown rendering.

### Page Transitions

Navigation between pages uses a smooth fade transition for responsive feel during client-side routing.
