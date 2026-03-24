# Long Tail

Long Tail treats uncertainty as part of the workflow — not as an error, but as an undiscovered pathway. When confidence is low, the task escalates. When a human can't fix it, AI triages with the tools at hand. When AI finds the fix, the solution is compiled into a deterministic workflow so the next occurrence runs automatically — no LLM, no human, no cost.

The system works because everything is treated as a **tool**.

Activities, AI models, human reviewers, and compiled workflows all expose the same interface. A workflow doesn't need to know whether its next step is code, a model, or a person waiting on a screen. The protocol is the same. This is what makes handoffs seamless and what lets the system compose solutions from parts it already has.

## Quick Start

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000) once healthy (~10s). Four workflows seed the dashboard.

| User | Password | Role |
|------|----------|------|
| `superadmin` | `l0ngt@1l` | superadmin |
| `admin` | `l0ngt@1l` | admin |
| `engineer` | `l0ngt@1l` | engineer |
| `reviewer` | `l0ngt@1l` | reviewer |

To reset: `docker compose down -v && docker compose up -d --build`

## Write a Workflow

A **workflow** is a deterministic function. It receives an envelope, makes decisions, and returns a result. If the process crashes mid-execution, the workflow replays from its last checkpoint — no work is lost, no step runs twice.

Register it with Long Tail and the workflow becomes unbreakable. The interceptor wraps every execution in a never-fail vortex: sub-workflows that would normally throw instead escalate, humans and AI collaborate to resolve, and the original workflow resumes with the answer. Nothing is lost.

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

  // A resolved escalation re-enters here with the human's decision
  if (envelope.resolver) {
    return {
      type: 'return',
      data: {
        ...envelope.data,
        resolution: envelope.resolver,
      },
    };
  }

  const analysis = await analyzeContent(envelope.data.content);

  if (analysis.confidence >= 0.85) {
    return {
      type: 'return',
      data: { approved: true, analysis },
    };
  }

  // Low confidence — escalate to a human reviewer
  return {
    type: 'escalation',
    data: {
      content: envelope.data.content,
      analysis,
    },
    message: `Review needed (confidence: ${analysis.confidence})`,
    role: 'reviewer',
  };
}
```

Side effects — API calls, LLM invocations, database queries — live in **activity** functions. The `proxyActivities` call wraps them so the workflow engine can checkpoint each result. If a crash occurs, activities replay from cache rather than re-executing.

## Every Activity is a Tool

The `proxyActivities` call in the workflow above does more than checkpoint `analyzeContent` — it also registers it as an **MCP tool**. The function you write is both a durable workflow step and a tool that any agent, workflow, or compiled pipeline can invoke.

The same is true in reverse: register an MCP server and its tools become proxy activities automatically.

```typescript
// This function is BOTH an activity AND a tool.
// Called by a workflow via proxyActivities, it's checkpointed.
// Exposed via MCP, it's discoverable by agents and other workflows.
export async function classify(args: { content: string }) {
  const response = await llm.analyze(args.content);
  return { category: response.category, confidence: response.confidence };
}
```

Humans are tools too. Long Tail exposes its escalation queue as an MCP server (`long-tail-human-queue`). Compiled workflows are tools. An agent can call a human the same way it calls a database. A human can kick a task to AI the same way they'd assign it to a colleague. The protocol doesn't care who's on either end.

This uniformity is what makes the system composable — and it's what closes the loop from uncertainty to automation.

See the [Architecture Guide](docs/architecture.md) for project structure, conventions, built-in servers, and tag-based tool discovery. See the [MCP Guide](docs/mcp.md) for server registration, tool calls, and the human queue protocol.

## Workflow Function Registration and Startup

Register and start. MCP Servers initialize, workers start, and the API listens. The only infrastructure is PostgreSQL.

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
  workers: [{
    taskQueue: 'my-queue',
    workflow: myWorkflow.reviewContent,
  }],
});

const handle = await lt.client.workflow.start({
  args: [{
    data: { content: 'Review this' },
    metadata: {},
  }],
  taskQueue: 'my-queue',
  workflowName: 'reviewContent',
  workflowId: `review-${Date.now()}`,
});
```

See the full [Workflows Guide](docs/workflows.md) for activities, the interceptor, escalation lifecycle, composition, and testing.

## How the System Evolves

The escalation in the workflow above — `{ type: 'escalation' }` — is where the system starts learning. Four layers work together, each one feeding the next.

### 1. Escalation

When AI isn't confident, the workflow returns `{ type: 'escalation' }`. The interceptor creates a record with full context — what the AI tried, what it saw, why it wasn't sure. A human claims the work through the dashboard or API, resolves it, and the workflow re-runs with their decision.

```
POST /api/escalations/esc-abc123/resolve
{ "resolverPayload": { "approved": true, "notes": "Content is fine" } }
```

