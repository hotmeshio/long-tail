# Dashboard Guide

The Long Tail dashboard is a React single-page application for managing durable workflows, MCP pipelines, escalations, and system administration. It connects to the Long Tail backend over REST and receives real-time updates via NATS subscriptions.

## Sidebar Navigation

The sidebar organizes pages into three groups.

### Durable Workflows

| Page | Purpose |
|------|---------|
| **Workflow Registry** | Lists all discovered workflows. Each row shows a certified (shield icon) or durable badge. Certify or de-certify workflows from this page. |
| **Invoke Workflow** | Unified launch page for all durable workflows. Start a workflow immediately or schedule it on a cron. Certified and durable workflows appear together with visual distinction. |
| **Durable Executions** | All workflow runs. Filter by tier: All, Certified, or Durable. Each row links to execution details, task records, and escalation history. |
| **Escalations** | Queue of pending, claimed, and resolved escalations. Claim an escalation to lock it, then resolve with a payload that triggers a workflow re-run. |

### MCP Workflows

| Page | Purpose |
|------|---------|
| **MCP Server Tools** | Browse all registered MCP servers and their exposed tools. View tool schemas, tags, and compile hints. |
| **MCP Pipeline Tools** | Tools available within MCP pipelines. Shows which tools the pipeline orchestrator can discover and invoke. |
| **Pipeline Designer** | Three-step lifecycle for building deterministic pipelines. Describe the goal, discover relevant tools, then compile to a reusable DAG. Detailed below. |
| **Pipeline Executions** | Execution history for MCP pipelines. Shows both dynamic (agentic) and compiled (deterministic) runs. |

### Admin

| Page | Purpose |
|------|---------|
| **Accounts** | Unified management for User Accounts and Service Accounts, toggled by tab. Create, edit, and assign roles. Service accounts get API keys for programmatic access. |
| **Roles & Permissions** | Define roles and assign them to users. Roles control which escalations a user can see and claim. |
| **DB Maintenance** | Database housekeeping. Vacuum, reindex, and view table statistics. |
| **Task Queues** | View active task queues, connected workers, and queue depth. |

## Key Pages

### Workflow Registry

Shows every workflow the system has discovered across all registered workers. Each workflow displays one of two badges:

- **Certified** (shield icon) -- has an `lt_config_workflows` entry. Full interceptor tracking, escalation chains, and invocation controls.
- **Durable** -- registered as a HotMesh worker but not certified. Checkpointed execution and retries, but no interceptor wrapping.

Click a workflow to view its config. Certify a durable workflow by creating a config entry; de-certify by removing it. The workflow itself does not change -- only the infrastructure wrapping it.

### Invoke Workflow

A single page for starting any durable workflow. Select the workflow, provide input data as JSON, and choose:

- **Start Now** -- immediate execution.
- **Schedule** -- provide a cron expression for recurring execution.

Certified and durable workflows both appear in the list. Certified workflows show the shield icon so operators can distinguish which runs will have full tracking and escalation support.

### Pipeline Designer

The Pipeline Designer walks through three steps to turn a natural-language goal into a compiled deterministic pipeline.

1. **Describe** -- Enter a plain-text description of the goal. Optionally constrain which MCP tool tags to search.
2. **Discover** -- The system queries MCP servers by tag, selects relevant tools, and executes the pipeline dynamically (agentic loop). The result is displayed along with the tool calls that were made.
3. **Compile** -- The executed tool-call sequence is compiled into a deterministic YAML DAG. Future invocations skip the LLM entirely and replay the compiled steps.

Compiled pipelines appear in Pipeline Executions as deterministic runs, which are faster and cheaper than their dynamic counterparts.

### Durable Executions

Lists all workflow runs across the system. The tier filter at the top switches between:

- **All** -- every execution.
- **Certified** -- only workflows with `lt_config_workflows` entries.
- **Durable** -- only uncertified durable workflows.

Each row shows workflow name, status, start time, and duration. Click through to see the full task record, activity checkpoints, milestones, and any associated escalations.

### Accounts

User Accounts and Service Accounts live on the same page, separated by a tab toggle.

- **User Accounts** -- human operators. Assign roles, set display names, manage access.
- **Service Accounts** -- programmatic callers (bots, CI pipelines, external systems). Each service account has an API key for authentication. Assign roles to control which workflows a service account can invoke and which escalations it can interact with.

Both account types participate in the same role system. A service account with the `reviewer` role can claim and resolve escalations just like a human user.

## Global Features

### Inbox

The inbox icon in the top navigation bar shows a red dot when the current user has pending escalations assigned to their roles. The count updates live via a NATS subscription -- no polling or page refresh needed.

Click the inbox icon to jump directly to the Escalations page, filtered to the user's actionable items.

### Event Feed

The bottom bar contains a collapsible live event stream. Click the radio icon to toggle it open or closed. When open, it displays a real-time feed of:

- Workflow start and completion events
- Task state transitions
- Escalation creation, claim, and resolution
- Activity checkpoint events

Events stream in via NATS subscription. The feed is useful during development and debugging to watch workflow execution unfold in real time.

### Page Transitions

Navigation between pages uses a smooth fade transition. This keeps the UI responsive during client-side routing and prevents visual jarring when switching contexts.
