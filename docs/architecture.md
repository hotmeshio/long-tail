# Architecture

This document describes how Long Tail organizes workflows, activities, and MCP servers. It covers the three-tier project structure, the convention that makes activities and tools interchangeable, the system capabilities that ship by default, the built-in MCP servers, and how to register your own code. For a higher-level overview and quick start guide, see the [README](../README.md).

## Contents

- [Project Structure](#project-structure)
- [The Convention](#the-convention)
- [Three Workflow Types](#three-workflow-types)
- [System Capabilities](#system-capabilities)
  - [Tag-Based Tool Discovery](#tag-based-tool-discovery)
  - [System Workflows](#system-workflows)
- [Built-in MCP Servers](#built-in-mcp-servers)
- [Registering Your Own](#registering-your-own)

## Project Structure

Long Tail organizes workflows, activities, and MCP servers into three tiers that follow the same conventions:

```
system/          Always ships. The built-in tool inventory.
├── activities/    Vision, DB queries, HTTP fetch, file storage, ...
├── workflows/     mcpQuery pipeline, mcpTriage pipeline
└── mcp-servers/   Built-in MCP servers wrapping the activities

examples/        Opt-in demos. Seed with `examples: true`.
├── workflows/     review-content, verify-document, process-claim, ...
└── types/

your-app/        Your workflows. Same conventions, your directory.
├── activities/    Your activity functions (= your MCP tools)
├── workflows/     Your workflow functions
└── index.ts       Barrel export of workers[]
```

**System** workflows and tools are always available. Two 3-tier pipelines handle all dynamic work: **mcpQuery** (router → deterministic | dynamic) fulfills arbitrary requests using MCP tools, and **mcpTriage** (router → deterministic | dynamic) handles AI-assisted remediation when humans can't resolve an escalation. Each pipeline has a router that checks for compiled workflows before falling back to a dynamic agentic loop.

**Examples** demonstrate the patterns. They seed the dashboard with working scenarios on first run.

**Your code** follows the same structure. Register workers via `start()`:

```typescript
import { start } from '@hotmeshio/long-tail';
import { myWorkers } from './my-app';

const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [...myWorkers],
  examples: true,
});
```

All three tiers follow the same directory conventions. The next section explains that convention and why it matters.

## The Convention

Every tier follows the same structure. Activities are where side effects live. Workflows are deterministic functions that call activities. MCP servers are thin wrappers that expose activities as tools.

```
<dir>/
├── activities/       Side-effect functions — each one IS an MCP tool
│   └── analyzer.ts   export async function classify(args) { ... }
├── workflows/
│   └── my-flow/
│       ├── index.ts       Workflow function (deterministic)
│       └── orchestrator.ts  executeLT() wrapper for composition
└── mcp-servers/
    └── analyzer.ts    Wraps activities/analyzer.ts as an MCP server
```

The key insight: **activities are tools and tools are activities**. Write a function that classifies a document. Register it as an activity in your workflow. The same function, wrapped in an MCP server, becomes a tool that any LLM agent can call. When the triage agent uses your tool to fix an edge case, the successful sequence gets compiled into a deterministic workflow — and that workflow becomes a new tool.

```typescript
// activities/analyzer.ts — this function IS a tool
export async function classify(args: { content: string }) {
  const response = await llm.analyze(args.content);
  return { category: response.category, confidence: response.confidence };
}

// workflows/classify-content/index.ts — calls the activity
const { classify } = Durable.workflow.proxyActivities<typeof activities>({
  activities,
});

export async function classifyContent(envelope: LTEnvelope) {
  const result = await classify(envelope.data);
  if (result.confidence >= 0.85) {
    return { type: 'return', data: result };
  }
  return { type: 'escalation', data: result, message: 'Low confidence', role: 'reviewer' };
}

// mcp-servers/analyzer.ts — exposes the activity as a tool
server.tool('classify', schema, async (args) => activities.classify(args));
```

With this convention in place, the system ships with a set of built-in capabilities that demonstrate the pattern.

## Three Workflow Types

Long Tail has three distinct workflow types. The dashboard's **Workflow Registry** page shows each with a visual badge.

### Durable

Any function registered as a HotMesh worker is durable. This is the baseline tier:

- **Checkpointed execution** — activity results are persisted in PostgreSQL; crashes resume from the last checkpoint.
- **Automatic retries** — failed activities retry according to their retry policy.
- **IAM context** — the caller's identity propagates through the execution envelope.

A durable workflow has no entry in `lt_config_workflows`. It runs, but without interceptor tracking, escalation chains, or task records. In the dashboard, durable workflows display a **Workflow** icon with a "Durable" label.

### Certified

A certified workflow is durable plus the full Long Tail control plane. It has an entry in `lt_config_workflows`, which activates:

- **Interceptor wrapping** — every execution is tracked as a task in `lt_tasks` with full audit trail.
- **Escalation chains** — returning `{ type: 'escalation' }` creates a reviewable record, routes to the correct role, and triggers re-runs on resolution.
- **Never-fail guarantee** — unhandled errors are caught and surfaced as error escalations.
- **Invocation controls** — `invocable: true` exposes the workflow for external invocation via the API and dashboard.
- **Execution identity** — roles, default assignees, and `execute_as` overrides are defined in the config.

In the dashboard, certified workflows display a **ShieldCheck** icon with a "Certified" label in accent blue. Promote a durable workflow to certified by creating a config entry; de-certify by removing it. The workflow code does not change.

### Pipeline

A pipeline workflow is a compiled deterministic workflow generated from a successful dynamic execution. The compilation pipeline extracts the tool-call sequence from an `mcpQuery` or `mcpTriage` run and produces a YAML DAG that replays the same steps without an LLM.

- **No LLM per step** — the DAG executes tool calls directly with pre-wired data flow.
- **Discoverable as a tool** — deployed pipelines become MCP tools that any workflow or agent can invoke.
- **Automatic routing** — the `mcpQueryRouter` and `mcpTriageRouter` discover compiled pipelines via full-text search and tag matching, routing requests to the deterministic path when confidence is high.

Pipeline workflows are stored in `lt_yaml_workflows` with status lifecycle: `draft` → `deployed` → `active` → `archived`. In the dashboard, pipeline workflows display a **Wand2** (magic wand) icon in purple.

See the [Compilation Pipeline](compilation.md) guide for the full lifecycle and the [Workflows Guide](workflows.md) for detailed coverage of all three types.

## System Capabilities

### Tag-Based Tool Discovery

Every MCP server is tagged with categories (`database`, `vision`, `http`, `storage`, etc.). Workflows discover tools by tag rather than hard-coding server names:

```typescript
// mcpQuery discovers all tools (or filters by user-provided tags)
const servers = await findServersByTags(tags, 'any');

// scoped discovery — only database-tagged tools
const servers = await findServersByTags(['database', 'analytics'], 'any');
```

Tags are GIN-indexed in PostgreSQL for fast lookup. Register a new MCP server tagged `analytics` and mcpQuery automatically picks up its tools. Register one tagged `vision` and mcpTriage can use it for remediation. The tool inventory grows without code changes.

### System Workflows

| Pipeline | Workflows | Purpose |
|----------|-----------|---------|
| **mcpQuery** | `mcpQueryRouter` → `mcpDeterministic` \| `mcpQuery` | General-purpose MCP orchestration. Router discovers compiled workflows; routes to deterministic (if match) or dynamic agentic loop. |
| **mcpTriage** | `mcpTriageRouter` → `mcpTriageDeterministic` \| `mcpTriage` | Escalation remediation. Same 3-tier pattern — router checks for compiled solutions before falling back to dynamic triage. |

**mcpQuery** is the general-purpose entry point. Ask it to "take a screenshot of example.com" and it uses Playwright tools. Ask it to "fetch the latest exchange rates and save to a file" and it chains HTTP fetch with file storage. Once a useful sequence is discovered, it can be compiled into a deterministic workflow and deployed as a new tool.

Engineers can register external servers — Playwright for browser automation, file storage, custom APIs. The triage agent can even recommend that engineers add a new MCP server when it encounters a capability gap. Every server's tools become available as proxy activities in deterministic workflows and as callable tools in dynamic triage.

The built-in servers are the starting inventory.

## Built-in MCP Servers

Long Tail ships with the following built-in servers:

| Server | Purpose |
|--------|---------|
| `long-tail-db-query` | Query tasks, escalations, process summaries, system health |
| `long-tail-human-queue` | Route work to humans, check resolution, claim/resolve, escalate-and-wait |
| `mcp-workflows-longtail` | Discover and invoke compiled workflow tools |
| `long-tail-workflow-compiler` | Convert executions to YAML, deploy, list |
| `long-tail-translation` | Translate content between languages |
| `long-tail-vision` | Analyze and describe images using LLM vision |
| `long-tail-playwright` | Low-level browser automation |
| `long-tail-playwright-cli` | High-level browser automation |
| `long-tail-docs` | Search and read product documentation |
| `long-tail-file-storage` | Read, write, list, and delete files |
| `long-tail-http-fetch` | HTTP requests, JSON/text fetch |
| `long-tail-oauth` | OAuth token management |
| `long-tail-claude-code` | Agentic coding via Claude Code CLI |

Each server can provide `compile_hints` — tool-specific constraints stored in the database that guide the compilation pipeline when converting dynamic executions into deterministic workflows.

For details on managing servers via the REST API or at startup, see [docs/mcp.md](mcp.md).

To add your own tools to this inventory, follow the same convention.

## Registering Your Own

Follow the same convention as `system/` and `examples/`. Create a barrel export of your workers:

```typescript
// my-app/index.ts
import * as myWorkflow from './workflows/my-workflow';
import * as myOrch from './workflows/my-workflow/orchestrator';

export const myWorkers = [
  { taskQueue: 'my-queue', workflow: myWorkflow.myWorkflow },
  { taskQueue: 'my-queue-orch', workflow: myOrch.myWorkflowOrchestrator },
];
```

Register at startup:

```typescript
import { start } from '@hotmeshio/long-tail';
import { myWorkers } from './my-app';

const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [...myWorkers],
  mcp: { server: { enabled: true } },
  escalation: { strategy: 'mcp' },
});
```

Your activities become tools. Your tools become available to triage. Triage solutions become compiled workflows. Compiled workflows become tools. The cycle continues.
