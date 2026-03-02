# Long Tail

Every enterprise has approval chains, compliance checks, document reviews. These exist for good reasons — regulatory requirements, quality standards, institutional knowledge. You can't hand them to an LLM and hope for the best. AI must participate, not replace.

### De-risk through determinism

Long Tail is a durable workflow engine. Every activity is checkpointed. Every result is cached. If the process crashes between an AI extraction and a database validation, it replays from the last checkpoint — the model isn't called twice. The deterministic pipeline is the safety net: retries, exactly-once execution, transactional state, all in Postgres.
- **MCP-native** — AI tools and human escalation on the same protocol, both durable
- **Postgres-only** — state, queues, escalations, audit trails
- **Durable execution** — survives crashes, deploys, restarts
- **Pluggable** — auth, events, telemetry, logging, maintenance; ship defaults or wire your own

Write a workflow. If AI is confident, the task completes. The deterministic path handles it.

### When AI isn't confident — escalate

When the model can't decide, the workflow returns an escalation. A background interceptor creates a record with full context — what the AI tried, what it saw, why it wasn't confident — and the workflow ends. No long-running poll. No open connection. A human (or another agent) claims the escalation, resolves it, and the workflow re-runs with the resolver's payload. The deterministic path resumes.

### When the resolver can't fix it — remediate

Sometimes the human *can't* produce the correct data. An upside-down page. A corrupted image. A document in the wrong language. The resolver knows what's wrong but can't fix it themselves. They need the system to fix it and retry.

This is where MCP triage takes over. The resolver flags `needsTriage` with a hint — say, `image_orientation`. Long Tail starts a triage orchestrator that:

1. Queries all upstream tasks to understand what happened
2. Reads the hint to determine what remediation is needed
3. Calls MCP tools to apply the fix (rotate the page, re-encode the image, translate the document)
4. Re-invokes the original workflow with corrected data

The original workflow runs again — this time with a rotated page instead of an upside-down one. Extraction succeeds. Validation passes. The triage orchestrator signals back to the parent. The deterministic path completes as if nothing went wrong.

```
Deterministic pipeline ──► AI fails ──► Escalation
                                             │
                              Resolver says "page is upside down"
                                             │
                              Triage orchestrator ──► MCP tools fix it
                                             │
                              Re-invokes original workflow
                                             │
                              Deterministic pipeline completes ◄──
```

### Who resolves? Anyone. What resolves? Anything.

The escalation queue is an API. Who — or what — consumes it is a deployment decision, not an architectural one:

- **A human team** triaging a queue of AI-flagged items in a purpose-built SPA
- **An MCP-aware AI agent** connecting to Long Tail's Human Queue server — the same protocol it uses to call any other tool
- **A triage orchestrator** calling MCP tools to remediate the problem autonomously
- **A hybrid** — AI diagnoses the issue, tools fix it, a human signs off

Humans and AI are interchangeable at every resolution point. Both speak MCP. Both are checkpointed. Both feed their results back into the same deterministic flow. The system doesn't care who's on either end — it cares that the work gets done, the state is consistent, and the audit trail is complete.

This is the shape of AI in the enterprise: not AI *replacing* process, but AI *participating* in process — with deterministic execution as the foundation, escalation as the safety net, and tool-aware remediation as the escape hatch when neither AI nor humans can produce the answer directly.

## Quick Start

