# Workflows Guide

Write a function. If AI is confident, the task completes. If not, it escalates — durably, with full context — to whoever should handle it next. This guide covers how to build, compose, and test durable workflows with human-in-the-loop escalation.

## Three Workflow Types

Long Tail distinguishes three workflow types based on how they are created and how much infrastructure wraps the execution.

### Durable

Any function registered as a HotMesh worker is durable. This is the baseline tier and it provides:

- **Checkpointed execution** — activity results are persisted in PostgreSQL; crashes resume from the last checkpoint, not the beginning.
- **Automatic retries** — failed activities retry according to their retry policy.
- **IAM context** — the caller's identity propagates through the execution envelope.

A durable workflow is a plain async function. No config entry, no interceptor involvement. Register a worker, start the workflow, get a result. In the dashboard, durable workflows display a Workflow icon with a "Durable" label.

### Certified

A certified workflow is durable plus the full Long Tail control plane. It has an entry in the `lt_config_workflows` table with `certified: true`, which activates:

- **Interceptor wrapping** — every execution is tracked as a task in `lt_tasks` with full audit trail.
- **Escalation chains** — returning `{ type: 'escalation' }` creates a reviewable record, routes to the correct role, and triggers re-runs on resolution.
- **Never-fail guarantee** — unhandled errors are caught and surfaced as error escalations. Nothing disappears silently.
- **Invocation controls** — `invocable: true` exposes the workflow for external invocation via the API and dashboard.
- **Execution identity** — roles, default assignees, and `execute_as` overrides are defined in the config.

In the dashboard, certified workflows display a ShieldCheck icon with a "Certified" label in accent blue. Durable workflows display a muted "Durable" badge. Both are invocable from the same **Invoke Tool** page; the distinction is how much operational infrastructure backs them.

To certify a workflow, create a config entry with the `certified` flag:

```
PUT /api/workflows/myWorkflow/config
{ "certified": true, "default_role": "reviewer", "roles": ["reviewer"], "invocable": true }
```

A registration with `certified: false` is the "Registered" tier — invocation controls and schema-driven forms, without interceptor tracking. To de-certify, save the config with `certified: false` (roles and consumes stay on the row for re-certification). To unregister entirely, delete the config; the workflow remains durable.

The `roles` list is the interceptor default for who can claim and resolve interceptor-raised escalations. Escalations raised in workflow code choose their own role at the escalation boundary, and that role's versioned escalation schema takes precedence over anything on the workflow config.

### Pipeline

A pipeline workflow is a compiled deterministic workflow. It is generated from a successful dynamic execution (typically an `mcpQuery` or `mcpTriage` run) and stored as a YAML DAG in `lt_yaml_workflows`.

- **No LLM per step** — the DAG executes tool calls directly with pre-wired data flow.
- **Discoverable as a tool** — deployed pipelines become MCP tools that any workflow or agent can invoke.
- **Automatic routing** — the `mcpQueryRouter` discovers compiled pipelines via full-text search and tag matching. When confidence exceeds the threshold, requests go straight to the compiled workflow.
- **Status lifecycle** — `draft` → `deployed` → `active` → `archived`.

In the dashboard, pipeline workflows display a Wand2 (magic wand) icon in purple. They are managed from the **MCP Pipeline Tools** page and created through the **Pipeline Designer**.

