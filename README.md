# Long Tail

**The model provides capability. The process provides reliability.**

Business workflows can’t simply be handed to an LLM and left to chance. Approval chains, compliance checks, document review, and data validation exist because the cost of being wrong is real. The practical approach is simple: let AI handle what it’s confident about, and route the rest to whatever can resolve it next.

That remainder is the *long tail*.

When the AI isn’t confident, the task escalates to a human. When the human can’t resolve it either — a corrupted image, an upside-down scan, a document in the wrong language — the problem escalates back. An AI triage agent uses MCP tools to diagnose, repair, and retry the step.

Once the issue is resolved, the sequence of actions is compiled into a deterministic workflow. The next time the same edge case appears, it runs automatically.

AI handles the routine. Humans catch the ambiguity. The system absorbs the exception, adapts and moves on.

```
                    ┌────────────────────────────────────────┐
                    │      Deterministic Flow                │
                    │                                        │
  input ──────────► │  AI confident? ── yes ──► done         |
                    │       │                                │
                    │       no                               │
                    │       ▼                                │
                    │   escalate to human                    │
                    │       │                                │
                    │       ▼                                │
                    │  human confident? ── yes ──► done      │
                    │       │                                │
                    │       no                               │
                    │       ▼                                │
                    │   escalate back to AI                  │
                    │   (MCP triage + tools)                 │
                    │       │                                │
                    │       ▼                                │
                    │  fix applied, flow retried             │
                    │       │                                │
                    │       ▼                                │
                    │  compile to YAML workflow ──► hardened │
                    └────────────────────────────────────────┘
```

## Quick Start

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000) once the container is healthy (~10 seconds). Four workflows run on startup to populate the dashboard.

| User | Password | Role |
|------|----------|------|
| `superadmin` | `superadmin123` | superadmin |
| `admin` | `admin123` | admin |
| `engineer` | `engineer123` | engineer |
| `reviewer` | `reviewer123` | reviewer |

**What you'll see seeded:**

1. **Clean Review** — AI auto-approves high-quality content. Happy path, no escalation.
2. **Flagged for Review** — AI flags content for human review. Log in as `reviewer` to approve or reject.
3. **Wrong Language** — Content arrives in Spanish. Walk the escalation chain: reviewer to admin to engineer, who triggers MCP triage. The AI translates the content, re-runs the workflow, and recommends adding language detection.
4. **Damaged Claim** — Insurance claim with an upside-down document scan. AI Vision detects the issue. As `reviewer`, request AI triage. The MCP agent rotates the page, re-extracts member info, and re-runs the claim.

To reset: `docker compose down -v && docker compose up -d --build`

> **Local development** — Run tests or start the server outside Docker: `npm install`

## Contents