Most escalations end here. The human had the judgment the AI lacked. But sometimes the human *can't* fix it — the problem isn't a judgment call, it's a process gap.

### 2. Triage

An upside-down page, a document in the wrong language, a missing API credential — the human flags `needsTriage` with a hint, and an AI triage agent takes over.

Because every activity is a tool, the triage agent already has what it needs. It queries the escalation history, discovers available tools by tag, and runs an agentic loop — rotate the page, re-extract data, call an external API, validate against a database. Every tool call is checkpointed. If the agent can't fix it either, it escalates to an engineer with a full diagnosis. The engineer might install a missing tool, fix a configuration, then send it back. The handoff is always bidirectional — human to AI, AI to human, human to different human — until the problem is resolved and the original workflow gets its answer.

### 3. Compilation — Dynamic to Deterministic

Every dynamic execution — whether from triage, an MCP query, or any agentic workflow — produces a recording of which tools were called, in what order, with what data flow between them. The workflow compiler analyzes that recording and converts it into a deterministic YAML pipeline:

```
Dynamic execution (LLM-driven)                 Compiled workflow (deterministic)
  navigate_to(url)                                step 1: navigate_to
  extract_links(page)                        →    step 2: extract_links
  screenshot(link) × N                            step 3: screenshot (iterates over step 2 output)
```

The compiler detects iteration patterns, traces data provenance between steps, classifies which inputs are dynamic (user-provided) versus fixed (implementation details), and generates a parameterized input schema. A dashboard wizard walks through the full lifecycle: review the original execution, profile the tool pipeline, configure inputs and tags, deploy, test side-by-side against the original, and verify end-to-end.

The compiled workflow deploys as a new MCP tool — tagged for discovery, versioned, and invocable by any agent, workflow, or API call. See the [Compilation Pipeline Guide](docs/compilation.md) for a detailed walkthrough with screenshots.

### 4. Routing — The Loop Closes

Once deployed, the system routes automatically. Every request passes through the `mcpQueryRouter`, which checks: has this problem been solved before?

```
User prompt → Router → Discovery (FTS + tags) → LLM Judge (scope match?)
                 │                                       │
                 │  confidence ≥ 0.7                     │  no match
                 ▼                                       ▼
          mcpDeterministic                          mcpQuery
          (compiled YAML, no LLM)                   (dynamic, LLM agentic loop)
```

The deterministic path skips LLM reasoning entirely — it extracts structured inputs from the prompt, maps them to the compiled workflow's schema, and executes the YAML pipeline directly. What took minutes with an LLM now runs in seconds. What cost tokens now costs nothing.

The dynamic path still works exactly as before — and every dynamic execution is a candidate for compilation. The system accumulates deterministic solutions over time. The inventory of tools grows. The need for LLM reasoning shrinks. Problems that once required a human, then required an AI, eventually require neither.

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

Every cross-cutting concern follows the same pattern: implement a typed interface, register at startup, done. See the [Docs](#docs) section for the full list of guides.

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
| [Compilation Pipeline](docs/compilation.md) | Dynamic → deterministic: full wizard walkthrough with screenshots |
| [Workflows](docs/workflows.md) | Activities, interceptor, escalation lifecycle, composition, testing |
| [Architecture](docs/architecture.md) | Project structure, conventions, built-in MCP servers, tag-based discovery |
| [MCP](docs/mcp.md) | Server registration, tool calls, human queue, compiled workflows as tools |
| [Escalation Strategies](docs/escalation-strategies.md) | Default, MCP triage, and custom escalation handlers |
| [Cloud Deployment](docs/cloud.md) | AWS ECS, GCP Cloud Run, Docker configurations |
| [Data Model](docs/data.md) | Database schema and tables |
| [QA Manual](docs/qa-manual.md) | Golden path walkthrough: setup, triage, compile, deploy, verify |
| [Contributing](docs/contributing.md) | Development setup and guidelines |

### Adapter Guides

[Auth](docs/auth.md) | [Events](docs/events.md) | [Telemetry](docs/telemetry.md) | [Logging](docs/logging.md) | [Maintenance](docs/maintenance.md)

### API Reference

[Workflows](docs/api/workflows.md) | [Tasks](docs/api/tasks.md) | [Escalations](docs/api/escalations.md) | [YAML Workflows](docs/api/yaml-workflows.md) | [Users](docs/api/users.md) | [Roles](docs/api/roles.md) | [MCP Servers](docs/api/mcp-servers.md) | [MCP Runs](docs/api/mcp-runs.md) | [Namespaces](docs/api/namespaces.md) | [Settings](docs/api/settings.md) | [Maintenance](docs/api/maintenance.md) | [DBA](docs/api/dba.md) | [Exports](docs/api/exports.md)

## Install

```bash
npm install @hotmeshio/long-tail @hotmeshio/hotmesh
```

## License

See [LICENSE](LICENSE).
