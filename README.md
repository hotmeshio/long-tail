# Long Tail Workflows

**Durable AI workflows with human-in-the-loop escalation. Powered by PostgreSQL.**

Long Tail (LT) is a framework for building applied AI systems where failure is not an option. When AI works, things move fast. When it doesn't, the work flows seamlessly to humans — no messages lost, no state corruption, no infrastructure to manage.

Built on [HotMesh](https://github.com/hotmeshio/sdk-typescript), a Temporal-style workflow engine that uses PostgreSQL as its only dependency. No app server. No Redis. No Temporal cluster. Just your database.

## Table of Contents

- [The Problem](#the-problem)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Core Concepts](#core-concepts)
  - [The Envelope](#the-envelope)
  - [Return Types](#return-types)
  - [Milestones](#milestones)
  - [Task Lifecycle](#task-lifecycle)
  - [Escalation Lifecycle](#escalation-lifecycle)
- [Writing Workflows](#writing-workflows)
  - [The Pattern](#the-pattern)
  - [Activities](#activities)
  - [Nesting Workflows](#nesting-workflows)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Why Not Just Use Temporal?](#why-not-just-use-temporal)

## The Problem

Applied AI is powerful but unpredictable. LLMs hallucinate. Confidence scores vary. Edge cases exist. Most AI pipelines either fail silently or require bespoke retry logic bolted onto fragile infrastructure.

The **long tail** is the work AI can't handle — rare, ambiguous, low-confidence. It's 20% of the volume but 80% of the cost. You need a system that:

- **Never drops work** — every task is tracked from initiation to resolution
- **Escalates automatically** — low confidence? error? route to humans instantly
- **Resumes exactly** — human resolves the issue, workflow picks up where it left off
- **Audits everything** — full trail of AI outputs, human decisions, state transitions
- **Runs on Postgres** — no Temporal server, no Redis, no message broker infrastructure

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

That's it.

### Run

```bash
git clone https://github.com/hotmeshio/long-tail.git
cd long-tail
docker compose up
```

Postgres, NATS, and the API server start together. Migrations run automatically. The server is ready when you see:

```
long-tail-1  | [long-tail] server running on port 3000
```

### Try it

**1. Submit content for AI review** (auto-approves — high confidence):

```bash
curl -s -X POST http://localhost:3000/api/workflows/review-content \
  -H "Content-Type: application/json" \
  -d '{"contentId": "doc-1", "content": "Standard content that passes review."}' | jq
```

**2. Submit content that will escalate** (low confidence — needs a human):

```bash
curl -s -X POST http://localhost:3000/api/workflows/review-content \
  -H "Content-Type: application/json" \
  -d '{"contentId": "doc-2", "content": "REVIEW_ME this needs human eyes"}' | jq
```

**3. Check the escalation queue:**

```bash
curl -s http://localhost:3000/api/escalations?status=pending | jq
```

**4. Resolve it** (the paused workflow resumes automatically):

```bash
curl -s -X POST http://localhost:3000/api/escalations/{id}/resolve \
  -H "Content-Type: application/json" \
  -d '{"resolverPayload": {"approved": true, "note": "Looks good after review"}}' | jq
```

**5. Verify the task completed:**

```bash
curl -s http://localhost:3000/api/tasks?status=completed | jq
```

### Port collisions?

Default ports are `3000` (API), `5432` (Postgres), `4222`/`8222` (NATS). Override any of them:

```bash
LT_PORT=3001 LT_PG_PORT=5433 LT_NATS_PORT=4223 docker compose up
```

### Local development

Edit any file — `ts-node-dev` watches for changes and restarts the server inside the container. Your source is volume-mounted.

## How It Works

Write a workflow. Return a result or an escalation. LT handles the rest.

```typescript
import { MemFlow } from '@hotmeshio/hotmesh';
import type { LTEnvelope, LTReturn, LTEscalation } from '@hotmeshio/long-tail';

import * as activities from './activities';

const { analyzeContent } = MemFlow.workflow.proxyActivities<typeof activities>({
  activities,
});

export async function reviewContent(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  const { content } = envelope.data;

  // AI does the work
  const analysis = await analyzeContent(content);

  // Confident? Ship it.
  if (analysis.confidence > 0.85) {
    return {
      type: 'return',
      data: { approved: true, analysis },
      milestones: [{ name: 'ai_review', value: 'approved' }],
    };
  }

  // Not confident? Humans take over.
  return {
    type: 'escalation',
    data: { content, analysis },
    message: `Review needed (confidence: ${analysis.confidence})`,
  };
}
```

The **LT interceptor** automatically:
1. Creates a task record when the workflow starts
2. Tracks milestones as the workflow progresses
3. On `escalation` — creates an escalation record, pauses the workflow, waits for a human
4. On human resolution — resumes the workflow, completes the task, records the audit trail
5. On `return` — marks the task complete with full result data

No boilerplate. No manual state management. Your workflow reads like a decision tree, because it is one.

## Architecture

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
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐ ┌───▼─────┐ ┌──────▼────────┐
     │   PostgreSQL    │ │  NATS   │ │  Express API  │
     │                 │ │         │ │               │
     │ • HotMesh       │ │ Events  │ │ • Start runs  │
     │ • lt_tasks      │ │         │ │ • Task queue  │
     │ • lt_escalations│ │         │ │ • Resolve     │
     └─────────────────┘ └─────────┘ └───────────────┘
```

Everything runs on **PostgreSQL**. HotMesh uses it for workflow orchestration (durable execution, replay, signals). LT uses it for task tracking and escalation management. NATS provides event streaming for real-time dashboards. The Express API exposes the task queue for human reviewers.

## Core Concepts

### The Envelope

Every LT workflow receives an `LTEnvelope`:

```typescript
interface LTEnvelope {
  data: Record<string, any>;      // Business inputs — your domain data
  metadata: Record<string, any>;  // Control flow, config
  lt?: { ... };                   // Managed by interceptor (don't touch)
  resolver?: Record<string, any>; // Human resolution data (on re-entry)
}
```

### Return Types

Workflows return one of three types:

| Type | Purpose | What Happens |
|------|---------|-------------|
| `{ type: 'return' }` | AI completed successfully | Task marked complete, milestones saved |
| `{ type: 'escalation' }` | Needs human intervention | Escalation created, workflow paused |
| `{ type: 'activity' }` | Activity progress update | Milestones appended to task |

### Milestones

Milestones are progress markers that persist to the task record:

```typescript
return {
  type: 'return',
  milestones: [
    { name: 'document_parsed', value: 'completed' },
    { name: 'confidence_score', value: 0.92 },
    { name: 'entities_extracted', value: { count: 15, types: ['person', 'org'] } },
  ],
  data: result,
};
```

### Task Lifecycle

```
PENDING ──► IN_PROGRESS ──► COMPLETED
                  │
                  └──► NEEDS_INTERVENTION ──► (human resolves) ──► COMPLETED
                  │
                  └──► CANCELLED
```

### Escalation Lifecycle

```
PENDING ──► CLAIMED ──► RESOLVED
   │            │
   │            └──► (claim expires) ──► PENDING
   └──► CANCELLED
```

## Writing Workflows

### The Pattern

Every LT workflow follows the same structure:

```typescript
export async function myWorkflow(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  // 1. Extract business data
  const { input } = envelope.data;

  // 2. Do AI work (via durable activities)
  const result = await someAIActivity(input);

  // 3. Decide: return or escalate
  if (result.isGood) {
    return { type: 'return', data: result, milestones: [...] };
  }
  return { type: 'escalation', data: result, message: 'Needs review' };
}
```

### Activities

Activities are regular async functions. They run outside the deterministic workflow sandbox, so they can do I/O, call APIs, run LLMs:

```typescript
// activities.ts
export async function callLLM(prompt: string): Promise<LLMResult> {
  const response = await openai.chat.completions.create({ ... });
  return parseResponse(response);
}

// workflow.ts
const { callLLM } = MemFlow.workflow.proxyActivities<typeof activities>({
  activities,
  retryPolicy: { maximumAttempts: 3 },
});
```

### Nesting Workflows

LT workflows can call other LT workflows using `execChild`:

```typescript
export async function orchestrator(envelope: LTEnvelope) {
  // Run child workflow and wait for result
  const result = await MemFlow.workflow.execChild({
    workflowName: 'reviewContent',
    args: [childEnvelope],
    taskQueue: 'long-tail',
  });

  // Continue with the result
  return { type: 'return', data: { childResult: result } };
}
```

## API Reference

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/review-content` | Start a content review workflow |
| `GET` | `/api/workflows/:id/status` | Get workflow execution status |
| `GET` | `/api/workflows/:id/result` | Await workflow result |

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
| `GET` | `/api/escalations/:id` | Get escalation details |
| `POST` | `/api/escalations/:id/claim` | Claim an escalation |
| `POST` | `/api/escalations/:id/resolve` | Resolve — resumes the paused workflow |
| `POST` | `/api/escalations/release-expired` | Release expired claims |

## Database Schema

### `lt_tasks`

Tracks every workflow execution:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `workflow_id` | TEXT | HotMesh workflow ID |
| `workflow_type` | TEXT | Workflow function name |
| `lt_type` | TEXT | Abstract workflow type |
| `status` | TEXT | pending / in_progress / completed / needs_intervention / cancelled |
| `priority` | INT | 1 (low) to 4 (urgent) |
| `signal_id` | TEXT | Signal ID for resume coordination |
| `milestones` | JSONB | Array of milestone events |
| `data` | TEXT | Final workflow result (stringified JSON) |
| `envelope` | TEXT | Original input envelope |

### `lt_escalations`

Tracks human intervention requests:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `type` / `subtype` | TEXT | Workflow classification |
| `modality` | TEXT | Escalation modality |
| `status` | TEXT | pending / claimed / resolved / cancelled |
| `role` | TEXT | Target reviewer role |
| `assigned_to` | TEXT | Claimed by user ID |
| `assigned_until` | TIMESTAMPTZ | Claim expiration |
| `task_id` | UUID | FK to lt_tasks |
| `escalation_payload` | TEXT | AI output sent to human |
| `resolver_payload` | TEXT | Human response |

## Project Structure

```
long-tail/
├── index.ts                    # Server entry + package exports
├── types/                      # Core type definitions
│   ├── envelope.ts             # LTEnvelope
│   ├── task.ts                 # LTTaskRecord, LTMilestone
│   ├── escalation.ts           # LTEscalationRecord
│   └── workflow.ts             # LTReturn, LTEscalation, LTActivity
├── interceptor/                # The LT interceptor
│   ├── index.ts                # createLTInterceptor()
│   └── activities.ts           # Durable DB operations
├── services/
│   ├── db/                     # PostgreSQL connection + migrations
│   │   ├── index.ts
│   │   ├── migrate.ts
│   │   └── schemas/
│   │       └── 001_initial.sql # lt_tasks + lt_escalations
│   ├── task.ts                 # Task CRUD
│   └── escalation.ts           # Escalation CRUD
├── routes/                     # Express API
│   ├── tasks.ts                # GET /api/tasks
│   ├── escalations.ts          # GET/POST /api/escalations
│   └── workflows.ts            # POST /api/workflows/*
├── workers/                    # HotMesh worker setup
│   └── index.ts
├── workflows/                  # Example workflows
│   └── review-content/
│       ├── index.ts            # The workflow
│       ├── activities.ts       # AI analysis activity
│       └── types.ts            # Typed inputs/outputs
└── tests/
    └── workflows/
        └── review-content.test.ts
```

## Testing

```bash
# Start Postgres and NATS
docker compose up -d postgres nats

# Run all tests
npm test

# Run workflow tests
npm run test:workflows
```

## Why Not Just Use Temporal?

Temporal is excellent. But it requires a Temporal server cluster, a separate persistence layer, and operational expertise to run in production. For teams building applied AI workflows that need human-in-the-loop patterns, that's a lot of infrastructure for a focused problem.

Long Tail gives you Temporal-style durable execution (deterministic replay, signals, child workflows, retry policies) backed by **PostgreSQL alone** via HotMesh. Add LT's interceptor and you get a complete HITL task queue system — task tracking, escalation management, claim/release, audit trails — with zero additional infrastructure.

If you already have a Postgres database, you already have everything you need.

## License

See [LICENSE](LICENSE).