Run the full stack locally with Docker. This starts Postgres, NATS, the API server, the dashboard, and seeds example workflows and users — everything needed to explore Long Tail immediately.

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
npm install
docker compose up -d --build
```

Once the container is healthy (~10 seconds), open the dashboard at [http://localhost:3000](http://localhost:3000).

### Demo accounts

| User | Password | Role |
|------|----------|------|
| `superadmin` | `superadmin123` | superadmin |
| `admin` | `admin123` | admin |
| `engineer` | `engineer123` | engineer |
| `reviewer` | `reviewer123` | reviewer |

### Seeded segments

Three workflows run automatically on startup to populate the dashboard:

1. **Clean Review** — AI auto-approves high-quality content. Happy path.
2. **Flagged for Review** — AI flags content for human review. Log in as `reviewer` and approve or reject.
3. **Wrong Language** — Content arrives in Spanish. Walk the escalation chain: `reviewer` escalates to `admin`, `admin` escalates to `engineer`, `engineer` triggers MCP triage with hint `wrong_language`. The triage orchestrator translates the content, re-runs the workflow, and recommends adding language detection.

### Reset

To wipe the database and start fresh:

```bash
docker compose down -v
docker compose up -d --build
```

## Contents

- [Quick Start](#quick-start)
- [Install](#install)
- [Connect and Start Workers](#connect-and-start-workers)
- [Write a Workflow](#write-a-workflow)
- [What Happens When It Runs](#what-happens-when-it-runs)
- [The Human Side](#the-human-side)
- [Composing Workflows](#composing-workflows)
- [Milestones](#milestones)
- [Roles](#roles)
- [Invoking Workflows](#invoking-workflows)
- [MCP Integration](#mcp-integration)
- [Pluggable Architecture](#pluggable-architecture) — [Auth](docs/auth.md) · [Events](docs/events.md) · [Telemetry](docs/telemetry.md) · [Logging](docs/logging.md) · [MCP](docs/mcp.md) · [Maintenance](docs/maintenance.md) · [Escalation Strategies](docs/escalation-strategies.md)
- [Execution History Export](#execution-history-export)
- [How It Works](#how-it-works)
- [API Reference](#api-reference) — [Workflows](docs/api/workflows.md) · [Tasks](docs/api/tasks.md) · [Escalations](docs/api/escalations.md) · [Users](docs/api/users.md) · [Roles](docs/api/roles.md) · [Maintenance](docs/api/maintenance.md) · [DBA](docs/api/dba.md) · [Exports](docs/api/exports.md)
- [Deployment](#deployment) — [Cloud Deployment](docs/cloud.md)
- [Data Model](docs/data.md)
- [Contributing](docs/contributing.md)

## Install

```bash
npm install @hotmeshio/long-tail @hotmeshio/hotmesh
```

## Connect and Start Workers

Long Tail embeds its own server, starts workers, and manages all cross-cutting concerns. Pass a config object to `start()` and everything is handled:

```typescript
import { start } from '@hotmeshio/long-tail';
import * as myWorkflow from './workflows/my-workflow';

const lt = await start({
  database: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'password',
    database: 'mydb',
  },
  workers: [
    {
      taskQueue: 'my-queue',
      workflow: myWorkflow.myWorkflow,
    },
  ],
});
```

That's it. Migrations run, the interceptor registers, workers start, the API server listens on port 3000, and maintenance is scheduled. The only infrastructure is PostgreSQL.

### Start a workflow

```typescript
const handle = await lt.client.workflow.start({
  args: [{ data: { contentId: '123', content: 'Review this' }, metadata: {} }],
  taskQueue: 'my-queue',
  workflowName: 'myWorkflow',
  workflowId: `review-${Date.now()}`,
  expire: 86_400,
});

const result = await handle.result();
```

### Shutdown

```typescript
await lt.shutdown();
```

## Write a Workflow

A workflow is a function. It receives input (an envelope), does work, and returns a result or an escalation.

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import type { LTEnvelope, LTReturn, LTEscalation } from '@hotmeshio/long-tail';

import * as activities from './activities';

const { analyzeContent } = Durable.workflow.proxyActivities<typeof activities>({
  activities,
});

export async function reviewContent(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  // On re-entry after human resolution, return the resolver's decision
  if (envelope.resolver) {
    return {
      type: 'return',
      data: { ...envelope.data, resolution: envelope.resolver },
      milestones: [{ name: 'human_review', value: 'resolved' }],
    };
  }

  const { content } = envelope.data;
  const analysis = await analyzeContent(content);

  if (analysis.confidence >= 0.85) {
    return {
      type: 'return',
      data: { approved: true, analysis },
      milestones: [{ name: 'ai_review', value: 'approved' }],
    };
  }

  // Not confident — escalate to a human
  return {
    type: 'escalation',
    data: { content, analysis },
    message: `Review needed (confidence: ${analysis.confidence})`,
    role: 'reviewer',
  };
}
```

Activities are where side effects live — API calls, LLMs, database reads. They run outside the deterministic sandbox so they can do I/O:

```typescript
// activities.ts
export async function analyzeContent(content: string): Promise<AnalysisResult> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `Analyze this content: ${content}` }],
  });
  return parseResponse(response);
}
```

Activities are retried on failure and checkpointed. If the process crashes mid-workflow, it replays from the last checkpoint — not from the beginning.

