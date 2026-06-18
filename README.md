# Long Tail

Write durable workflows in TypeScript. When they need a human, they escalate. When they need AI, they orchestrate. When a pattern repeats, they compile it away. Postgres is the engine.

```bash
npm install @hotmeshio/long-tail
```

## How it works

You write a workflow function. Each activity call checkpoints to Postgres — if the process crashes, it resumes from the last completed step.

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import type { LTEnvelope } from '@hotmeshio/long-tail';
import * as activities from './activities';

const { analyzeContent } = Durable.workflow.proxyActivities<typeof activities>({ activities });

export async function reviewContent(envelope: LTEnvelope) {
  const analysis = await analyzeContent(envelope.data.content);

  if (analysis.confidence >= 0.85) {
    return { type: 'return' as const, data: { approved: true, analysis } };
  }

  // Low confidence — escalate to a human reviewer
  return {
    type: 'escalation' as const,
    role: 'reviewer',
    message: `Review needed (confidence: ${analysis.confidence})`,
    data: { content: envelope.data.content, analysis },
  };
}
```

That's a complete workflow. It runs, checkpoints, and when confidence is low, it hands off to a human. The human resolves it through the dashboard or API, and the workflow completes. No separate queue system, no webhook callbacks — the escalation is part of the execution.

Activities are plain functions:

```typescript
export async function analyzeContent(content: string) {
  const result = await llm.classify(content);
  return { confidence: result.confidence, flags: result.flags };
}
```

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

## The pattern

**Step 1 — Author a durable workflow.** Your function checkpoints to Postgres. It can sleep, branch, call child workflows, wait for signals. Standard durable execution.

**Step 2 — Certify it.** Promotion to certified adds interceptor guarantees: failures escalate instead of throwing, escalation chains route through RBAC-scoped roles, and every error is either handled or surfaced. It cannot silently fail.

```bash
curl -X PUT http://localhost:3000/api/workflows/reviewContent/config \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "invocable": true, "task_queue": "default", "default_role": "reviewer" }'
```

**Step 3 — React to events.** Workflows publish topics. Agents subscribe. When `activity.failed` fires, an automation can re-run the step, notify a team, or trigger a different workflow. The choreography is dynamic — add subscribers through the dashboard without changing code.

**Step 4 — Compile what repeats.** The same workflow has two forms. What you wrote in Step 1 is the *procedural* form — readable, Temporal-like, emulated atop the graph: cheap to maintain, heavier to run. The Designer compiles a working execution into the *graph* form — the same durable workflow as a deterministic DAG: no LLM at runtime, no replay overhead, typed in and out, roughly 3x faster. Every procedural pattern has a graph equivalent and the reverse; you pick readability or speed without giving up durability, escalation, or transactional guarantees. It deploys as a reusable tool that any workflow or API call can invoke.

Over time, the system accumulates compiled tools. Problems that once required a human, then required AI reasoning, eventually require neither.

These four steps map to how the dashboard is organized. **React** is the reactive side (Step 3) — topics, subscriptions, automations. **Orchestrate** is the orchestrated side (Steps 1 and 4) — procedural and graph flows side by side, both durable and pull-based under the hood. **Design** is the optional bridge: with an `ANTHROPIC_API_KEY` it turns a description or a tool run into a graph flow; without one, choreography and orchestration stand on their own, no tradeoff.

## Register MCP tools

Long Tail connects to any MCP server. Registered tools become durable activities and are available to the Pipeline Designer.

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

## Compile workflows

The `ltc` compiler scans TypeScript workflow files and compiles them to YAML DAGs — like `tsc` for workflows.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx ltc compile workflows/
```

