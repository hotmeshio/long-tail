# Long Tail

**AI and humans, working the same queue.**

Long Tail is a workflow engine where AI handles the routine work and everything it can't handle flows to the right person automatically. The only infrastructure you need is PostgreSQL.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

### Run

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up
```

Postgres, NATS, and the API server start together. Migrations run automatically.

Default ports are `3000` (API), `5432` (Postgres), `4222`/`8222` (NATS). Override any of them:

```bash
LT_PORT=3001 LT_PG_PORT=5433 LT_NATS_PORT=4223 docker compose up
```

## Writing a Workflow

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

That's the whole workflow. Activities are where side effects live — API calls, LLMs, database reads. They run outside the deterministic sandbox so they can do I/O:

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
  "roles": ["reviewer"]
}
```

`is_lt: true` turns on the interceptor for this workflow. `default_role` and `roles` control who gets the escalation when the AI isn't confident enough to decide on its own.

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

Children that share an `originId` can read each other's completed data automatically. Instead of manually passing results through the envelope, you declare what a workflow consumes in its config:

```
PUT /api/workflows/validateExtraction/config

{
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer"],
  "consumes": ["extractDocument"]
}
```

When `validateExtraction` runs, Long Tail looks up the completed `extractDocument` task for the same `originId` and injects its result into `envelope.lt.providers.extractDocument`. The child workflow gets the data it needs without the orchestrator having to thread it through.

## Roles

Roles connect workflows to people. When a workflow escalates to the `reviewer` role, every user assigned that role sees it in their queue. Roles are implicit — they exist the moment you reference them. There's no separate "create role" step.

A role appears in two places: the workflow config (who should handle escalations) and the user record (who is available to handle them).

### Assigning roles to workflows

When you register a workflow, `default_role` sets the primary escalation target and `roles` lists every role allowed to claim escalations for this workflow:

```
PUT /api/workflows/reviewContent/config

{
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer", "senior-reviewer"]
}
```

When `reviewContent` escalates, the escalation targets `reviewer` by default. Users with either `reviewer` or `senior-reviewer` can claim it.

### Assigning roles to users

Create a user with roles up front, or add roles later:

```
POST /api/users

{
  "external_id": "jane",
  "email": "jane@acme.com",
  "roles": [
    { "role": "reviewer", "type": "member" },
    { "role": "senior-reviewer", "type": "admin" }
  ]
}
```

```
POST /api/users/:id/roles

{ "role": "reviewer", "type": "member" }
```

### Role types

Every role assignment has a `type` that controls what the user can manage — not what they can see. All three types can claim and resolve escalations for their role.

| Type | Permissions |
|------|-------------|
| `member` | Claim and resolve escalations for this role |
| `admin` | Everything a member can do, plus manage users within this role |
| `superadmin` | Full access — manage all roles, all users, system configuration |

A user can hold multiple roles with different types. For example, Jane might be a `member` of `reviewer` and an `admin` of `senior-reviewer` — she can claim escalations for both, but only manage the senior reviewer team.

## Pluggable Services

Postgres is the only hard dependency. Everything else — telemetry, events, auth, maintenance — is pluggable. Each follows the same pattern: register an adapter or config, and Long Tail handles the rest. Ship with the defaults or wire in your own.

### Telemetry

Register a telemetry adapter before starting workers. The adapter configures an OpenTelemetry `TracerProvider`; workflow spans are then exported to whatever backend you choose.

```typescript
import { telemetryRegistry, HoneycombTelemetryAdapter } from '@hotmeshio/long-tail';

telemetryRegistry.register(new HoneycombTelemetryAdapter({
  apiKey: process.env.HONEYCOMB_API_KEY,
  serviceName: 'my-app',
}));
```

Write your own by implementing `LTTelemetryAdapter` (`connect` / `disconnect`):

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { LTTelemetryAdapter } from '@hotmeshio/long-tail';

class DatadogAdapter implements LTTelemetryAdapter {
  private sdk: NodeSDK | null = null;

  async connect() {
    this.sdk = new NodeSDK({ /* Datadog exporter config */ });
    this.sdk.start();
  }
  async disconnect() {
    await this.sdk?.shutdown();
  }
}

telemetryRegistry.register(new DatadogAdapter());
```

Set `HMSH_TELEMETRY` to control span verbosity (`info` for triggers/workers/errors, `debug` for every activity).

### Events

Milestone events follow the same pattern. Register one or more event adapters and workflow milestones are published as they occur:

```typescript
import { eventRegistry, NatsEventAdapter } from '@hotmeshio/long-tail';

eventRegistry.register(new NatsEventAdapter({ servers: 'nats://localhost:4222' }));
await eventRegistry.connect();
```

Implement `LTEventAdapter` (`connect` / `disconnect` / `publish`) to target SNS, Kafka, a webhook, or anything else. See `services/events/` for the interface and the in-memory reference adapter used in tests.

### Auth

Every API request goes through an auth adapter. The adapter reads the incoming request, verifies identity, and returns an `AuthPayload` with at least a `userId`. Long Tail ships a built-in `JwtAuthAdapter` that verifies Bearer tokens using `JWT_SECRET` — this is the default with no setup required.

To swap in your own provider, implement `LTAuthAdapter` and pass it to `createAuthMiddleware`:

```typescript
import { createAuthMiddleware } from '@hotmeshio/long-tail';
import type { LTAuthAdapter, AuthPayload } from '@hotmeshio/long-tail';
import { OAuth2Client } from 'google-auth-library';