## What Happens When It Runs

Before you run a workflow, you register it with Long Tail. This ensures automatic task tracking, escalation management, and audit trails:

```
PUT /api/workflows/reviewContent/config

{
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer"],
  "invocable": true
}
```

`is_lt: true` turns on the interceptor for this workflow. `default_role` and `roles` control who gets the escalation when the AI isn't confident enough to decide on its own. `invocable: true` exposes the workflow for invocation via the public API (see [Invoking Workflows](#invoking-workflows)).

From there, two things can happen when `reviewContent` runs:

- **AI is confident** — the task completes. A record lands in `lt_tasks` with the status and the data your workflow returned.
- **AI isn't confident** — the workflow pauses and an escalation appears in `lt_escalations` with the target role and the message your workflow provided. A human (or another agent) claims it, resolves it, and the workflow resumes exactly where it left off.

It's just Postgres. You can query it, join it, export it, build dashboards on it.

## The Human Side

When AI escalates, someone needs to handle it — a human team, another AI agent, or a hybrid where AI does a first pass and routes to a human for sign-off. The escalation API is the same regardless.

### Checking the queue

A reviewer pulls their available work. Escalations are filtered by role, so each reviewer only sees what's relevant to them:

```
GET /api/escalations/available?role=reviewer
```

```json
{
  "escalations": [
    {
      "id": "esc-abc123",
      "workflow_type": "reviewContent",
      "message": "Review needed (confidence: 0.72)",
      "data": { "content": "...", "analysis": { "confidence": 0.72 } },
      "role": "reviewer",
      "status": "pending"
    }
  ]
}
```

The escalation carries everything the AI tried and why it wasn't confident — the reviewer has full context.

### Claiming an escalation

Claiming locks the escalation so no one else picks it up. The lock is time-boxed — if the reviewer doesn't finish, it goes back to the queue automatically:

```
POST /api/escalations/esc-abc123/claim

{ "durationMinutes": 30 }
```

### Resolving it

The reviewer makes their decision and resolves the escalation. This restarts the workflow with the resolver's payload injected into `envelope.resolver`:

```
POST /api/escalations/esc-abc123/resolve

{
  "resolverPayload": {
    "approved": true,
    "notes": "Content is fine, AI was overly cautious"
  }
}
```

The workflow re-runs. This time `envelope.resolver` is populated, so the `if (envelope.resolver)` branch from the workflow code above executes — the resolver's decision becomes the final result, and the task completes.

## Composing Workflows

Workflows can call other workflows. An orchestrator coordinates child workflows, each of which can independently succeed or escalate:

```typescript
import { executeLT } from '@hotmeshio/long-tail';

export async function processDocument(envelope: LTEnvelope) {
  const extraction = await executeLT({
    workflowName: 'extractDocument',
    args: [envelope],
    taskQueue: 'long-tail',
  });

  const validation = await executeLT({
    workflowName: 'validateExtraction',
    args: [{ data: extraction, metadata: envelope.metadata }],
    taskQueue: 'long-tail',
  });

  return { type: 'return', data: { extraction, validation } };
}
```

If `extractDocument` escalates to a human, the orchestrator waits. When the escalation is resolved, it resumes exactly where it left off and runs `validateExtraction`. No polling, no callbacks — just sequential code.

Children that share an `originId` can read each other's completed data automatically. Declare what a workflow [`consumes`](docs/api/workflows.md#create-or-replace-a-workflow-configuration) in its config, and Long Tail injects sibling results into `envelope.lt.providers` at runtime — no manual threading required.

## Milestones

Milestones are structured markers that workflows emit at key decision points. They're included in the return value:

```typescript
return {
  type: 'return',
  data: { approved: true },
  milestones: [{ name: 'ai_review', value: 'approved' }],
};
```

Milestones are persisted on the task record and published to any registered event adapters (NATS, SNS, Kafka, webhooks). This means external systems can react to workflow progress in real time — trigger notifications, update dashboards, or feed analytics — without polling.

When a human resolves an escalation, the interceptor automatically appends `escalated` and `resolved_by_human` milestones, so you always know which tasks went through human review.

## Roles

Roles connect workflows to people. When a workflow escalates to the `reviewer` role, every user assigned that role sees it in their queue. Roles are implicit — they exist the moment you reference them. There's no separate "create role" step.