- [Write a Workflow](#write-a-workflow)
- [What Happens When AI Isn't Confident](#what-happens-when-ai-isnt-confident)
- [What Happens When the Human Isn't Either](#what-happens-when-the-human-isnt-either)
- [Hardening the Edge](#hardening-the-edge)
- [Composing Workflows](#composing-workflows)
- [MCP Integration](#mcp-integration) — [Durable Tool Calls](#mcp-tool-calls-as-durable-activities) · [Humans as MCP](#humans-as-an-mcp-server) · [Compiled Workflows as MCP](#compiled-workflows-as-mcp-tools) · [Workflow Compiler](#workflow-compiler)
- [Pluggable Architecture](#pluggable-architecture) — [Auth](docs/auth.md) · [Events](docs/events.md) · [Telemetry](docs/telemetry.md) · [Logging](docs/logging.md) · [MCP](docs/mcp.md) · [Maintenance](docs/maintenance.md) · [Escalation Strategies](docs/escalation-strategies.md)
- [Invoking Workflows](#invoking-workflows)
- [Execution History Export](#execution-history-export)
- [How It Works](#how-it-works)
- [API Reference](#api-reference) — [Workflows](docs/api/workflows.md) · [Tasks](docs/api/tasks.md) · [Escalations](docs/api/escalations.md) · [Users](docs/api/users.md) · [Roles](docs/api/roles.md) · [Maintenance](docs/api/maintenance.md) · [DBA](docs/api/dba.md) · [Exports](docs/api/exports.md)
- [Milestones](#milestones)
- [Roles](#roles)
- [Deployment](#deployment) — [Cloud Deployment](docs/cloud.md)
- [Data Model](docs/data.md)
- [Contributing](docs/contributing.md)

## Install

```bash
npm install @hotmeshio/long-tail @hotmeshio/hotmesh
```

## Write a Workflow

A workflow is a function. It receives an envelope, does work, and returns a result or an escalation.

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
  // Re-entry after human resolution — return the resolver's decision
  if (envelope.resolver) {
    return {
      type: 'return',
      data: { ...envelope.data, resolution: envelope.resolver },
    };
  }

  const analysis = await analyzeContent(envelope.data.content);

  if (analysis.confidence >= 0.85) {
    return { type: 'return', data: { approved: true, analysis } };
  }

  // Not confident — escalate to a human
  return {
    type: 'escalation',
    data: { content: envelope.data.content, analysis },
    message: `Review needed (confidence: ${analysis.confidence})`,
    role: 'reviewer',
  };
}
```

Activities are where side effects live — API calls, LLMs, database reads. They run outside the deterministic sandbox, are retried on failure, and checkpointed. If the process crashes mid-workflow, it replays from the last checkpoint.

```typescript
// activities.ts
export async function analyzeContent(content: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `Analyze this content: ${content}` }],
  });
  return parseResponse(response);
}
```

Register the workflow and start:

```typescript
import { start } from '@hotmeshio/long-tail';
import * as myWorkflow from './workflows/my-workflow';

const lt = await start({
  database: {
    host: 'localhost', port: 5432,
    user: 'postgres', password: 'password', database: 'mydb',
  },
  workers: [{ taskQueue: 'my-queue', workflow: myWorkflow.reviewContent }],
});
```

That's it. Migrations run, workers start, the API server listens, and maintenance is scheduled. The only infrastructure is PostgreSQL.

```typescript
// Start a workflow
const handle = await lt.client.workflow.start({
  args: [{ data: { content: 'Review this' }, metadata: {} }],
  taskQueue: 'my-queue',
  workflowName: 'reviewContent',
  workflowId: `review-${Date.now()}`,
});

const result = await handle.result();
```

## What Happens When AI Isn't Confident

Two outcomes when `reviewContent` runs:

- **Confident** — the task completes. A record lands in `lt_tasks` with the result.
- **Not confident** — the workflow returns an escalation. The interceptor creates a record with full context in `lt_escalations` — what the AI tried, what it saw, why it wasn't sure. The workflow ends cleanly. No long-running poll.

A reviewer pulls their queue:

```
GET /api/escalations/available?role=reviewer
```

Claims the work (time-boxed — if they don't finish, it goes back):

```
POST /api/escalations/esc-abc123/claim
{ "durationMinutes": 30 }
```

Resolves it:

```
POST /api/escalations/esc-abc123/resolve
{ "resolverPayload": { "approved": true, "notes": "Content is fine" } }
```

This restarts the workflow with `envelope.resolver` populated. The `if (envelope.resolver)` branch executes, the resolver's decision becomes the final result, and the task completes. The deterministic path resumes as if nothing went wrong.

## What Happens When the Human Isn't Either

Sometimes the reviewer *can't* produce the correct answer. An upside-down page. A corrupted scan. A document in the wrong language. They know what's wrong but can't fix it themselves — they need the system to fix it and retry.

The resolver flags `needsTriage` with a hint — say, `image_orientation`. Long Tail's MCP triage interceptor takes over:

1. Queries upstream tasks and escalation history for full context
2. Reads the hint to understand what remediation is needed
3. Starts an LLM-driven agentic loop with MCP tools (rotate pages, translate content, re-extract data, validate against databases)
4. Returns corrected data to the orchestrator
5. The orchestrator re-invokes the original workflow with fixed inputs

```
Claim pipeline ──► AI extracts data ──► low confidence ──► escalate
                                                              │
                                         reviewer: "page is upside down"
                                                              │
                                         MCP triage agent ──► Vision tools
                                              │
                                         rotate page, re-extract, validate
                                              │
                                         re-invoke original workflow
                                              │
                                         extraction succeeds ◄──
```

The triage workflow is itself durable. Every MCP tool call is checkpointed. If the LLM can't fix it either, it escalates to an engineer with a full diagnosis — what it tried, what it found, what it recommends. The engineer provides guidance, the triage re-runs with that context, and applies the guided fix.

This is the loop: AI catches what humans miss. Humans catch what AI misses. Each escalation carries full context. Nothing is lost.

## Hardening the Edge

Here's what makes the loop tighten over time.

Every MCP triage execution produces a rich event history — which tools were called, in what order, with what arguments, producing what results. That history is a *recording* of how a particular edge case was solved.

Long Tail's workflow compiler converts that recording into a deterministic YAML workflow:

```
MCP triage execution (dynamic, LLM-driven)
  │
  │  rotate_page(page1, 180°) → page1_rotated.png
  │  extract_member_info(page1_rotated.png) → { name, id, ... }
  │  validate_member({ name, id }) → { verified: true }
  │
  ▼
Deterministic YAML workflow (no LLM, direct tool piping)
  │
  │  step 1: rotate_page → step 2: extract_member_info → step 3: validate_member
  │
  ▼
Deploy and activate
```

The generated workflow replaces LLM reasoning with direct tool-to-tool data piping. No inference calls, no token costs, no latency from model reasoning. The same fix that once required an agentic loop now runs as a deterministic pipeline.

The compiler is itself an MCP server with three tools:

| Tool | What it does |
|------|-------------|
| `convert_execution_to_yaml` | Analyze a completed execution, extract the tool sequence, generate a YAML workflow, store as draft |
| `deploy_yaml_workflow` | Deploy the YAML to HotMesh, optionally activate and register workers |
| `list_yaml_workflows` | List stored YAML workflows with status and metadata |

This means an AI agent can observe its own triage executions, compile the successful ones into deterministic flows, and deploy them — closing the loop without human intervention. The long tail gets shorter every time.

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

Children that share an `originId` can read each other's completed data automatically. Declare what a workflow [`consumes`](docs/api/workflows.md#create-or-replace-a-workflow-configuration) in its config, and Long Tail injects sibling results into `envelope.lt.providers` at runtime.

## MCP Integration

MCP is the shared language. AI tools, human escalation, and workflow compilation all speak the same protocol with the same durability guarantees.

### MCP Tool Calls as Durable Activities

Register external MCP servers and invoke their tools as checkpointed activities. If the process crashes between the call and the checkpoint, it replays from cache — the MCP server isn't called twice. Exactly-once semantics over a protocol that doesn't natively guarantee them.

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import { McpClient } from '@hotmeshio/long-tail';

const tools = await McpClient.toolActivities(serverId);
const { mcp_analyzer_classify } = Durable.workflow.proxyActivities<typeof tools>({
  activities: tools,
});

export async function classifyDocument(envelope: LTEnvelope) {
  const result = await mcp_analyzer_classify({ content: envelope.data.content });

  if (result.confidence >= 0.85) {
    return { type: 'return', data: result };
  }
  return { type: 'escalation', data: result, message: 'Low confidence', role: 'reviewer' };
}
```

### Humans as an MCP Server

Long Tail exposes its escalation queue as an MCP server. Any MCP-aware agent can route work to humans through the same protocol it uses to call any other tool.

```
MCP Server: "long-tail-human-queue"

Tools:
  - escalate_to_human(role, message, data)   → escalation_id
  - check_resolution(escalation_id)          → resolved | pending
  - get_available_work(role)                 → escalation[]
  - claim_and_resolve(escalation_id, payload) → result
```

An AI agent working the queue:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);

const work = await client.callTool({
  name: 'get_available_work',
  arguments: { role: 'reviewer' },
});

await client.callTool({
  name: 'claim_and_resolve',
  arguments: {
    escalation_id: 'esc-abc123',
    resolver_id: 'my-agent',
    payload: { approved: true, note: 'Verified by automated review' },
  },
});
```

Human labor and AI labor become composable across the entire MCP ecosystem. The protocol is the same whether the resolver is a human clicking a button or an agent calling a tool.

### Compiled Workflows as MCP Tools

Once a triage execution is compiled and deployed, it becomes a tool on the `long-tail-mcp-workflows` MCP server. Any MCP-aware agent can discover and invoke these hardened pipelines:

```
MCP Server: "long-tail-mcp-workflows"

Tools:
  - list_workflows()                              → available compiled workflows
  - get_workflow(workflow_name)                    → schema, manifest, provenance
  - invoke_workflow(workflow_name, input, async?)  → result or job_id
```

An agent encountering a familiar edge case can check for a compiled solution before falling back to dynamic triage:

```typescript
// Does a hardened workflow exist for this type of failure?
const available = await client.callTool({
  name: 'list_workflows',
  arguments: { status: 'active' },
});

// If so, invoke the deterministic pipeline — no LLM needed
await client.callTool({
  name: 'invoke_workflow',
  arguments: {
    workflow_name: 'rotate-and-extract',
    input: { document: 'page1_upside_down.png', rotation: 180 },
  },
});
```

All three built-in MCP servers — `long-tail-human-queue`, `long-tail-mcp-workflows`, and `long-tail-workflow-compiler` — are started automatically and appear in the dashboard alongside user-registered servers.

### Workflow Compiler

The workflow compiler MCP server converts dynamic MCP tool call sequences into deterministic YAML workflows. See [Hardening the Edge](#hardening-the-edge) for the full story.

### Managing MCP Servers

Register, connect, and manage MCP servers via the REST API or at startup:

```typescript
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  mcp: { server: { enabled: true } },
});
```

See [docs/mcp.md](docs/mcp.md) for the full guide.

## Pluggable Architecture

Every cross-cutting concern — auth, events, telemetry, logging, maintenance — follows the same pattern: implement a typed interface, register at startup, done. Nothing requires configuration unless you want it.

```typescript
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  auth: { secret: process.env.JWT_SECRET },
  telemetry: { honeycomb: { apiKey: process.env.HONEYCOMB_API_KEY } },
  events: { nats: { url: 'nats://localhost:4222' } },
  logging: { pino: { level: 'info' } },
  mcp: { server: { enabled: true } },
  escalation: { strategy: 'mcp' },
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

Every adapter can also be registered programmatically for advanced use cases. See the detailed docs:

- **[Auth](docs/auth.md)** — JWT (built-in), OAuth, API keys, or any custom `LTAuthAdapter`
- **[Events](docs/events.md)** — NATS (built-in), SNS, Kafka, webhooks, or any custom `LTEventAdapter`
- **[Telemetry](docs/telemetry.md)** — Honeycomb (built-in), Datadog, or any OTLP backend via `LTTelemetryAdapter`
- **[Logging](docs/logging.md)** — Pino (built-in), Winston, or any custom `LTLoggerAdapter`
- **[MCP](docs/mcp.md)** — Register MCP servers as durable tool providers, expose escalation as an MCP server
- **[Maintenance](docs/maintenance.md)** — Scheduled cleanup with prune/delete rules, runtime API
- **[Escalation Strategies](docs/escalation-strategies.md)** — Default (deterministic re-run), MCP (dynamic triage), or custom `LTEscalationStrategy`

## Invoking Workflows

Any registered workflow can be invoked via the public API. Set `invocable: true` in the [workflow config](docs/api/workflows.md#create-or-replace-a-workflow-configuration) and optionally restrict with `invocation_roles`:

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

```
POST /api/workflows/reviewContent/invoke
{ "data": { "contentId": "doc-42", "content": "Review this document" } }
```

When `invocation_roles` is empty, any authenticated user can invoke. When set, the user must hold at least one matching role. Superadmins always bypass. See the full [invocation API](docs/api/workflows.md#invocation).

## Milestones

Structured markers that workflows emit at decision points. Persisted on the task record and published to event adapters (NATS, SNS, Kafka, webhooks) so external systems can react in real time.

```typescript
return {
  type: 'return',
  data: { approved: true },
  milestones: [{ name: 'ai_review', value: 'approved' }],
};
```

When a human resolves an escalation, the interceptor automatically appends `escalated` and `resolved_by_human` milestones.

## Roles

Roles connect workflows to people. When a workflow escalates to the `reviewer` role, every user assigned that role sees it in their queue. Roles are implicit — they exist the moment you reference them.

| Type | Permissions |
|------|-------------|
| `member` | Claim and resolve escalations for this role |
| `admin` | Member permissions + manage users within this role |
| `superadmin` | Full access — all roles, all users, system config |

A user can hold multiple roles with different types. See [Users](docs/api/users.md) and [Roles](docs/api/roles.md).

## Execution History Export

Every workflow's full execution history can be exported in a Temporal-compatible format — typed events with ISO timestamps, durations, and event cross-references.

```
GET /api/workflow-states/:workflowId/execution
```

Options: `excludeSystem=true`, `omitResults=true`, `mode=verbose`, `maxDepth=N`

```typescript
const handle = await client.workflow.getHandle(taskQueue, workflowName, workflowId);
const execution = await handle.exportExecution({ exclude_system: true });
```

## How It Works

Long Tail is built on [HotMesh](https://github.com/hotmeshio/sdk-typescript), a workflow engine that delivers Temporal-style durable execution using PostgreSQL. Workflow state is transactionally checkpointed. Activities execute exactly once. Workflows can pause and wait for external signals, then resume with the signal payload.

The LT interceptor adds the human-in-the-loop layer: task tracking, escalation management, claim/release with expiration, milestone recording, and audit trails. All stored in Postgres alongside the workflow state.

- **Postgres-only** — state, queues, escalations, audit trails, compiled workflows
- **Durable execution** — survives crashes, deploys, restarts
- **MCP-native** — AI tools, human escalation, and workflow compilation on the same protocol
- **Pluggable** — auth, events, telemetry, logging, maintenance; ship defaults or wire your own

```
┌─────────────────────────────────────────────────────────┐
│                    Your Workflow Code                    │
│                                                         │
│   envelope ──► AI Processing ──► return (confident)     │
│                      │                                  │
│                      └──► escalation (not confident)    │
│                                    │                    │
│                      ┌─────────────┘                    │
│                      ▼                                  │
│               Human resolves ──► re-run ──► done        │
│                      │                                  │
│               Human can't fix ──► MCP triage            │
│                      │                                  │
│               Tools fix it ──► re-run ──► done          │
│                      │                                  │
│               Compile to YAML ──► deploy ──► hardened   │
└─────────────────────────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  LT Interceptor │
              │  • Task records │
              │  • Escalations  │
              │  • Signal/Wait  │
              │  • Milestones   │
              └────────┬────────┘
                       │
                  ┌────▼─────┐
                  │ Postgres │
                  └──────────┘
```

## API Reference

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/:type/invoke` | Invoke a workflow |
| `GET` | `/api/workflows/:id/status` | Execution status |
| `GET` | `/api/workflows/:id/result` | Result (200 if complete, 202 if running) |
| `GET` | `/api/workflows/:id/export` | Full execution history |
| `GET` | `/api/workflows/config` | List all configurations |
| `GET` | `/api/workflows/:type/config` | Get configuration |
| `PUT` | `/api/workflows/:type/config` | Create or replace configuration |
| `DELETE` | `/api/workflows/:type/config` | Delete configuration |

### Workflow States (Export)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflow-states/:id` | Raw state export |
| `GET` | `/api/workflow-states/:id/execution` | Temporal-compatible execution history |
| `GET` | `/api/workflow-states/:id/status` | Status semaphore |
| `GET` | `/api/workflow-states/:id/state` | Current state |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks |
| `GET` | `/api/tasks/:id` | Task details |

### Escalations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/escalations` | List escalations |
| `GET` | `/api/escalations/available` | Available (pending + unassigned/expired) |
| `GET` | `/api/escalations/:id` | Escalation details |
| `POST` | `/api/escalations/:id/claim` | Claim (time-boxed lock) |
| `POST` | `/api/escalations/:id/resolve` | Resolve — resumes the workflow |
| `POST` | `/api/escalations/release-expired` | Release expired claims |

### Users & Roles

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create user |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user |
| `GET` | `/api/users/:id/roles` | List roles |
| `POST` | `/api/users/:id/roles` | Add role |
| `DELETE` | `/api/users/:id/roles/:role` | Remove role |

### MCP

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp/servers` | List registered servers |
| `POST` | `/api/mcp/servers` | Register server |
| `GET` | `/api/mcp/servers/:id` | Server details |
| `PUT` | `/api/mcp/servers/:id` | Update server |
| `DELETE` | `/api/mcp/servers/:id` | Delete server |
| `POST` | `/api/mcp/servers/:id/connect` | Connect |
| `POST` | `/api/mcp/servers/:id/disconnect` | Disconnect |
| `GET` | `/api/mcp/servers/:id/tools` | List tools |
| `POST` | `/api/mcp/servers/:id/tools/:tool/call` | Call tool |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/api/config/maintenance` | Set schedule and rules |
| `GET` | `/api/config/maintenance` | Get configuration |
| `POST` | `/api/dba/prune` | Run on demand |
| `POST` | `/api/dba/deploy` | Deploy prune function |

## Deployment

In production, run two container types from the same codebase — one serves the API, the other executes workflows:

```typescript
// api.ts — REST endpoints, no workflow execution
await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { secret: process.env.JWT_SECRET },
});

// worker.ts — workflow execution, no HTTP server
await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  workers: [{ taskQueue: 'long-tail', workflow: reviewContent.reviewContent }],
});
```

Both tiers share the same PostgreSQL database and scale independently. See [Cloud Deployment](docs/cloud.md) for AWS ECS, GCP Cloud Run, and Docker configurations.

## License

See [LICENSE](LICENSE).
