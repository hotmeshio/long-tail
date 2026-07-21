# Long Tail

**The queue durable systems forgot.**

Durable platforms are built around determinism — that is their strength and their blind spot. They give you rich, first-class queues for deterministic work (retry, timeout, `backoffCoefficient`, exactly-once) and an `await condition()` to park a workflow until a signal arrives. All of it assumes the thing you are waiting on will, eventually, behave.

Most of the work that decides an outcome behaves on its own schedule: an approval, a person, a shipment, a machine that needs service. You cannot set a `backoffCoefficient` on a person — retrying someone who has not answered just asks twice. This is why "human-in-the-loop" keeps getting bolted on as a feature: the platform perfected the deterministic queue and left the non-deterministic one for you to improvise.

Long Tail makes it a primitive. The same `condition()` wait — except the act of waiting mints a row that is searchable, claimable, deadlined, and role-gated on a shared metadata surface. Machines answer some rows, people answer others; the workflow resumes either way, exactly where it paused.

```bash
npm install @hotmeshio/long-tail
```

## How it works

One workflow, both queues: `proxyActivities` for the deterministic one, `condition()` for the one reality answers.

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import type { LTEnvelope } from '@hotmeshio/long-tail';
import * as activities from './activities';

const { analyzeContent } = Durable.workflow.proxyActivities<typeof activities>({ activities });

export async function reviewContent(envelope: LTEnvelope) {
  // method calls are checkpointed and crash safe
  const analysis = await analyzeContent(envelope.data.content);

  if (analysis.confidence >= 0.85) {
    return { data: { approved: true, analysis } };
  }

  //role-based escalations are baked-in. create HITL escalations with one call
  const { workflowId } = Durable.workflow.workflowInfo();
  const decision = await Durable.workflow.condition<{ approved: boolean; notes?: string }>(
    `review-${workflowId}`,
    {
      role: 'reviewer',
      type: 'content-review',
      priority: 2,
      description: `Confidence ${analysis.confidence} — needs a human`,
      metadata: { contentId: envelope.data.contentId },
      envelope: { data: envelope.data, analysis },
    },
  );

  return { data: { approved: decision.approved, analysis } };
}
```

Two surfaces, one model. A `proxyActivity` targets a machine: call it, get a result. `condition()` targets the external world — a reviewer, an operator, a factory cell. It suspends the workflow and writes a single escalation row carrying everything needed to route the work: the `role` that should act, its `type` and `priority`, and any `metadata` to display or filter on. People work that row through an RBAC-scoped surface — find it, claim it, resolve it — from the dashboard, the API, or MCP, and resolving it resumes the workflow exactly where it paused.

Activities are plain functions:

```typescript
export async function analyzeContent(content: string) {
  const result = await llm.classify(content);
  return { confidence: result.confidence, flags: result.flags };
}
```

## What the primitive buys

The non-deterministic queue has qualities the deterministic one never needed:

- **RBAC is intrinsic.** The queue is a role; permission lives in the queue itself. Any member answers — a person in the dashboard, a service account through the API — and the workflow is indifferent to which.
- **The form is data.** A versioned JSON Schema on the role renders the resolver's UI — fields, validation, conditionals, layout — with zero frontend code. Assign an escalation to one named user with self scope and you have a just-in-time form: one person, one item, one auditable edition.
- **Claims are locks.** A claim is a TTL window with an extend prompt before it lapses and a resolve guard behind it — the platform rejects a submission against an expired claim atomically, in the same statement that settles the row. Stale work cannot land.
- **Cancel is home.** Cancellation is a first-class settlement, not an exception. When the pressure no longer applies, the waiting flow sees `null` and reconciles to a modeled resting state. Handled is broader than resolved — timeout, cancel, and hop-onward are all endings the loop was built to reach.
- **One shared surface.** Every actor that touches an item writes to the same metadata-keyed row. The contact point is shared by construction, so there is one place to search, one place to claim, one place to audit.
- **History accretes.** The surface only ever adds: intent at creation, outcome at settlement, every crossing in between. The object's whole history sits there to replay — frames the queue kept for you.
- **Objects get lifecycles.** Give an object this queue and a `while` loop and it lives — a digital twin: it advertises when free, asks when it needs service, waits for reality's answer, reconciles when reality gives one. An order, a document only compliance may edit, a machine on a line — all the same shape, an object looping at a role.
- **What repeats, stops needing people.** Every settled row is a worked example. Recurring patterns become deterministic tools — problems that once required a person, then required AI reasoning, eventually require neither.

## Start

Point at Postgres. Everything else is optional.

```typescript
import { start } from '@hotmeshio/long-tail';

