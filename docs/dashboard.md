# Dashboard Guide

The Long Tail dashboard is a React single-page application for managing durable workflows, MCP pipelines, escalations, and system administration. It connects to the Long Tail backend over REST and receives real-time updates via NATS subscriptions.

## Sidebar Navigation

The sidebar organizes pages into three groups.

### Durable Workflows

| Page | Purpose |
|------|---------|
| **Workflow Registry** | Lists all discovered workflows. Each row shows a Certified (ShieldCheck icon, accent blue), Pipeline (Wand2 icon, purple), or Durable badge. Certify or de-certify workflows from this page. |
| **Invoke Workflow** | Unified launch page for all durable workflows. Start a workflow immediately or schedule it on a cron. Certified and durable workflows appear together with visual distinction. |
| **All Escalations** | Queue of pending, claimed, and resolved escalations. Claim an escalation to lock it, then resolve with a payload that triggers a workflow re-run. |
| **Durable Executions** | All workflow runs. Filter by tier: All, Certified, or Durable. Each row shows duration and links to execution details, task records, and escalation history. |

### MCP Workflows

| Page | Purpose |
|------|---------|
| **MCP Server Tools** | Browse all registered MCP servers and their exposed tools. View tool schemas, tags, and compile hints. |
| **MCP Pipeline Tools** | Tools available within MCP pipelines. Shows which tools the pipeline orchestrator can discover and invoke. |
| **Pipeline Designer** | Six-step compilation wizard. Submit a query, review the dynamic execution, compile to a deterministic pipeline, deploy, test, and verify end-to-end routing. Detailed below. |
| **Pipeline Executions** | Execution history for MCP pipelines. Shows both dynamic (agentic) and compiled (deterministic) runs, with duration for each. |

### Admin

| Page | Purpose |
|------|---------|
| **Accounts** | Unified management for User Accounts and Service Accounts, toggled by tab. Create, edit, and assign roles. Service accounts get API keys for programmatic access. |
| **Roles & Permissions** | Define roles and assign them to users. Roles control which escalations a user can see and claim. |
| **DB Maintenance** | Database housekeeping. Vacuum, reindex, and view table statistics. |
| **Task Queues** | View active task queues, connected workers, and queue depth. |

### Header

The top navigation bar contains:

- **Home logo** — links to the home page (`/`), which shows all business processes.
- **Quick Query** — a search/prompt field for launching MCP queries directly from the header.
- **Documentation** (BookOpen icon) — toggles an in-app documentation drawer.
- **Inbox** (Inbox icon) — links to `/escalations/queue` (My Escalations). Shows a badge count of pending escalations for the current user's roles.
- **NATS status indicator** — shows connection health.
- **User menu** (User icon) — dropdown with Credentials and Sign Out options.

## Key Pages

### Workflow Registry

Shows every workflow the system has discovered across all registered workers. Each workflow displays one of three badges:

- **Certified** (ShieldCheck icon, accent blue) -- has an `lt_config_workflows` entry. Full interceptor tracking, escalation chains, and invocation controls.
- **Pipeline** (Wand2 icon, purple) -- a compiled deterministic workflow deployed from a successful MCP execution.
- **Durable** (Workflow icon, muted) -- registered as a HotMesh worker but not certified. Checkpointed execution and retries, but no interceptor wrapping.

Click a workflow to view its config. Certify a durable workflow by creating a config entry; de-certify by removing it. The workflow itself does not change -- only the infrastructure wrapping it.

### Invoke Workflow

A single page for starting any durable workflow. Select the workflow, provide input data as JSON, and choose:

- **Start Now** -- immediate execution.
- **Schedule** -- provide a cron expression for recurring execution.

Certified and durable workflows both appear in the list. Certified workflows show the shield icon so operators can distinguish which runs will have full tracking and escalation support.

### Pipeline Designer