The source is the spec. The compiled YAML is the optimized execution. Both live in the repo. See the [Compiler Guide](https://github.com/hotmeshio/long-tail/blob/main/docs/compiler.md).

## Register a graph flow by hand

`graphWorkflows` is the graph-form peer of `workers`: hand-author the HotMesh YAML and it's created, deployed, and activated at startup. This hello-world assembles a greeting from the input with a single trigger mapping:

```typescript
const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  graphWorkflows: [{
    name: 'hello_world',
    namespace: 'graph',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    yaml: `
app:
  id: graph
  version: '1'
  graphs:
    - subscribes: hello_world
      publishes: hello_world.done
      input:  { schema: { type: object, properties: { name: { type: string } } } }
      output: { schema: { type: object, properties: { greeting: { type: string } } } }
      activities:
        trigger:
          type: trigger
          job:
            maps:
              greeting:
                '@pipe':
                  - ['Hello, ', '{$self.input.data.name}', '!']
                  - ['{@string.concat}']
      transitions: {}
`,
  }],
});
```

It appears under **Orchestrate › Graph** and runs the same way a procedural workflow does — durable, transactional, invocable from the dashboard or API.

## Full configuration

```typescript
const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [{ taskQueue: 'default', workflow: reviewContent }],

  // Everything below is optional
  graphWorkflows: [{ name: 'hello_world', namespace: 'graph', yaml: helloWorldYaml }],
  seed: { admin: { externalId: 'admin', password: process.env.ADMIN_PASSWORD } },
  mcp: { server: { enabled: true }, serverFactories: { 'my-tools': createMyToolsServer } },
  escalation: { strategy: 'mcp' },
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

// Defensive resolution — discriminated result, never throws
const resolved = await client.escalations.tryResolveByMetadata({
  key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
});
if (!resolved.matched && resolved.reason === 'resolve-failed') {
  // Signal delivery failed — do not silently continue
}

// Signal queue — atomic claim + resolve for agents and automation
const entry = await client.signalQueue.claimByMetadata({ key: 'stationName', value: 'scan', durationMinutes: 15 });
if (entry.ok) {
  await client.signalQueue.resolve({ id: entry.id, resolverPayload: { scanned: true } });
}
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
| [HITL Guide](https://github.com/hotmeshio/long-tail/blob/main/docs/hitl-guide.md) | Human-in-the-loop: patterns, forms, iframe viewport, dev/user mode |
| [Signal Queue](https://github.com/hotmeshio/long-tail/blob/main/docs/signal-queue.md) | Atomic suspend + signal routing, migration from enrichEscalationRouting |
| [IAM](https://github.com/hotmeshio/long-tail/blob/main/docs/iam.md) | Identity propagation, service accounts, credential exchange |
| [Dashboard](https://github.com/hotmeshio/long-tail/blob/main/docs/dashboard.md) | Navigation, key pages, event feed |
| [MCP](https://github.com/hotmeshio/long-tail/blob/main/docs/mcp.md) | Server registration, tool calls, human queue |
| [Compilation](https://github.com/hotmeshio/long-tail/blob/main/docs/compilation.md) | Dynamic to deterministic pipeline wizard |
| [Compiler](https://github.com/hotmeshio/long-tail/blob/main/docs/compiler.md) | `ltc compile` — durable TypeScript to YAML DAGs |
| [CLI](https://github.com/hotmeshio/long-tail/blob/main/docs/cli.md) | `ltc` — terminal access to workflows, escalations, knowledge, MCP |
| [Escalation Strategies](https://github.com/hotmeshio/long-tail/blob/main/docs/escalation-strategies.md) | Default, MCP triage, custom handlers |
| [SDK](https://github.com/hotmeshio/long-tail/blob/main/docs/sdk.md) | Embedded usage, `createClient`, event subscriptions |
| [Architecture](https://github.com/hotmeshio/long-tail/blob/main/docs/architecture.md) | Project structure, conventions, discovery |
| [Cloud](https://github.com/hotmeshio/long-tail/blob/main/docs/cloud.md) | AWS ECS, GCP Cloud Run, Docker |
| [Data Model](https://github.com/hotmeshio/long-tail/blob/main/docs/data.md) | Database schema |

**Adapters:** [Auth](https://github.com/hotmeshio/long-tail/blob/main/docs/auth.md) · [Events](https://github.com/hotmeshio/long-tail/blob/main/docs/events.md) · [Telemetry](https://github.com/hotmeshio/long-tail/blob/main/docs/telemetry.md) · [Logging](https://github.com/hotmeshio/long-tail/blob/main/docs/logging.md) · [Maintenance](https://github.com/hotmeshio/long-tail/blob/main/docs/maintenance.md) · [OAuth](https://github.com/hotmeshio/long-tail/blob/main/docs/oauth-and-delegation.md)

**HTTP API:** [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/workflows.md) · [Tasks](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/tasks.md) · [Escalations](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/escalations.md) · [YAML Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/yaml-workflows.md) · [Users](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/users.md) · [Roles](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/roles.md) · [Service Accounts](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/service-accounts.md) · [MCP Servers](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/mcp-servers.md) · [Pipelines](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/pipelines.md) · [Exports](https://github.com/hotmeshio/long-tail/blob/main/docs/api/http/exports.md)

**SDK:** [Overview](https://github.com/hotmeshio/long-tail/blob/main/docs/sdk.md) · [Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/workflows.md) · [Tasks](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/tasks.md) · [Escalations](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/escalations.md) · [Signal Queue](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/signal-queue.md) · [YAML Workflows](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/yaml-workflows.md) · [MCP](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/mcp.md) · [Events](https://github.com/hotmeshio/long-tail/blob/main/docs/api/sdk/events.md)

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