const lt = await start({
  database: { host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'mydb' },
  workers: [{ taskQueue: 'default', workflow: reviewContent }],
});
```

Dashboard at [http://localhost:3000](http://localhost:3000). The [boilerplate](https://github.com/hotmeshio/long-tail-boilerplate) has a working project with workflows, MCP servers, and MinIO.

## Register MCP tools

Long Tail connects to any MCP server. Registered tools become durable activities.

**Existing package — no code:**

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "filesystem",
    "transport_type": "stdio",
    "transport_config": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"] },
    "tags": ["files", "storage"],
    "auto_connect": true
  }'
```

**Remote server — point at a URL:**

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -d '{ "name": "my-python-server", "transport_type": "sse", "transport_config": { "url": "http://python-service:8000/mcp" } }'
```

**In-process — write your own:**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerMcpTool } from '@hotmeshio/long-tail';

export function createImageToolsServer(): McpServer {
  const server = new McpServer({ name: 'image-tools', version: '1.0.0' });

  registerMcpTool(server, 'resize_image', 'Resize an image.', {
    path: z.string().describe('Path to the image'),
    width: z.number().optional(),
    height: z.number().optional(),
  }, async (args: any) => ({
    content: [{ type: 'text', text: JSON.stringify(await resize(args)) }],
  }));

  return server;
}
```

```typescript
const lt = await start({
  // ...
  mcp: { serverFactories: { 'image-tools': createImageToolsServer } },
});
```