const google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class GoogleOAuthAdapter implements LTAuthAdapter {
  async authenticate(req): Promise<AuthPayload | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const ticket = await google.verifyIdToken({
        idToken: header.slice(7),
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const { sub, email } = ticket.getPayload()!;
      return { userId: sub, email, role: 'member' };
    } catch {
      return null;
    }
  }
}

// Replace the default middleware when mounting routes
app.use('/api', createAuthMiddleware(new GoogleOAuthAdapter()));
```

The only contract is `{ userId: string }`. Everything else on the payload (`role`, `email`, custom claims) is passed through to `req.auth` and available in your route handlers. For development, you can skip auth entirely by returning a hardcoded payload.

### Maintenance

Workflow execution generates supporting data — activity records, stream messages, intermediate state. Long Tail ships a default maintenance schedule that cleans this up automatically using HotMesh's built-in cron. It runs nightly at 2 AM with no setup required.

The default rules:

- **Delete streams** older than 7 days — internal message data that's no longer needed.
- **Delete jobs without an entity** older than 7 days — transient records (activity executions, internal bookkeeping) not tied to a workflow you care about.
- **Prune jobs with an entity** older than 7 days — your actual workflows (`reviewContent`, `extractDocument`, etc.). Pruning strips the scaffolding but preserves core data, so Temporal-compatible exports always work.
- **Delete pruned jobs** older than 90 days — fully remove even the compact records after three months.

The net effect: your database holds about a week of full-detail data. Important workflows stick around much longer in compact form, and everything is eventually cleaned up.

To customize, register your own config before startup:

```typescript
import { maintenanceRegistry } from '@hotmeshio/long-tail';

maintenanceRegistry.register({
  schedule: '0 3 * * *', // 3 AM instead of 2 AM
  rules: [
    { target: 'streams', olderThan: '24 hours', action: 'delete' },
    { target: 'jobs',    olderThan: '14 days',  action: 'delete', hasEntity: false },
    { target: 'jobs',    olderThan: '14 days',  action: 'prune',  hasEntity: true },
    { target: 'jobs',    olderThan: '180 days', action: 'delete', pruned: true },
  ],
});
```

Or update at runtime via the REST API (admin-only):

```
PUT /api/config/maintenance

{
  "schedule": "0 3 * * *",
  "rules": [
    { "target": "streams", "olderThan": "24 hours", "action": "delete" },
    { "target": "jobs",    "olderThan": "14 days",  "action": "delete", "hasEntity": false },
    { "target": "jobs",    "olderThan": "14 days",  "action": "prune",  "hasEntity": true },
    { "target": "jobs",    "olderThan": "180 days", "action": "delete", "pruned": true }
  ]
}
```

## Exporting Execution History

Every workflow's full execution history can be exported in a Temporal-compatible format — typed events (`workflow_execution_started`, `activity_task_scheduled`, `activity_task_completed`, etc.) with ISO timestamps, durations, and event cross-references.

```
GET /api/workflow-states/:workflowId/execution?taskQueue=...&workflowName=...
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

Long Tail is built on [HotMesh](https://github.com/hotmeshio/sdk-typescript), a workflow engine that delivers Temporal-style durable execution using PostgreSQL.

- **Durable execution** — workflow state is transactionally persisted to Postgres. Crashes, deploys, restarts — the workflow resumes from its last checkpoint.
- **Deterministic replay** — workflows replay from persisted state on recovery. Activities are only executed once; their results are cached.
- **Signals** — workflows can pause and wait for external events (like a human resolving an escalation), then resume with the signal payload.

The LT interceptor adds the human-in-the-loop layer on top: task tracking, escalation management, claim/release with expiration, milestone recording, and audit trails. All stored in Postgres alongside the workflow state.

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

## Using Long Tail in Your Project

### Install

```bash
npm install @hotmeshio/long-tail @hotmeshio/hotmesh
```

### Connect and start workers

Long Tail uses Postgres for both workflow state and application data. Connect, run migrations, register the interceptor, and start your workflow workers:

```typescript
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';
import { registerLT } from '@hotmeshio/long-tail';

import * as myWorkflow from './workflows/my-workflow';

const connection = {
  class: Postgres,
  options: { connectionString: process.env.DATABASE_URL },
};

// Register Long Tail interceptors
await registerLT(connection);

// Start your workflow worker
const worker = await Durable.Worker.create({
  connection,
  taskQueue: 'my-queue',
  workflow: myWorkflow.myWorkflow,
});
await worker.run();
```

### Start a workflow

```typescript
const client = new Durable.Client({ connection });

const handle = await client.workflow.start({
  args: [{ data: { contentId: '123', content: 'Review this' }, metadata: {} }],
  taskQueue: 'my-queue',
  workflowName: 'myWorkflow',
  workflowId: `review-${Date.now()}`,
  expire: 86_400,
});

const result = await handle.result();
```

## API Reference

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/review-content` | Start a content review workflow |
| `POST` | `/api/workflows/verify-document` | Start a document verification workflow |
| `GET` | `/api/workflows/:id/status` | Get workflow execution status |
| `GET` | `/api/workflows/:id/result` | Await workflow result |
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

## Testing

```bash
# Start Postgres and NATS
docker compose up -d postgres nats

# Run all tests
npm test

# Run workflow tests
npm run test:workflows
```

## License

See [LICENSE](LICENSE).
