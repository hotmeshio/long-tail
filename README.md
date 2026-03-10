# Long Tail

**Models provide capability. Process provides continuity.**

LLMs are good at making predictions. But production systems need something more: the ability to continue when the prediction is uncertain.

Long Tail treats uncertainty as part of the workflow. When confidence is low, the task escalates. If the issue can be repaired, the system retries the step and records how the problem was resolved. Successful repairs can then be compiled into deterministic workflows so the next occurrence runs automatically.

The result is simple: **models handle what they know, people handle what they understand, and the system turns solved exceptions into automation.**

> **MCP** (Model Context Protocol) is a standard for exposing tools that AI agents and deterministic code can both call. Long Tail uses MCP as the universal interface — every tool, every human queue, every compiled workflow speaks the same protocol.

## Quick Start

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000) once healthy (~10s). Four workflows seed the dashboard.

| User | Password | Role |
|------|----------|------|
| `superadmin` | `superadmin123` | superadmin |
| `admin` | `admin123` | admin |
| `engineer` | `engineer123` | engineer |
| `reviewer` | `reviewer123` | reviewer |

To reset: `docker compose down -v && docker compose up -d --build`

## Write a Workflow

A **workflow** is a deterministic function. An **activity** is where side effects live (API calls, LLMs, databases). Activities are checkpointed — if the process crashes, they replay from cache, never called twice.

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
  if (envelope.resolver) {
    return { type: 'return', data: { ...envelope.data, resolution: envelope.resolver } };
  }

  const analysis = await analyzeContent(envelope.data.content);

  if (analysis.confidence >= 0.85) {
    return { type: 'return', data: { approved: true, analysis } };
  }

  return {
    type: 'escalation',
    data: { content: envelope.data.content, analysis },
    message: `Review needed (confidence: ${analysis.confidence})`,
    role: 'reviewer',
  };
}
```

Register and start. MCP Servers initialize, workers start, and the API listens. The only infrastructure is PostgreSQL.

```typescript
import { start } from '@hotmeshio/long-tail';
import * as myWorkflow from './workflows/my-workflow';

const lt = await start({
  database: { host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'mydb' },
  workers: [{ taskQueue: 'my-queue', workflow: myWorkflow.reviewContent }],
});

const handle = await lt.client.workflow.start({
  args: [{ data: { content: 'Review this' }, metadata: {} }],
  taskQueue: 'my-queue',
  workflowName: 'reviewContent',
  workflowId: `review-${Date.now()}`,
});
```

See the full [Workflows Guide](docs/workflows.md) for activities, the interceptor, escalation lifecycle, composition, and testing.

## How the System Evolves

Three layers work together. Each one feeds the next.

### 1. Escalation

When AI isn't confident, the workflow returns `{ type: 'escalation' }`. The interceptor creates a record with full context — what the AI tried, what it saw, why it wasn't sure. A human claims the work, resolves it, and the workflow re-runs with their decision.

```
POST /api/escalations/esc-abc123/resolve
{ "resolverPayload": { "approved": true, "notes": "Content is fine" } }
```

### 2. Triage

Sometimes the human *can't* fix it — an upside-down page, a document in the wrong language. They flag `needsTriage` with a hint. An AI triage agent takes over: it queries the escalation history, discovers available tools by tag, and runs an agentic loop — rotate the page, re-extract data, validate against a database. Every tool call is checkpointed. If the agent can't fix it either, it escalates to an engineer with a full diagnosis.

### 3. Compilation

This is the key differentiator. Every triage execution produces a recording — which tools were called, in what order, with what results. The workflow compiler converts that recording into a deterministic YAML workflow:

```
Triage execution (dynamic, LLM-driven)        Compiled workflow (deterministic)
  rotate_page(page1, 180°)                       step 1: rotate_page
  extract_member_info(page1_rotated.png)    →    step 2: extract_member_info
  validate_member({ name, id })                   step 3: validate_member