All three paths produce the same outcome: tools callable as durable activities. See the [MCP guide](https://github.com/hotmeshio/long-tail/blob/main/docs/mcp.md).

## Full configuration

```typescript
const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [{ taskQueue: 'default', workflow: reviewContent }],

  // Everything below is optional
  seed: { admin: { externalId: 'admin', password: process.env.ADMIN_PASSWORD } },
  mcp: { server: { enabled: true }, serverFactories: { 'my-tools': createMyToolsServer } },
  auth: { secret: process.env.JWT_SECRET },
  telemetry: { honeycomb: { apiKey: process.env.HNY } },
  logging: { pino: { level: 'info' } },
  maintenance: true,
});
```

## Embed in an existing app

Long Tail runs as an embedded package inside NestJS, Express, or any Node.js application. No extra HTTP server, no extra ports.

```typescript
import { start, createClient } from '@hotmeshio/long-tail';

const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  seed: { admin: { externalId: 'system' } },
  workers: [{ taskQueue: 'default', workflow: reviewContent }],
});

const client = createClient({ auth: { userId: lt.adminUserId } });

const tasks = await client.tasks.list({ status: 'completed', limit: 10 });
const result = await client.escalations.claim({ id: 'esc_123', durationMinutes: 30 });
```

Mount the dashboard at a subpath:

```typescript
import { LTExpressAdapter } from '@hotmeshio/long-tail';

const adapter = new LTExpressAdapter();
adapter.setBasePath('/admin/longtail');
app.use('/admin/longtail', adapter.getRouter());
```

Subscribe to events with callbacks:

```typescript
client.events.on('task.completed', (event) => console.log('done:', event.workflowId));
client.events.on('escalation.*', (event) => notifyTeam(event));
```

Every SDK call returns an `LTApiResult` — same status codes, same validation, same RBAC. See the [SDK guide](https://github.com/hotmeshio/long-tail/blob/main/docs/sdk.md).

## Deployment

Three modes from the same codebase:

```typescript
// Standalone — dashboard + API + workers
await start({ database: { connectionString: process.env.DATABASE_URL } });

// Worker-only — no HTTP server
await start({ database: { connectionString: process.env.DATABASE_URL }, server: { enabled: false }, workers: [...] });

// Embedded — inside your app, SDK calls only
await start({ database: { connectionString: process.env.DATABASE_URL }, server: { enabled: false } });
const lt = createClient({ auth: { userId: 'service' } });
```

All modes share PostgreSQL and scale independently. See [Cloud Deployment](https://github.com/hotmeshio/long-tail/blob/main/docs/cloud.md).

## Docs

| Guide | What it covers |
|-------|---------------|
| [The Long Tail Story](https://github.com/hotmeshio/long-tail/blob/main/docs/story.md) | Why this exists, what accumulates over time |
| [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/workflows.md) | Activities, interceptor, escalation lifecycle, composition |
| [IAM](https://github.com/hotmeshio/long-tail/blob/main/docs/iam.md) | Identity propagation, service accounts, credential exchange |
| [Dashboard](https://github.com/hotmeshio/long-tail/blob/main/docs/dashboard.md) | Navigation, key pages, event feed |
| [MCP](https://github.com/hotmeshio/long-tail/blob/main/docs/mcp.md) | Server registration, tool calls, human queue |
| [Compilation](https://github.com/hotmeshio/long-tail/blob/main/docs/compilation.md) | Dynamic to deterministic pipeline wizard |
| [Compiler](https://github.com/hotmeshio/long-tail/blob/main/docs/compiler.md) | `ltc compile` — durable TypeScript to YAML DAGs |
| [CLI](https://github.com/hotmeshio/long-tail/blob/main/docs/cli.md) | `ltc` — terminal access to workflows, escalations, knowledge, MCP |
| [Escalation Strategies](https://github.com/hotmeshio/long-tail/blob/main/docs/escalation-strategies.md) | Default, MCP triage, custom handlers |
| [Schema Enforcement](https://github.com/hotmeshio/long-tail/blob/main/docs/schema-enforcement.md) | form_schema as an enforced API contract on every resolve surface |
| [Faceted Routing](https://github.com/hotmeshio/long-tail/blob/main/docs/faceted-routing.md) | Query and atomically claim the queue by facets; dispatcher pattern |
| [SDK](https://github.com/hotmeshio/long-tail/blob/main/docs/sdk.md) | Embedded usage, `createClient`, event subscriptions |
| [Architecture](https://github.com/hotmeshio/long-tail/blob/main/docs/architecture.md) | Project structure, conventions, discovery |
| [Cloud](https://github.com/hotmeshio/long-tail/blob/main/docs/cloud.md) | AWS ECS, GCP Cloud Run, Docker |
| [Data Model](https://github.com/hotmeshio/long-tail/blob/main/docs/data.md) | Database schema |

**Adapters:** [Auth](https://github.com/hotmeshio/long-tail/blob/main/docs/auth.md) · [Events](https://github.com/hotmeshio/long-tail/blob/main/docs/events.md) · [Telemetry](https://github.com/hotmeshio/long-tail/blob/main/docs/telemetry.md) · [Logging](https://github.com/hotmeshio/long-tail/blob/main/docs/logging.md) · [Maintenance](https://github.com/hotmeshio/long-tail/blob/main/docs/maintenance.md) · [OAuth](https://github.com/hotmeshio/long-tail/blob/main/docs/oauth-and-delegation.md)

**HTTP API:** [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/workflows.md) · [Tasks](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/tasks.md) · [Escalations](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/escalations.md) · [YAML Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/yaml-workflows.md) · [Users](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/users.md) · [Roles](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/roles.md) · [Service Accounts](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/service-accounts.md) · [MCP Servers](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/mcp-servers.md) · [Pipelines](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/pipelines.md) · [Exports](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/exports.md)

**SDK:** [Overview](https://github.com/hotmeshio/long-tail/blob/main/docs/sdk.md) · [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/workflows.md) · [Tasks](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/tasks.md) · [Escalations](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/escalations.md) · [YAML Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/yaml-workflows.md) · [MCP](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/mcp.md) · [Events](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/events.md)

## Contributing

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). Example workflows seed the dashboard.

| User | Password | Role |
|------|----------|------|
| `superadmin` | `l0ngt@1l` | superadmin |
| `admin` | `l0ngt@1l` | admin |
| `engineer` | `l0ngt@1l` | engineer |
| `reviewer` | `l0ngt@1l` | reviewer |

See [Contributing](https://github.com/hotmeshio/long-tail/blob/main/docs/contributing.md).

## License

See [LICENSE](https://github.com/hotmeshio/long-tail/blob/main/LICENSE).
