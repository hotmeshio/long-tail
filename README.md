# Long Tail

*AI and humans, working the same queue.*

Your team already has processes. Policies. People. AI doesn't replace that — it joins the team. Long Tail is the workflow engine that makes this real: durable, transactional workflows where AI handles the routine work, and everything it can't handle flows to the right person (or the right AI) automatically.

No work is dropped. No state is lost. Every task is tracked from start to finish. And the only infrastructure you need is PostgreSQL.

- **Postgres-only** — state, queues, escalations, and audit trails in one database
- **Durable execution** — workflows survive crashes, deploys, and restarts via transactional checkpointing
- **Pluggable everything** — auth, events, telemetry, logging, and maintenance are adapter-based; ship defaults or wire your own

## Why This Matters

The hard part of adopting AI isn't the model. It's the process around the model.

Every enterprise has business processes — approval chains, compliance checks, document reviews, data validation. These processes exist for good reasons: regulatory requirements, quality standards, institutional knowledge. You can't hand them to an LLM and hope for the best.

The realistic path is BPM-first: start AI on the granular, well-defined tasks where confidence is measurable. Content classification. Data extraction. Document validation. Let the existing workforce handle the judgment calls — the ambiguous, high-stakes, long-tail work that requires human context. Then evolve the boundary over time as trust is earned and models improve.

Long Tail gives you the machinery to do this. Write a workflow. If AI is confident, the work completes. If not, it escalates — durably, transactionally, with full context — to whoever should handle it next.

### Who Resolves Escalations?

Anyone. That's the point.

The escalation queue is an API. Who consumes it is a deployment decision, not an architectural one:

- **A human team** using a purpose-built SPA — your HITL reviewers triaging a queue of AI-flagged items
- **Another AI agent** consuming from the same API with its own RBAC role — a more capable model, a specialized system, a domain-specific pipeline
- **A hybrid** — AI does a first pass on the escalation, then routes to a human for final sign-off

And it works in the other direction too. A workflow can call out to a human team, then use AI to validate what comes back. The system doesn't care who's on either end. It cares that the work gets done, the state is consistent, and the audit trail is complete.

This is the sociotechnical shape of AI in the enterprise: not AI *or* humans, but AI *alongside* humans, as team members with different roles and capabilities. In regulated industries where policy is immutable, this isn't optional — it's the only way forward.

## Contents

- [Install](#install)
- [Connect and Start Workers](#connect-and-start-workers)
- [Write a Workflow](#write-a-workflow)
- [What Happens When It Runs](#what-happens-when-it-runs)
- [The Human Side](#the-human-side)
- [Composing Workflows](#composing-workflows)
- [Milestones](#milestones)
- [Roles](#roles)
- [Invoking Workflows](#invoking-workflows)
- [Pluggable Architecture](#pluggable-architecture) — [Auth](docs/auth.md) · [Events](docs/events.md) · [Telemetry](docs/telemetry.md) · [Logging](docs/logging.md) · [Maintenance](docs/maintenance.md)
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

Long Tail embeds its own server, runs migrations, starts workers, and manages all cross-cutting concerns. Pass a config object to `start()` and everything is handled:

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
- **[Maintenance](docs/maintenance.md)** — Scheduled cleanup with prune/delete rules, runtime API

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

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/api/config/maintenance` | Set the maintenance schedule and rules |
| `GET` | `/api/config/maintenance` | Get the current maintenance configuration |
| `POST` | `/api/dba/prune` | Run maintenance rules on demand |
| `POST` | `/api/dba/deploy` | Deploy server-side prune function and run migrations |

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