```

The compiled workflow is deployed as a new tool. Next time, it runs without an LLM or a human. The triage agent discovers it has one more tool. The system gets better at handling its own edge cases.

## Activities are Tools

This is the unifying concept. Every activity function — the side-effect functions that workflows call — is also an MCP tool. Write a function, register it as an activity in your workflow, wrap it in an MCP server, and it becomes a tool that any agent can call.

The same is true in reverse: register an MCP server and its tools become proxy activities automatically.

```typescript
// This function is BOTH an activity AND a tool
export async function classify(args: { content: string }) {
  const response = await llm.analyze(args.content);
  return { category: response.category, confidence: response.confidence };
}
```

Humans are tools too. Long Tail exposes its escalation queue as an MCP server (`long-tail-human-queue`). Compiled workflows are tools. The protocol is the same whether the caller is deterministic code, an LLM, or a person clicking a button.

See the [Architecture Guide](docs/architecture.md) for project structure, conventions, built-in servers, and tag-based tool discovery. See the [MCP Guide](docs/mcp.md) for server registration, tool calls, and the human queue protocol.

## Developer API

```typescript
import { start } from '@hotmeshio/long-tail';

const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [{ taskQueue: 'my-queue', workflow: myWorkflow.reviewContent }],

  // Everything below is optional
  examples: true,                                          // seed demo workflows
  mcp: { server: { enabled: true } },                     // MCP server + clients
  escalation: { strategy: 'mcp' },                        // AI triage on escalation
  auth: { secret: process.env.JWT_SECRET },                // JWT auth
  telemetry: { honeycomb: { apiKey: process.env.HNY } },   // OpenTelemetry
  events: { nats: { url: 'nats://localhost:4222' } },      // real-time events
  logging: { pino: { level: 'info' } },                    // structured logging
  maintenance: true,                                       // scheduled cleanup
});
```

Every cross-cutting concern follows the same pattern: implement a typed interface, register at startup, done. See the adapter guides:

[Auth](docs/auth.md) | [Events](docs/events.md) | [Telemetry](docs/telemetry.md) | [Logging](docs/logging.md) | [MCP](docs/mcp.md) | [Maintenance](docs/maintenance.md) | [Escalation Strategies](docs/escalation-strategies.md)

## Deployment

Two container types from the same codebase — one serves the API, the other executes workflows:

```typescript
// api.ts — REST endpoints, no workflow execution
await start({ database: { connectionString: process.env.DATABASE_URL } });

// worker.ts — workflow execution, no HTTP server
await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  workers: [{ taskQueue: 'my-queue', workflow: reviewContent.reviewContent }],
});
```

Both share PostgreSQL and scale independently. See [Cloud Deployment](docs/cloud.md).

## Docs

| Guide | What it covers |
|-------|---------------|
| [Workflows](docs/workflows.md) | Activities, interceptor, escalation lifecycle, composition, testing |
| [Architecture](docs/architecture.md) | Project structure, conventions, built-in MCP servers, tag-based discovery |
| [MCP](docs/mcp.md) | Server registration, tool calls, human queue, compiled workflows as tools |
| [Cloud Deployment](docs/cloud.md) | AWS ECS, GCP Cloud Run, Docker configurations |
| [Data Model](docs/data.md) | Database schema and tables |
| [Contributing](docs/contributing.md) | Development setup and guidelines |

### API Reference

[Workflows](docs/api/workflows.md) | [Tasks](docs/api/tasks.md) | [Escalations](docs/api/escalations.md) | [Users](docs/api/users.md) | [Roles](docs/api/roles.md) | [MCP Servers](docs/api/mcp-servers.md) | [Maintenance](docs/api/maintenance.md) | [DBA](docs/api/dba.md) | [Exports](docs/api/exports.md)

## Install

```bash
npm install @hotmeshio/long-tail @hotmeshio/hotmesh
```

## License

See [LICENSE](LICENSE).
