# Long Tail

## Durable workflow solves reliability. Long Tail solves uncertainty.

Sooner or later, your workflow waits on something outside its control: a reviewer's approval, an agent's answer, a machine's finished cycle. Call `conditional()` there. The workflow pauses, the work lands in a role's queue, and whoever resolves it sends the answer back as a typed value.

```bash
npm install @hotmeshio/long-tail
```

```ts
import { conditional, type LTEnvelope } from '@hotmeshio/long-tail';

export async function reviewOrder(envelope: LTEnvelope) {
  const { orderId } = envelope.data;
  const decision = await conditional<{ approved: boolean }>(`review-${orderId}`, {
    role: 'reviewer',
    type: 'order-review',
    metadata: { orderId },
    timeout: '48h',
  });
  if (!decision) return 'expired or cancelled';
  return decision.approved ? 'shipped' : 'rejected';
}
```

A reviewer claims the review in the dashboard, fills in the role's form and submits. The workflow resumes with their answer, `false` when the wait expired, or `null` when it was cancelled.

## What you get

- **Queues by role.** Each wait lands in a role's queue, filtered and counted by its `metadata` facets.
- **Forms.** The role's versioned schema renders the form and validates every answer before it reaches the workflow.
- **Claims.** One person works an item at a time, under a time-boxed claim.
- **Deadlines.** `timeout` becomes the escalation's expiry.
- **A dashboard.** Queues, escalation detail, your workflows and each one's timeline.
- **Every surface.** A person resolves on the [dashboard](https://github.com/hotmeshio/long-tail/blob/main/docs/dashboard.md), a service over [HTTP](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/escalations.md), an operator from the [CLI](https://github.com/hotmeshio/long-tail/blob/main/docs/cli.md), an agent over [MCP](https://github.com/hotmeshio/long-tail/blob/main/docs/mcp.md), a machine over [MQTT](https://github.com/hotmeshio/long-tail/blob/main/docs/machines.md). The escalation, the validation, the permissions and the audit are the same on each.
- **Invoke and schedules.** Register a workflow, and people, services and agents start it from the dashboard, HTTP or MCP, or Long Tail starts it on a cron schedule.

A wait can also prefill its form (`envelope`), attach `files` and `lookups`, pin a form `schemaVersion`, go straight to an `assignee`, collect many items (`batch`, `accumulate`), and be addressed by a `signalKey`. See [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/workflows.md).

## Your durable engine

Long Tail runs workflows on [HotMesh](https://github.com/hotmeshio/sdk-typescript), with Postgres as the only dependency. Workflows on Temporal and DBOS make the same `conditional()` call and get the same queues, forms and dashboard:

- [Long Tail for Temporal](https://github.com/hotmeshio/long-tail-temporal)
- [Long Tail for DBOS](https://github.com/hotmeshio/long-tail-dbos)

## Start

Point at Postgres and register your workflows. Everything else is optional.

```typescript
import { start } from '@hotmeshio/long-tail';

const lt = await start({
  database: { host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'mydb' },
  workers: [{ taskQueue: 'default', workflow: reviewOrder }],
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
  workers: [{ taskQueue: 'default', workflow: reviewOrder }],

  // Everything below is optional
  seed: { admin: { externalId: 'admin', password: process.env.ADMIN_PASSWORD } },
  mcp: { server: { enabled: true }, serverFactories: { 'my-tools': createMyToolsServer } },
  auth: { secret: process.env.JWT_SECRET },
  telemetry: { honeycomb: { apiKey: process.env.HNY } },
  logging: { pino: { level: 'info' } },
  maintenance: true,
  machines: { lines: [Machines.loadLine('/etc/line.json')] },  // rows resolved over MQTT; the dashboard gains a Lines view
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
  workers: [{ taskQueue: 'default', workflow: reviewOrder }],
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
| [The Long Tail Story](https://github.com/hotmeshio/long-tail/blob/main/docs/donotpublish/story.md) | Why this exists, what accumulates over time |
| [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/workflows.md) | Activities, interceptor, escalation lifecycle, composition |
| [IAM](https://github.com/hotmeshio/long-tail/blob/main/docs/iam.md) | Identity propagation, service accounts, credential exchange |
| [Dashboard](https://github.com/hotmeshio/long-tail/blob/main/docs/dashboard.md) | Navigation, key pages, event feed |
| [MCP](https://github.com/hotmeshio/long-tail/blob/main/docs/mcp.md) | Server registration, tool calls, human queue |
| [Compilation](https://github.com/hotmeshio/long-tail/blob/main/docs/donotpublish/compilation.md) | Dynamic to deterministic pipeline wizard |
| [Compiler](https://github.com/hotmeshio/long-tail/blob/main/docs/donotpublish/compiler.md) | `ltc compile` — durable TypeScript to YAML DAGs |
| [CLI](https://github.com/hotmeshio/long-tail/blob/main/docs/cli.md) | `ltc` — terminal access to workflows, escalations, knowledge, MCP |
| [Escalation Strategies](https://github.com/hotmeshio/long-tail/blob/main/docs/escalation-strategies.md) | Default, MCP triage, custom handlers |
| [Durable Providers](https://github.com/hotmeshio/long-tail/blob/main/docs/durable-providers.md) | Temporal and DBOS workflows wait on people with `conditional()`; Long Tail owns the escalation boundary |
| [Schema Enforcement](https://github.com/hotmeshio/long-tail/blob/main/docs/schema-enforcement.md) | form_schema as an enforced API contract on every resolve surface |
| [Code-Owned Configuration](https://github.com/hotmeshio/long-tail/blob/main/docs/code-owned-configuration.md) | `configSource` — declared config compared and applied at every boot |
| [Faceted Routing](https://github.com/hotmeshio/long-tail/blob/main/docs/faceted-routing.md) | Query and atomically claim the queue by facets; dispatcher pattern |
| [Machines](https://github.com/hotmeshio/long-tail/blob/main/docs/machines.md) | `start({ machines })`: machines resolve escalation rows over MQTT, as people do with forms; the Lines view, the line registry API and the machines MCP server |
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

See [Contributing](https://github.com/hotmeshio/long-tail/blob/main/docs/donotpublish/contributing.md).

## License

See [LICENSE](https://github.com/hotmeshio/long-tail/blob/main/LICENSE).