See the [Compilation Pipeline](https://github.com/hotmeshio/long-tail/blob/main/docs/donotpublish/compilation.md) guide for the full lifecycle from dynamic execution to deployed pipeline.

## Contents

- [Anatomy of a Workflow](#anatomy-of-a-workflow)
- [Activities and Durable Execution](#activities-and-durable-execution)
- [The Interceptor](#the-interceptor)
- [Escalation Lifecycle](#escalation-lifecycle)
- [Composing Workflows](#composing-workflows)
- [Worked Example](#worked-example): AI review with human escalation
- [Milestones](#milestones)
- [Roles](#roles)
- [Testing](#testing)

## Anatomy of a Workflow

A workflow is a function that receives an envelope, does work, and returns a result or an escalation.

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
    return {
      type: 'return',
      data: { ...envelope.data, resolution: envelope.resolver },
      milestones: [{ name: 'human_review', value: 'resolved' }],
    };
  }

  const analysis = await analyzeContent(envelope.data.content);

  if (analysis.confidence >= 0.85) {
    return {
      type: 'return',
      data: { approved: true, analysis },
      milestones: [{ name: 'ai_review', value: 'approved' }],
    };
  }

  return {
    type: 'escalation',
    data: { content: envelope.data.content, analysis },
    message: `Review needed (confidence: ${analysis.confidence})`,
    role: 'reviewer',
  };
}
```

Three things to notice:

1. **`proxyActivities()`** wraps side-effect functions as durable, checkpointed activities (more on this in [Activities and Durable Execution](#activities-and-durable-execution))
2. **`envelope.resolver`** — when present, this is a re-run after human resolution; return the human's decision as the final result
3. **Two return types** — `{ type: 'return' }` completes the task; `{ type: 'escalation' }` pauses and creates an escalation record

### Registration

Before a workflow can run, Long Tail needs to know about it. Register a workflow config so the interceptor knows how to route escalations:

```
PUT /api/workflows/reviewContent/config

{
  "default_role": "reviewer",
  "roles": ["reviewer"],
  "invocable": true
}
```

`default_role` and `roles` control escalation routing. `invocable: true` exposes the workflow for invocation via the public API.

### Starting a Workflow

```typescript
const handle = await lt.client.workflow.start({
  args: [{ data: { contentId: '123', content: 'Review this' }, metadata: {} }],
  taskQueue: 'my-queue',
  workflowName: 'reviewContent',
  workflowId: `review-${Date.now()}`,
  expire: 86_400,
});

const result = await handle.result();
```

## Activities and Durable Execution

The workflow above delegates its side effect — calling the LLM — to `analyzeContent` through `proxyActivities`. Activities are where all I/O lives: API calls, LLM invocations, database reads, file operations. They run outside the deterministic sandbox so they can interact with the outside world.

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

### Checkpointing

When an activity completes, its result is checkpointed in PostgreSQL. If the process crashes:

- Activities that already completed are **not re-executed** — their cached results are replayed
- The workflow resumes from the **last checkpoint**, not the beginning
- An activity that was **mid-flight** at the crash is redelivered once its stream reservation lapses (`HMSH_RESERVATION_TIMEOUT_S`, ~90s worst case) and **re-executes** — delivery is at-least-once, so activity side effects (HTTP calls, bookings, emails) should be idempotent

This is what `proxyActivities()` provides. The raw function becomes a durable checkpoint:

```typescript
const { analyzeContent, extractDocument } =
  Durable.workflow.proxyActivities<typeof activities>({
    activities,
    retryPolicy: {
      maximumAttempts: 2,
      backoffCoefficient: 2,
      maximumInterval: '10 seconds',
    },
  });
```

### Retry Policies

Activities retry automatically on failure. Configure the policy per proxy:

| Field | Default | Description |
|-------|---------|-------------|
| `maximumAttempts` | 1 | Total attempts before giving up |
| `backoffCoefficient` | 2 | Multiplier between retries |
| `maximumInterval` | `'30 seconds'` | Cap on delay between retries |

If all retries are exhausted, the workflow receives the error and can escalate.

## The Interceptor

With the workflow written and activities checkpointed, the next question is: what happens when the workflow returns `{ type: 'escalation' }` instead of `{ type: 'return' }`? That's where the interceptor comes in.

The interceptor is the machinery that connects your workflow code to Long Tail's task tracking, escalation management, and audit trail. When a workflow is registered with a config, the interceptor wraps every execution.

### What It Does

1. **Creates a task record** in `lt_tasks` when the workflow starts
2. **Inspects the return value** when the workflow completes
3. **If `{ type: 'return' }`** — marks the task as completed, persists milestones
4. **If `{ type: 'escalation' }`** — creates an escalation record in `lt_escalations`, pauses
5. **On resolution** — starts a new workflow execution with `envelope.resolver` populated
6. **Signals the parent** (if orchestrated) with the final result

### The Re-run Pattern

This is the core escalation lifecycle:

```
Workflow runs --> returns { type: 'escalation' }
                          |
                  Interceptor creates escalation record
                          |
                  Workflow is done (not paused -- done)
                          |
                  Human claims and resolves the escalation
                          |
                  Interceptor starts a NEW workflow execution
                  with envelope.resolver = human's payload
                          |
                  Workflow checks if (envelope.resolver)
                  and returns the human's decision
                          |
                  Task completes
```

The workflow itself is stateless between runs. The interceptor manages the state transition. This means the same workflow function handles both the initial AI pass and the human-resolved re-run — the `if (envelope.resolver)` check at the top is the only branching needed.

### Error Handling

If a workflow throws an unhandled error (instead of returning an escalation), the interceptor catches it and creates an error escalation automatically. This prevents silent failures — every error surfaces as a reviewable escalation with the error details.

## Escalation Lifecycle

The interceptor creates escalation records and manages re-runs, but what does the full lifecycle look like from the outside? Here's the sequence from the REST API perspective.

### 1. Workflow Escalates

The workflow returns:

```typescript
return {
  type: 'escalation',
  data: { content, analysis },
  message: 'Review needed (confidence: 0.72)',
  role: 'reviewer',
};
```

The interceptor creates a record in `lt_escalations` with the full payload, the target role, and a `pending` status.

### 2. Reviewer Checks the Queue

```
GET /api/escalations/available?role=reviewer
```

```json
{
  "escalations": [
    {
      "id": "esc-abc123",
      "workflow_type": "reviewContent",
      "message": "Review needed (confidence: 0.72)",
      "data": { "content": "...", "analysis": { "confidence": 0.72 } },
      "role": "reviewer",
      "status": "pending"
    }
  ]
}
```

The escalation carries everything the AI tried and why it wasn't confident.

### 3. Claim

Claiming locks the escalation so no one else picks it up. The lock is time-boxed — if the reviewer doesn't finish, it goes back to the queue automatically:

```
POST /api/escalations/esc-abc123/claim

{ "durationMinutes": 30 }
```

### 4. Resolve

The reviewer makes their decision. This triggers a new workflow execution with the resolver's payload:

```
POST /api/escalations/esc-abc123/resolve

{
  "resolverPayload": {
    "approved": true,
    "notes": "Content is fine, AI was overly cautious"
  }
}
```

### 5. Workflow Re-runs

The interceptor starts a new execution. This time `envelope.resolver` is populated:

```typescript
if (envelope.resolver) {
  return {
    type: 'return',
    data: { ...envelope.data, resolution: envelope.resolver },
    milestones: [{ name: 'human_review', value: 'resolved' }],
  };
}
```

The task completes. The escalation is marked resolved. The audit trail captures the full chain: initial AI pass, escalation, human resolution, final result.

### Expired Claims

If a reviewer claims an escalation but doesn't resolve it within the lock duration, the claim expires and the escalation returns to the queue. Run the cleanup endpoint to release expired claims:

```
POST /api/escalations/release-expired
```

## Composing Workflows

A single workflow handles one task — extract a document, validate a record, review content. But real processes chain multiple tasks together, and any step might escalate. Orchestrators coordinate child workflows, each of which can independently succeed or escalate without blocking the others.

### `executeLT`

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

`executeLT` starts the child workflow, creates a task record, and waits for the result. If `extractDocument` escalates to a human, the orchestrator waits. When the escalation is resolved, it resumes and runs `validateExtraction`. No polling, no callbacks — just sequential code.

### How It Works

Under the hood, `executeLT`:

1. Creates a task record with routing metadata
2. Starts the child workflow with a **severed connection** (isolated from the parent)
3. Waits for a signal from the child's interceptor
4. Records the result on the task

The severed connection means the child can escalate, fail, and be re-run multiple times without affecting the parent. The parent only resumes when the child completes successfully.

### Data Sharing Between Siblings

Children that share an `originId` can read each other's completed data automatically. Declare what a workflow `consumes` in its config:

```
PUT /api/workflows/validateExtraction/config

{
  "default_role": "reviewer",
  "roles": ["reviewer"],
  "consumes": ["extractDocument"]
}
```

When `validateExtraction` runs, Long Tail injects sibling results into `envelope.lt.providers`:

```typescript
export async function validateExtraction(envelope: LTEnvelope) {
  // Data from the extractDocument sibling, injected automatically
  const extractionData = envelope.lt?.providers?.extractDocument;

  // Use it alongside the direct input
  const validation = await validate(envelope.data, extractionData);
  // ...
}
```

No manual threading required. The orchestrator doesn't need to pass data between children explicitly.

### Orchestrator Registration

Register the orchestrator as a container workflow:

```
PUT /api/workflows/processDocumentOrchestrator/config

{
  "default_role": "reviewer",
  "roles": ["reviewer"]
}
```

The orchestrator gets its own task record and tracks the lifecycle of its children.

## Worked Example

`examples/workflows/review-content` brings the concepts above together: an activity asks an AI model to review content, the workflow approves it when the model is confident, and escalates to a `reviewer` otherwise. The interceptor tracks the task and the escalation, and resolving the escalation completes the run. Its test is `tests/workflows/review-content.test.ts`.

## Escalation Strategies

The standard escalation path covers most cases: workflow escalates, human resolves, workflow re-runs. But sometimes the resolver can't fix the problem directly — an upside-down page, a corrupted image, a document in the wrong language. These aren't judgment calls; they're process gaps that need remediation before the workflow can retry.

Escalation strategies are a pluggable layer that intercepts resolution and decides what happens next:

- **Default strategy** — always re-runs the original workflow with the resolver's payload (today's behavior)
- **MCP strategy** — checks `resolverPayload._lt.needsTriage`; if set, routes to the `mcpTriage` workflow that calls MCP tools to remediate, then re-invokes the original workflow with corrected data

```typescript
await start({
  database: { ... },
  workers: [ ... ],
  escalation: { strategy: 'mcp' },
});
```

When the resolver flags `needsTriage`, the triage workflow:

1. Queries all upstream tasks for the `originId` to understand what happened
2. Reads the `_lt.hint` to determine which tools to call
3. Calls MCP tools (e.g., `rotate_page` to fix an upside-down image)
4. Re-invokes the failed workflow with corrected data
5. Signals back through standard channels to the original parent orchestrator

The deterministic path is always the default. MCP triage is opt-in. See [Escalation Strategies](escalation-strategies.md) for the full guide.

## Milestones

As workflows run and escalations resolve, you often want external systems to know what happened. Milestones are structured markers that workflows emit at key decision points:

```typescript
return {
  type: 'return',
  data: { approved: true },
  milestones: [{ name: 'ai_review', value: 'approved' }],
};
```

Milestones are persisted on the task record and published to any registered event adapters (NATS, SNS, Kafka, webhooks). External systems can react to workflow progress in real time — trigger notifications, update dashboards, or feed analytics — without polling.

When a human resolves an escalation, the interceptor automatically appends `escalated` and `resolved_by_human` milestones, so you always know which tasks went through human review.

## Roles

Roles connect workflows to people. When a workflow escalates to the `reviewer` role, every user assigned that role sees it in their queue. Roles are implicit — they exist the moment you reference them.

A role appears in two places: the [workflow config](api/workflows.md#create-or-replace-a-workflow-configuration) (`default_role` and `roles`) and the [user record](api/roles.md) (assigned via the roles API).

### Role Types

| Type | Permissions |
|------|-------------|
| `member` | Claim and resolve escalations for this role |
| `admin` | Everything a member can do, plus manage users within this role |
| `superadmin` | Full access — manage all roles, all users, system configuration |

A user can hold multiple roles with different types. See the [Users](api/users.md) and [Roles](api/roles.md) API docs for assignment examples.

## Testing

### Worker Setup

Tests follow a consistent pattern: connect, migrate, register interceptors, create a worker, run workflows.

The simplest approach uses `registerLT`, which handles the activity worker, workflow interceptor, and activity interceptor in one call:

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';

import { migrate } from '../../services/db/migrate';
import { registerLT } from '../../services/interceptor';
import * as myWorkflow from '../../workflows/my-workflow';

const { Connection, Client, Worker } = Durable;

beforeAll(async () => {
  const connection = { class: Postgres, options: postgres_options };

  await Connection.connect(connection);
  await migrate();

  // Register interceptors (activity worker + workflow + activity interceptors)
  await registerLT(connection, { taskQueue: 'lt-interceptor' });

  // Create workflow worker
  const worker = await Worker.create({
    connection,
    taskQueue: 'test-queue',
    workflow: myWorkflow.myWorkflow,
  });
  await worker.run();

  client = new Client({ connection });
});

afterAll(async () => {
  Durable.clearInterceptors();
  Durable.clearActivityInterceptors();
  await Durable.shutdown();
});
```

For finer control, you can register each piece individually. This is what the actual test files do:

```typescript
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';

// 1. Activity worker for interceptor DB operations
await Durable.registerActivityWorker(
  { connection, taskQueue: 'lt-interceptor' },
  interceptorActivities,
  'lt-interceptor',
);

// 2. Workflow interceptor (escalation, routing, re-runs)
Durable.registerInterceptor(createLTInterceptor({
  activityTaskQueue: 'lt-interceptor',
}));

// 3. Activity interceptor (milestone event publishing)
Durable.registerActivityInterceptor(createLTActivityInterceptor());
```

### Testing Escalation

To test a workflow that escalates, start the workflow, wait for the escalation to appear, then resolve it:

```typescript
import { waitForEscalation } from '../setup';
import { resolveEscalation } from '../setup/resolve';

it('should escalate and resolve', async () => {
  const workflowId = `test-${Durable.guid()}`;

  await client.workflow.start({
    args: [{ data: { contentId: 'CONTENT-001', content: 'Borderline post', contentType: 'text' }, metadata: {} }],
    taskQueue: 'test-queue',
    workflowName: 'reviewContent',
    workflowId,
    expire: 120,
  });

  // Poll until the escalation appears (async workflow timing varies)
  const escalations = await waitForEscalation(workflowId);
  expect(escalations.length).toBe(1);
  expect(escalations[0].status).toBe('pending');

  // Resolve — triggers a re-run
  await resolveEscalation(escalations[0].id, {
    contentId: 'CONTENT-001',
    approved: true,
    humanNote: 'Reviewed and approved',
  });

  // Wait for the re-run to complete, then verify
  const resolved = await waitForEscalationStatus(
    escalations[0].id, 'resolved', 30_000,
  );
  expect(resolved.status).toBe('resolved');
});
```

The test utilities are in `tests/setup/`: `waitForEscalation()` and `waitForEscalationStatus()` in `index.ts`, `resolveEscalation()` in `resolve.ts`.

### Running Tests

```bash
# All workflow tests (~4-5 min)
npm run test:workflows

# Full backend suite
npm test

# Fast backend tests: skips tests/workflows and *.llm.test.ts, blanks LLM keys
npm run test:fast

# Tests that call a live model
npm run test:llm
```

---

## From Durable to DAG

Every durable workflow you write is a candidate for compilation. The `ltc` CLI reads your workflow source and produces an equivalent YAML DAG that runs without replay overhead.

```bash
ltc compile workflows/my-workflow.ts
```

The durable code is the spec — developer-friendly, familiar, testable with standard tools. The compiled YAML is the optimized execution path — each step fires exactly once, state is plucked explicitly from upstream activities, no replay loop.

```
  my-workflow.ts              →  my-workflow.compiled.yaml
  (write and test here)           (deploy and run this)
```

Write procedural because it's productive. Compile because it's fast. See the [Compiler Guide](https://github.com/hotmeshio/long-tail/blob/main/docs/donotpublish/compiler.md) for details.
