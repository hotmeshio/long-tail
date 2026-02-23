# Long Tail

**AI and humans, working the same queue.**

Long Tail is a workflow engine where AI handles the routine work and everything it can't handle flows to the right person automatically. The only infrastructure you need is PostgreSQL.

## Writing a Workflow

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

When `reviewContent` executes, the interceptor wraps it with task tracking, escalation management, and audit trails. You don't add any of that to your workflow code — it comes from the config:

```sql
SELECT workflow_type, is_lt, default_role, roles
FROM   lt_config_workflows
WHERE  workflow_type = 'reviewContent';

--  workflow_type  | is_lt | default_role | roles
-- ----------------+-------+--------------+---------------
--  reviewContent  | true  | reviewer     | {reviewer}
```

If the AI is confident, the task completes and you can see it in the `lt_tasks` table:

```sql
SELECT id, workflow_type, status, origin_id,
       data::json->>'approved' AS approved
FROM   lt_tasks
WHERE  workflow_type = 'reviewContent'
ORDER  BY created_at DESC
LIMIT  5;
```

If the AI isn't confident, an escalation record appears in `lt_escalations`:

```sql
SELECT id, workflow_type, status, role, message
FROM   lt_escalations
WHERE  status = 'pending';
```

It's just Postgres. You can query it, join it, export it, build dashboards on it.

### Exporting Workflow Execution History

Every workflow's full execution history — input data, activity timeline, state transitions — is available through the export endpoint:

```
GET /api/workflows/:workflowId/export
```

This calls HotMesh's `Durable.export()` under the hood, which reads directly from the Postgres-backed execution store. The response includes:

- **data** — workflow input and output
- **status** — execution status (0 = complete, negative = interrupted/waiting)
- **timeline** — every activity call with its stored result
- **transitions** — state machine transitions with timestamps

You can also call it programmatically:

```typescript
const client = new Durable.Client({ connection });
const handle = await client.workflow.getHandle(taskQueue, workflowName, workflowId);
const history = await handle.export();
```

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

Children that share an `originId` can read each other's completed data through the consumer/provider pattern, so you don't have to pass everything through the envelope:

```typescript
// extractDocument completes → its result is stored in lt_tasks
// validateExtraction's config declares extractDocument as a provider:
//   consumers: [{ provider_name: 'extraction', provider_workflow_type: 'extractDocument' }]
// executeLT automatically injects the data into envelope.lt.providers
```

## Escalations

When a workflow escalates, a record lands in `lt_escalations` with full context — what the AI tried, why it wasn't confident, what it needs from a resolver. Who resolves it is a deployment decision:

- A human team using a purpose-built UI
- Another AI agent consuming from the same API
- A hybrid — AI does a first pass, routes to a human for sign-off

Escalations support claim/release with expiration. If a reviewer doesn't finish in time, the escalation goes back to the queue.

Escalations are routed by role. Users are assigned roles with hierarchical types (`superadmin`, `admin`, `member`), and the queue filters accordingly.

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

## Pluggable Services

Postgres is the only hard dependency. Everything else — telemetry, events, auth — is pluggable. Long Tail ships reference adapters, but you wire in whatever your team already uses.

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

Auth uses the same adapter pattern. The built-in `JwtAuthAdapter` handles JWT verification; swap in an API-key adapter, an OAuth adapter, or skip auth entirely in development. See `modules/auth.ts` for the interface.

## How It Works

Long Tail is built on [HotMesh](https://github.com/hotmeshio/sdk-typescript), a workflow engine that delivers Temporal-style durable execution using PostgreSQL as its only dependency. No Temporal server. No Redis. No message broker infrastructure.

- **Durable execution** — workflow state is transactionally persisted to Postgres. Crashes, deploys, restarts — the workflow resumes from its last checkpoint.
- **Deterministic replay** — workflows replay from persisted state on recovery. Activities are only executed once; their results are cached.
- **Signals** — workflows can pause and wait for external events (like a human resolving an escalation), then resume with the signal payload.

The LT interceptor adds the human-in-the-loop layer on top: task tracking, escalation management, claim/release with expiration, milestone recording, and audit trails. All stored in Postgres alongside the workflow state.

```
┌─────────────────────────────────────────────────────────┐
│                    Your Workflow Code                    │
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
                        ┌────▼────┐
                        │ Postgres│
                        │         │
                        │ • State │
                        │ • Tasks │
                        │ • Queue │
                        │ • Audit │
                        └─────────┘
```

## API Reference

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/review-content` | Start a content review workflow |
| `POST` | `/api/workflows/verify-document` | Start a document verification workflow |
| `GET` | `/api/workflows/:id/status` | Get workflow execution status |
| `GET` | `/api/workflows/:id/result` | Await workflow result |
| `GET` | `/api/workflows/:id/export` | Export full execution history (data, timeline, transitions) |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks (filter by `status`, `lt_type`, `workflow_type`) |
| `GET` | `/api/tasks/:id` | Get task details |
| `GET` | `/api/tasks/workflow/:workflowId` | Get task by workflow ID |

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
| `POST` | `/api/users` | Create user with roles |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user |
| `POST` | `/api/users/:id/roles` | Add role to user |
| `DELETE` | `/api/users/:id/roles/:role` | Remove role from user |

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