A role appears in two places: the [workflow config](docs/api/workflows.md#create-or-replace-a-workflow-configuration) (`default_role` and `roles`) and the [user record](docs/api/roles.md) (assigned via the roles API).

### Role types

Every role assignment has a `type` that controls what the user can manage — not what they can see. All three types can claim and resolve escalations for their role.

| Type | Permissions |
|------|-------------|
| `member` | Claim and resolve escalations for this role |
| `admin` | Everything a member can do, plus manage users within this role |
| `superadmin` | Full access — manage all roles, all users, system configuration |

A user can hold multiple roles with different types. See the [Users](docs/api/users.md) and [Roles](docs/api/roles.md) API docs for assignment examples.

## Invoking Workflows

Any registered workflow can be invoked via the public API. Set `invocable: true` in the [workflow config](docs/api/workflows.md#create-or-replace-a-workflow-configuration) and optionally restrict access with `invocation_roles`:

```
PUT /api/workflows/reviewContent/config

{
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer"],
  "invocable": true,
  "invocation_roles": ["submitter", "admin"]
}
```

Then invoke it:

```
POST /api/workflows/reviewContent/invoke

{
  "data": {
    "contentId": "doc-42",
    "content": "Review this document"
  }
}
```

```json
{
  "workflowId": "reviewContent-a1b2c3",
  "message": "Workflow started"
}
```

The workflow runs durably from here. Track progress with the [status and result endpoints](docs/api/workflows.md#observation), or let milestones and events handle downstream notifications.

When `invocation_roles` is empty, any authenticated user can invoke. When set, the user must hold at least one matching role. Superadmins always bypass. Authorization lives in the database config — change who can invoke without redeploying. See the full [invocation API](docs/api/workflows.md#invocation) for details.

## MCP Integration

MCP is the shared language. AI tools — vision, classification, search — run as MCP servers whose calls are checkpointed as durable activities. Human escalation runs as an MCP server too. A workflow can call an AI tool and escalate to a human reviewer through the same protocol, with the same durability guarantees. See [docs/mcp.md](docs/mcp.md) for the full guide.

### MCP Tool Calls as Durable Activities

Register external MCP servers and invoke their tools as checkpointed activities. If the process crashes between the call and the checkpoint, it replays from cache — the MCP server isn't called twice. You get exactly-once semantics over a protocol that doesn't natively guarantee them.

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import { McpClient } from '@hotmeshio/long-tail';

// Get tool functions from a registered MCP server
const tools = await McpClient.toolActivities(serverId);
const { mcp_analyzer_classify } = Durable.workflow.proxyActivities<typeof tools>({
  activities: tools,
});

export async function classifyDocument(envelope: LTEnvelope) {
  // This MCP tool call is now durable — checkpointed, retried, audited
  const result = await mcp_analyzer_classify({ content: envelope.data.content });

  if (result.confidence >= 0.85) {
    return { type: 'return', data: result };
  }
  return { type: 'escalation', data: result, message: 'Low confidence', role: 'reviewer' };
}
```

### Humans as an MCP Server

Long Tail exposes its escalation queue as an MCP server. Any MCP-aware agent — LangGraph, CrewAI, raw API calls — can route work to humans through the same protocol it uses to call any other tool.

```
MCP Server: "long-tail-human-queue"

Tools:
  - escalate_to_human(role, message, data)   → escalation_id
  - check_resolution(escalation_id)          → resolved | pending
  - get_available_work(role)                 → escalation[]
  - claim_and_resolve(escalation_id, payload) → result
```

An AI agent working the queue looks like this:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport); // stdio, SSE, or in-memory

// Check the queue
const work = await client.callTool({
  name: 'get_available_work',
  arguments: { role: 'reviewer' },
});

// Claim and resolve
await client.callTool({
  name: 'claim_and_resolve',
  arguments: {
    escalation_id: 'esc-abc123',
    resolver_id: 'my-agent',
    payload: { approved: true, note: 'Verified by automated review' },
  },
});
```

Human labor — and AI labor — becomes composable across the entire MCP ecosystem. Long Tail handles the durable wait, the routing, the claim/release lifecycle, and the audit trail. The protocol is the same whether the resolver is a human clicking a button or an agent calling a tool.

### Managing MCP Servers

Register, connect, and manage MCP servers via the REST API:

```
POST /api/mcp/servers
{
  "name": "doc-analyzer",
  "transport_type": "stdio",
  "transport_config": { "command": "npx", "args": ["-y", "doc-analyzer-mcp"] },
  "auto_connect": true
}
```

Or configure at startup:

```typescript
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  mcp: {
    server: { enabled: true },
  },
});
```

## Pluggable Architecture

Long Tail separates concerns through adapter registries. Each cross-cutting capability — authentication, event publishing, telemetry, logging, database maintenance — follows the same contract: implement a typed interface, register at startup, done.

No capability requires configuration unless you want it. Auth ships with a working JWT adapter. Maintenance ships with a default nightly schedule. Telemetry, events, and logging are opt-in: register nothing and they do nothing.

The fastest way to configure adapters is through the `start()` config:

```typescript
await start({
  database: {
    connectionString: process.env.DATABASE_URL,
  },
  workers: [ ... ],
  auth: {
    secret: process.env.JWT_SECRET,
  },
  telemetry: {
    honeycomb: { apiKey: process.env.HONEYCOMB_API_KEY },
  },
  events: {
    nats: { url: 'nats://localhost:4222' },
  },
  logging: {
    pino: { level: 'info' },
  },
  mcp: {
    server: { enabled: true },
  },
  escalation: {
    strategy: 'mcp',  // 'default' | 'mcp' | custom adapter
  },
  maintenance: {
    schedule: '0 3 * * *',
    rules: [
      { target: 'streams', olderThan: '24 hours', action: 'delete' },
      { target: 'jobs', olderThan: '14 days', action: 'delete', hasEntity: false },
      { target: 'jobs', olderThan: '14 days', action: 'prune', hasEntity: true },
      { target: 'jobs', olderThan: '180 days', action: 'delete', pruned: true },
    ],
  },
});
```

Every adapter can also be registered programmatically for advanced use cases (custom adapters, conditional logic). See the detailed docs for each:

- **[Auth](docs/auth.md)** — JWT (built-in), OAuth, API keys, or any custom `LTAuthAdapter`
- **[Events](docs/events.md)** — NATS (built-in), SNS, Kafka, webhooks, or any custom `LTEventAdapter`
- **[Telemetry](docs/telemetry.md)** — Honeycomb (built-in), Datadog, or any OTLP backend via `LTTelemetryAdapter`
- **[Logging](docs/logging.md)** — Pino (built-in), Winston, or any custom `LTLoggerAdapter`
- **[MCP](docs/mcp.md)** — Register MCP servers as durable tool providers, expose Long Tail's escalation queue as an MCP server
- **[Maintenance](docs/maintenance.md)** — Scheduled cleanup with prune/delete rules, runtime API
- **[Escalation Strategies](docs/escalation-strategies.md)** — Default (deterministic re-run), MCP (dynamic triage with tool-based remediation), or custom `LTEscalationStrategy`

## Execution History Export

Every workflow's full execution history can be exported in a Temporal-compatible format — typed events (`workflow_execution_started`, `activity_task_scheduled`, `activity_task_completed`, etc.) with ISO timestamps, durations, and event cross-references.

```
GET /api/workflow-states/:workflowId/execution
```

Options:
- `excludeSystem=true` — omit interceptor activities (lt*)
- `omitResults=true` — strip result payloads
- `mode=verbose` — include nested child workflow executions
- `maxDepth=N` — recursion limit for verbose mode (default: 5)

Programmatic access:

```typescript
const client = new Durable.Client({ connection });
const handle = await client.workflow.getHandle(taskQueue, workflowName, workflowId);
const execution = await handle.exportExecution({ exclude_system: true });
```

## How It Works

Long Tail is built on [HotMesh](https://github.com/hotmeshio/sdk-typescript), a workflow engine that delivers Temporal-style durable execution using PostgreSQL. Workflow state is transactionally checkpointed — crashes, deploys, restarts, the workflow resumes from its last checkpoint. Activities execute exactly once; their results are cached and replayed on recovery. Workflows can pause and wait for external signals (like a human resolving an escalation), then resume with the signal payload.

The LT interceptor adds the human-in-the-loop layer: task tracking, escalation management, claim/release with expiration, milestone recording, and audit trails. All stored in Postgres alongside the workflow state.

```
┌─────────────────────────────────────────────────────────┐
│                    Your Workflow Code                   │
│                                                         │
│   envelope ──► AI Processing ──► return (confident)     │
│                      │                                  │
│                      └──► escalation (not confident)    │
└────────────────────────────┬────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  LT Interceptor │
                    │                 │
                    │  • Task records │
                    │  • Escalations  │
                    │  • Signal/Wait  │
                    │  • Milestones   │
                    └────────┬────────┘
                             │
                        ┌────▼─────┐
                        │ Postgres │
                        │          │
                        │ • State  │
                        │ • Tasks  │
                        │ • Queue  │
                        │ • Audit  │
                        └──────────┘
```

## API Reference

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/:type/invoke` | Invoke a workflow (requires `invocable: true`) |
| `GET` | `/api/workflows/:id/status` | Get workflow execution status |
| `GET` | `/api/workflows/:id/result` | Get workflow result (200 if complete, 202 if running) |
| `GET` | `/api/workflows/:id/export` | Export full execution history |
| `GET` | `/api/workflows/config` | List all workflow configurations |
| `GET` | `/api/workflows/:type/config` | Get a workflow's configuration |
| `PUT` | `/api/workflows/:type/config` | Create or replace a workflow configuration |
| `DELETE` | `/api/workflows/:type/config` | Delete a workflow configuration |

### Workflow States (Export)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflow-states/:id` | Raw workflow state export (allow/block facet filters) |
| `GET` | `/api/workflow-states/:id/execution` | Temporal-compatible execution history |
| `GET` | `/api/workflow-states/:id/status` | Workflow status semaphore |
| `GET` | `/api/workflow-states/:id/state` | Current workflow state |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks (filter by `status`, `lt_type`, `workflow_type`) |
| `GET` | `/api/tasks/:id` | Get task details |

### Escalations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/escalations` | List escalations (filter by `status`, `role`, `type`) |
| `GET` | `/api/escalations/available` | Available escalations (pending + unassigned/expired) |
| `GET` | `/api/escalations/:id` | Get escalation details |
| `POST` | `/api/escalations/:id/claim` | Claim an escalation (time-boxed lock) |
| `POST` | `/api/escalations/:id/resolve` | Resolve — resumes the paused workflow |
| `POST` | `/api/escalations/release-expired` | Release expired claims back to the queue |

### Users

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List users (filter by `role`, `status`) |
| `GET` | `/api/users/:id` | Get user details |
| `POST` | `/api/users` | Create user with roles |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user |

### Roles

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users/:id/roles` | List roles for a user |
| `POST` | `/api/users/:id/roles` | Add role to user |
| `DELETE` | `/api/users/:id/roles/:role` | Remove role from user |

### MCP

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp/servers` | List registered MCP servers |
| `POST` | `/api/mcp/servers` | Register a new MCP server |
| `GET` | `/api/mcp/servers/:id` | Get MCP server details |
| `PUT` | `/api/mcp/servers/:id` | Update MCP server registration |
| `DELETE` | `/api/mcp/servers/:id` | Delete MCP server registration |
| `POST` | `/api/mcp/servers/:id/connect` | Connect to an MCP server |
| `POST` | `/api/mcp/servers/:id/disconnect` | Disconnect from an MCP server |
| `GET` | `/api/mcp/servers/:id/tools` | List tools on a connected server |
| `POST` | `/api/mcp/servers/:id/tools/:tool/call` | Call a tool on a connected server |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/api/config/maintenance` | Set the maintenance schedule and rules |
| `GET` | `/api/config/maintenance` | Get the current maintenance configuration |
| `POST` | `/api/dba/prune` | Run maintenance rules on demand |
| `POST` | `/api/dba/deploy` | Deploy server-side prune function |

## Deployment

In production, run two container types from the same codebase — one serves the API, the other executes workflows:

```typescript
// api.ts — serves REST endpoints, no workflow execution
await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { secret: process.env.JWT_SECRET },
});
```

```typescript
// worker.ts — executes workflows, no HTTP server
await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  workers: [
    { taskQueue: 'long-tail', workflow: reviewContent.reviewContent },
  ],
});
```

Both tiers share the same PostgreSQL database and scale independently. See [Cloud Deployment](docs/cloud.md) for AWS ECS, GCP Cloud Run, and Docker configurations.

## License

See [LICENSE](LICENSE).