The Pipeline Designer page lists previous MCP query runs and provides a prompt to start new ones. Click into a completed run to open the six-step **Compilation Wizard**:

1. **Describe** -- View the original dynamic execution: input envelope and structured output side by side.
2. **Discover** -- Swimlane timeline of tool calls, grouped by MCP server, positioned on a time axis.
3. **Compile** -- Define the deterministic workflow: namespace, tool name, description, tags. Triggers the five-stage compilation pipeline.
4. **Deploy** -- Review the compiled YAML DAG, input/output schemas, and version history. Deploy and activate.
5. **Test** -- Run the compiled workflow and compare results side-by-side against the original dynamic execution.
6. **Verify** -- End-to-end routing verification. Submit the original prompt through `mcpQueryRouter` to confirm the deterministic path is discovered and used.

Steps unlock sequentially. Compiled pipelines appear in **Pipeline Executions** as deterministic runs, which are faster and cheaper than their dynamic counterparts. See the [Compilation Pipeline](compilation.md) guide for the full walkthrough.

### Durable Executions

Lists all workflow runs across the system. The tier filter at the top switches between:

- **All** -- every execution.
- **Certified** -- only workflows with `lt_config_workflows` entries.
- **Durable** -- only uncertified durable workflows.

Each row shows workflow name, status, start time, and duration (computed from start to completion). Click through to see the full task record, activity checkpoints, milestones, and any associated escalations.

### Accounts

User Accounts and Service Accounts live on the same page, separated by a tab toggle.

- **User Accounts** -- human operators. Assign roles, set display names, manage access.
- **Service Accounts** -- programmatic callers (bots, CI pipelines, external systems). Each service account has an API key for authentication. Assign roles to control which workflows a service account can invoke and which escalations it can interact with.

Both account types participate in the same role system. A service account with the `reviewer` role can claim and resolve escalations just like a human user.

### Escalation Detail

Click any escalation to open a full-page detail view. The page has a hero section summarizing the escalation, an action bar (Claim, Resolve, Escalate, Triage options), a resolver form when claimed, a timeline of events, and the full context data. Triage options are available when the MCP escalation strategy is configured.

### Escalations Overview

Accessible at `/escalations`, the overview page shows summary statistics across configurable time windows (1h, 24h, 7d, 30d): open, claimed, created, and resolved counts. A breakdown table groups escalations by role.

### Workflows Overview

Accessible at `/workflows`, the overview page shows workflow statistics across time windows (1h, 24h, 7d, 30d): total, running, completed, failed counts, and average duration grouped by workflow type.

### MCP Overview

Accessible at `/mcp`, the overview page shows MCP server and tool statistics alongside pipeline execution history across time windows.

### Process Detail

Click any process on the home page (`/`) to open a detail view at `/processes/detail/:originId`. This shows a swimlane timeline of all tasks and escalations sharing the same origin, giving a unified view of a multi-step workflow's progress.

### Credentials

Accessible via the user menu in the header (or at `/credentials`), this page lets users manage their OAuth provider connections and API keys. Status, credential type, and expiry are visible. Users connect or revoke providers here.

## Global Features

### Inbox

The Inbox icon in the header shows a badge count when the current user has pending escalations assigned to their roles. The count updates live via a NATS subscription — no polling or page refresh needed.

Click the icon to jump to **My Escalations** (`/escalations/queue`) — the operator dashboard showing claimed escalations with time-remaining columns, filter bar, and release actions.

### Event Feed

The bottom bar contains a collapsible live event stream. Click the radio icon to toggle it open or closed. When open, it displays a real-time feed of:

- Workflow start and completion events
- Task state transitions
- Escalation creation, claim, and resolution
- Activity checkpoint events

Events stream in via NATS subscription. The feed is useful during development and debugging to watch workflow execution unfold in real time.

### Page Transitions

Navigation between pages uses a smooth fade transition. This keeps the UI responsive during client-side routing and prevents visual jarring when switching contexts.
