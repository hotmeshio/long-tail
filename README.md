# Long Tail

Turn your PostgreSQL database into a workflow engine with identity-aware durable execution, human-in-the-loop escalation, and MCP tool orchestration.

```bash
npm install @hotmeshio/long-tail
```

## Use Long Tail for

- **Durable execution** — Your functions run as workflows and checkpoint to Postgres. If the process crashes, execution resumes from the last completed step.
- **Identity everywhere** — Workflows know who started them, whose credentials govern their execution, and what permissions are in play. IAM is not bolted on — it's woven into every activity call.
- **Human-in-the-loop** — When confidence is low, the workflow escalates. RBAC-scoped escalation chains route work to the right reviewer. Approval workflows, content review, document verification — the pattern is the same.
- **AI triage** — When human-in-the-loop teams can't resolve a request, AI takes over. Its tool calls are checkpointed. And when the fix works, it compiles into a deterministic pipeline for next time.
- **MCP tool orchestration** — Describe what you need. If you've registered the tools, the Pipeline Designer builds the workflow. Every compiled pipeline deploys as a reusable MCP tool.

A dashboard, REST API, and live event stream ship with the package. Use what you need.

## Start

Point at Postgres. Everything else is optional.

```typescript
import { start } from '@hotmeshio/long-tail';
import * as myWorkflow from './workflows/my-workflow';

const lt = await start({
  database: { host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'mydb' },
  workers: [{ taskQueue: 'default', workflow: myWorkflow.reviewContent }],
  auth: { secret: process.env.JWT_SECRET },
});
```

Dashboard at [http://localhost:3000](http://localhost:3000). The [boilerplate](https://github.com/hotmeshio/long-tail-boilerplate) has a working project with custom MCP servers, MinIO, and example workflows.

## Write a Durable Workflow

A workflow receives an envelope and returns a result. Each activity call checkpoints — no work is lost, no step runs twice.

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

  return {
    type: 'escalation' as const,
    role: 'reviewer',
    message: `Review needed (confidence: ${analysis.confidence})`,
    data: { content: envelope.data.content, analysis },
  };
}
```

Activities are plain functions with side effects — API calls, LLM invocations, database queries. The `proxyActivities` call wraps them so the engine can checkpoint each result.

```typescript
// activities.ts
export async function analyzeContent(content: string) {
  const result = await llm.classify(content);
  return { confidence: result.confidence, flags: result.flags };
}
```

## Certify a Workflow

Any durable workflow can be promoted to **certified** through the dashboard or API. A certified workflow gains interceptor guarantees: failures escalate instead of throwing, escalation chains route through roles, and every error is either handled or surfaced. It cannot silently fail.

```bash
curl -X PUT http://localhost:3000/api/workflows/reviewContent/config \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "invocable": true, "task_queue": "default", "default_role": "reviewer" }'
```

De-certifying removes the interceptor. The workflow continues as a standard durable workflow — same code, different guarantees.

## Register MCP Servers

Long Tail connects to any MCP server — an npm package, a remote service, or one you write yourself. Registered tools become durable activities and are available to the Pipeline Designer.

**Use an existing package** — no code, just register:

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

**Connect a remote server** — point at a URL:

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-python-server",
    "transport_type": "sse",
    "transport_config": { "url": "http://python-service:8000/mcp" },
    "tags": ["ml", "classification"],
    "compile_hints": "Returns confidence scores. Use threshold 0.85 for auto-approve."
  }'
```

**Write your own** and register it in-process:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerMcpTool } from '@hotmeshio/long-tail';

export function createImageToolsServer(): McpServer {
  const server = new McpServer({ name: 'image-tools', version: '1.0.0' });

  registerMcpTool(server, 'resize_image', 'Resize an image.', {
    path: z.string().describe('Path to the image'),
    width: z.number().optional().describe('Target width'),
    height: z.number().optional().describe('Target height'),
  }, async (args: any) => ({
    content: [{ type: 'text', text: JSON.stringify(await resize(args)) }],
  }));

  return server;
}
```

```typescript
const lt = await start({
  // ...
  mcp: {
    serverFactories: { 'image-tools': createImageToolsServer },
  },
});
```

All three paths produce the same outcome: tools callable as durable activities. Tags enable discovery. Compile hints guide the compiler when tools are compiled into deterministic pipelines. See the [MCP guide](docs/mcp.md) for the full registration lifecycle.

## Ask It Anything

Once your tools are registered, the Pipeline Designer orchestrates them. Describe what you need in plain language:

> *"Log into localhost:3000 as superadmin, navigate to every page in the sidebar, and save a screenshot of each."*

The system discovers the right MCP servers, calls the tools, chains the results. If it works, the compilation wizard converts the execution into a deterministic pipeline — parameterized inputs, typed schema, no LLM at runtime. It deploys as a new MCP tool that any workflow, agent, or API call can invoke.

The inventory of compiled tools grows over time. The need for LLM reasoning shrinks. Problems that once required a human, then required an AI, eventually require neither.

## Full Configuration

```typescript
const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [{ taskQueue: 'default', workflow: myWorkflow.reviewContent }],

  // Everything below is optional
  mcp: {
    server: { enabled: true },
    serverFactories: { 'my-tools': createMyToolsServer },
  },
  escalation: { strategy: 'mcp' },
  auth: { secret: process.env.JWT_SECRET },
  telemetry: { honeycomb: { apiKey: process.env.HNY } },
  logging: { pino: { level: 'info' } },
  maintenance: true,
});
```

## Deployment

Two container types from the same codebase:

```typescript
// api.ts — dashboard + REST API
await start({ database: { connectionString: process.env.DATABASE_URL } });

// worker.ts — workflow execution, no HTTP server
await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  workers: [{ taskQueue: 'default', workflow: reviewContent.reviewContent }],
});
```

Both share PostgreSQL and scale independently. See [Cloud Deployment](docs/cloud.md).

## Docs

| Guide | What it covers |
|-------|---------------|
| [Workflows](docs/workflows.md) | Activities, interceptor, escalation lifecycle, composition |
| [IAM](docs/iam.md) | Identity propagation, service accounts, credential exchange |
| [Dashboard](docs/dashboard.md) | Navigation, key pages, event feed |
| [MCP](docs/mcp.md) | Server registration, tool calls, human queue |
| [Compilation](docs/compilation.md) | Dynamic → deterministic pipeline wizard |
| [Escalation Strategies](docs/escalation-strategies.md) | Default, MCP triage, custom handlers |
| [Architecture](docs/architecture.md) | Project structure, conventions, discovery |
| [Cloud](docs/cloud.md) | AWS ECS, GCP Cloud Run, Docker |
| [Data Model](docs/data.md) | Database schema |

**Adapters:** [Auth](docs/auth.md) · [Events](docs/events.md) · [Telemetry](docs/telemetry.md) · [Logging](docs/logging.md) · [Maintenance](docs/maintenance.md) · [OAuth](docs/oauth-and-delegation.md)

**API:** [Workflows](docs/api/workflows.md) · [Tasks](docs/api/tasks.md) · [Escalations](docs/api/escalations.md) · [YAML Workflows](docs/api/yaml-workflows.md) · [Users](docs/api/users.md) · [Roles](docs/api/roles.md) · [Service Accounts](docs/api/service-accounts.md) · [MCP Servers](docs/api/mcp-servers.md) · [MCP Runs](docs/api/mcp-runs.md) · [Exports](docs/api/exports.md)

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

See [Contributing](docs/contributing.md).

## License

See [LICENSE](LICENSE).
