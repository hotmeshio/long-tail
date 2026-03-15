# Workflows Guide

Write a function. If AI is confident, the task completes. If not, it escalates — durably, with full context — to whoever should handle it next. This guide covers how to build, compose, and test durable workflows with human-in-the-loop escalation.

## Contents

- [Anatomy of a Workflow](#anatomy-of-a-workflow)
- [Activities and Durable Execution](#activities-and-durable-execution)
- [The Interceptor](#the-interceptor)
- [Escalation Lifecycle](#escalation-lifecycle)
- [Composing Workflows](#composing-workflows)
- [Verify Document Example](#verify-document-example) — full walkthrough
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
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer"],
  "invocable": true
}
```

`is_lt: true` enables the interceptor. `default_role` and `roles` control escalation routing. `invocable: true` exposes the workflow for invocation via the public API.

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
- External services (OpenAI, databases) are not called twice

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

The interceptor is the machinery that connects your workflow code to Long Tail's task tracking, escalation management, and audit trail. When `is_lt: true` is set in the workflow config, the interceptor wraps every workflow execution.

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
  "is_lt": true,
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
  "is_lt": true,
  "is_container": true,
  "default_role": "reviewer",
  "roles": ["reviewer"]
}
```

`is_container: true` tells the interceptor this is an orchestrator, not a leaf workflow. The orchestrator gets its own task record and tracks the lifecycle of its children.

## Verify Document Example

The concepts above — activities, interceptor, escalation, composition — come together in a concrete example. The `verify-document` workflow demonstrates the full pattern: AI does initial work (OpenAI Vision extraction), validates against a database, and escalates to a human when it isn't confident.

### The Pipeline

```
Document images --> Vision extraction --> Database validation --> Match or escalate
```

**Step 1 — List pages.** The workflow loads document page images from storage.

**Step 2 — Extract.** Each page is sent to OpenAI's Vision API (`gpt-4o-mini`) as a durable activity. The prompt asks for structured JSON: member ID, name, address, phone, email, emergency contact.

**Step 3 — Merge.** Multi-page extractions are merged. The primary page (with member ID) provides the base record; partial pages (emergency contact, additional fields) are folded in.

**Step 4 — Validate.** The merged record is compared against the member database. Address fields are checked for exact match. Member status must be `active`.

**Step 5 — Return or escalate.** If everything matches, the workflow returns:

```typescript
return {
  type: 'return',
  milestones: [
    { name: 'pages_processed', value: pages.length },
    { name: 'extraction', value: 'success' },
    { name: 'validation', value: 'match' },
  ],
  data: {
    documentId,
    memberId: merged.memberId,
    extractedInfo: merged,
    validationResult: 'match',
    confidence: 1.0,
  },
};
```

If there's a mismatch or missing data, it escalates with full context:

```typescript
return {
  type: 'escalation',
  data: {
    documentId,
    extractedInfo: merged,        // what Vision saw
    validationResult: 'mismatch', // why it's escalating
    databaseRecord: record,       // what the database has
    reason: 'Address mismatch for MBR-2024-001...',
  },
  message: reason,
  role: 'reviewer',
};
```

### Durable Activities

Each activity (list pages, extract, validate) is wrapped with `proxyActivities()`:

```typescript
const { listDocumentPages, extractMemberInfo, validateMember } =
  Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
    retryPolicy: {
      maximumAttempts: 2,
      backoffCoefficient: 2,
      maximumInterval: '10 seconds',
    },
  });
```

If the process crashes after `extractMemberInfo` completes but before `validateMember` starts, the workflow replays from the last checkpoint. The Vision API is not called again.

### The Orchestrator

The workflow is invoked through a thin orchestrator:

```typescript
import { executeLT } from '@hotmeshio/long-tail';

export async function verifyDocumentOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'verifyDocument',
    args: [envelope],
    taskQueue: 'long-tail-verify',
  });
}
```

The orchestrator creates the task record, starts the child, and waits. If the child escalates, the orchestrator waits for the human to resolve it. When resolved, the child re-runs, completes, and the orchestrator gets the result.

### Running the Tests

```bash
# Vision workflow tests (requires OpenAI API key)
OPENAI_API_KEY=sk-... npm run test:vision

# With verbose output
npx vitest run tests/workflows/verify-document.test.ts --reporter=verbose
```

### MCP-Native Variant

The same pipeline also exists as an MCP-native workflow (`verify-document-mcp`) where every activity routes through MCP tools instead of calling functions directly. See the [MCP Guide](mcp.md#mcp-native-workflow) for that perspective.

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
    args: [{ data: { documentId: 'DOC-001' }, metadata: {} }],
    taskQueue: 'test-queue',
    workflowName: 'verifyDocument',
    workflowId,
    expire: 120,
  });

  // Poll until the escalation appears (async workflow timing varies)
  const escalations = await waitForEscalation(workflowId);
  expect(escalations.length).toBe(1);
  expect(escalations[0].status).toBe('pending');

  // Resolve — triggers a re-run
  await resolveEscalation(escalations[0].id, {
    documentId: 'DOC-001',
    memberId: 'MBR-2024-001',
    verified: true,
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

# Verify-document workflow (requires OpenAI key)
OPENAI_API_KEY=sk-... npm run test:vision

# Full backend suite
npm test
```
