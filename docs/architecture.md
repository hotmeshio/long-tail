# Architecture

This document describes how Long Tail organizes workflows, activities, and MCP servers. It covers the three-tier project structure, the convention that makes activities and tools interchangeable, the system capabilities that ship by default, the built-in MCP servers, and how to register your own code. For a higher-level overview and quick start guide, see the [README](../README.md).

## Contents

- [Project Structure](#project-structure)
- [The Convention](#the-convention)
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
├── workflows/     mcp-triage, insightQuery, mcpQuery
└── mcp-servers/   8 built-in MCP servers wrapping the activities

examples/        Opt-in demos. Seed with `examples: true`.
├── workflows/     review-content, verify-document, process-claim, ...
└── types/

your-app/        Your workflows. Same conventions, your directory.
├── activities/    Your activity functions (= your MCP tools)
├── workflows/     Your workflow functions
└── index.ts       Barrel export of workers[]
```

**System** workflows and tools are always available — `mcpTriage` handles AI-assisted remediation when humans can't resolve an escalation, `insightQuery` answers analytics questions using database tools, and `mcpQuery` fulfills arbitrary requests using all available MCP tools.

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

## System Capabilities

### Tag-Based Tool Discovery

Every MCP server is tagged with categories (`database`, `vision`, `http`, `storage`, etc.). Workflows discover tools by tag rather than hard-coding server names:

```typescript
// insightQuery discovers only analytics tools
const servers = await findServersByTags(['database', 'analytics'], 'any');

// mcpQuery discovers all tools (or filters by requested tags)
const servers = await findServersByTags(tags, 'any');
```

Tags are GIN-indexed in PostgreSQL for fast lookup. Register a new MCP server tagged `analytics` and `insightQuery` automatically picks up its tools. Register one tagged `vision` and `mcpTriage` can use it for remediation. The tool inventory grows without code changes.

### System Workflows

| Workflow | Purpose | Tools Used |
|----------|---------|------------|
| `mcpTriage` | Remediate failed escalations using LLM + MCP tools | All (discovered dynamically) |
| `insightQuery` | Answer analytics questions about system state | DB tools (by `database` tag) |
| `mcpQuery` | Fulfill arbitrary requests using all available tools | All (by tag or unfiltered) |

**mcpQuery** is the general-purpose entry point. Ask it to "take a screenshot of example.com" and it uses Playwright tools. Ask it to "fetch the latest exchange rates and save to a file" and it chains HTTP fetch with file storage. Once a useful sequence is discovered, it can be compiled into a deterministic workflow and deployed as a new tool.

Engineers can register external servers — Playwright for browser automation, file storage, custom APIs. The triage agent can even recommend that engineers add a new MCP server when it encounters a capability gap. Every server's tools become available as proxy activities in deterministic workflows and as callable tools in dynamic triage.

The eight built-in servers are the starting inventory.

## Built-in MCP Servers

Long Tail ships with eight built-in servers:

| Server | Tools | Purpose |
|--------|-------|---------|
| `long-tail-human-queue` | 4 | Route work to humans, check resolution, claim and resolve |
| `long-tail-db` | 6 | Query tasks, escalations, process summaries, system health |
| `long-tail-document-vision` | 5 | Rotate pages, extract data, translate, validate members |
| `long-tail-workflow-compiler` | 3 | Convert triage executions to YAML, deploy, list |
| `long-tail-mcp-workflows` | 3 | Discover and invoke compiled workflow tools |
| `long-tail-playwright` | 8 | Browser automation: navigate, screenshot, click, fill, evaluate |
| `long-tail-file-storage` | 4 | Read, write, list, and delete files in managed storage |
| `long-tail-http-fetch` | 3 | HTTP requests, JSON fetch, text fetch for external APIs |

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
