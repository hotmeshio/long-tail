# Long Tail

**AI and humans, working the same queue.**

Your team already has processes. Policies. People. AI doesn't replace that — it joins the team. Long Tail is the workflow engine that makes this real: durable, transactional workflows where AI handles the routine work, and everything it can't handle flows to the right person (or the right AI) automatically.

No work is dropped. No state is lost. Every task is tracked from start to finish. And the only infrastructure you need is PostgreSQL.

## Why This Matters

The hard part of adopting AI isn't the model. It's the **process around the model**.

Every enterprise has business processes — approval chains, compliance checks, document reviews, data validation. These processes exist for good reasons: regulatory requirements, quality standards, institutional knowledge. You can't just hand them to an LLM and hope for the best.

The realistic path is **BPM-first**: start AI on the granular, well-defined tasks where confidence is measurable. Content classification. Data extraction. Document validation. Let the existing workforce handle the judgment calls — the ambiguous, high-stakes, long-tail work that requires human context. Then evolve the boundary over time as trust is earned and models improve.

Long Tail gives you the machinery to do this. Write a workflow. If AI is confident, the work completes. If not, it escalates — durably, transactionally, with full context — to whoever should handle it next.

## Who Resolves Escalations?

Anyone. That's the point.

The escalation queue is just an API. Who consumes it is a deployment decision, not an architectural one:

- **A human team** using a purpose-built SPA — your HITL reviewers triaging a queue of AI-flagged items
- **Another AI agent** consuming from the same API with its own RBAC role — a more capable model, a specialized system, a domain-specific pipeline
- **A hybrid** — AI does a first pass on the escalation, then routes to a human for final sign-off

And it works in the other direction too. A workflow can call out to a human team for input, then use AI to validate what comes back. The system doesn't care who's on either end. It cares that the work gets done, the state is consistent, and the audit trail is complete.

This is the sociotechnical shape of AI in the enterprise: not AI *or* humans, but AI *alongside* humans, as team members with different roles and capabilities. Particularly in regulated industries where policy is immutable, this isn't optional — it's the only way forward.

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

### Try It

**1. Submit content for AI review** (auto-approves — high confidence):

```bash
curl -s -X POST http://localhost:3000/api/workflows/review-content \
  -H "Content-Type: application/json" \
  -d '{"contentId": "doc-1", "content": "Standard content that passes review."}' | jq
```

**2. Submit content that will escalate** (low confidence — needs intervention):

```bash
curl -s -X POST http://localhost:3000/api/workflows/review-content \
  -H "Content-Type: application/json" \
  -d '{"contentId": "doc-2", "content": "REVIEW_ME this needs human eyes"}' | jq
```

**3. Check the escalation queue:**

```bash
curl -s http://localhost:3000/api/escalations?status=pending | jq
```

**4. Resolve it** (the workflow resumes and completes automatically):

```bash
curl -s -X POST http://localhost:3000/api/escalations/{id}/resolve \
  -H "Content-Type: application/json" \
  -d '{"resolverPayload": {"approved": true, "note": "Looks good after review"}}' | jq
```

**5. Verify the task completed:**

```bash
curl -s http://localhost:3000/api/tasks?status=completed | jq
```

### Port Collisions?

Default ports are `3000` (API), `5432` (Postgres), `4222`/`8222` (NATS). Override any of them:

```bash
LT_PORT=3001 LT_PG_PORT=5433 LT_NATS_PORT=4223 docker compose up
```

### Local Development

Edit any file — `ts-node-dev` watches for changes and restarts the server inside the container. Your source is volume-mounted.

## Writing a Workflow

A workflow is a function. It receives an envelope, does work (usually via AI), and returns a result or an escalation. That's it.

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
  // On re-entry after human resolution, complete with the resolver's decision
  if (envelope.resolver) {
    return {
      type: 'return',
      data: { ...envelope.data, resolution: envelope.resolver },
      milestones: [{ name: 'human_review', value: 'resolved' }],
    };
  }

  const { content } = envelope.data;

  // AI does the work
  const analysis = await analyzeContent(content);

  // Confident? Ship it.
  if (analysis.confidence >= 0.85) {
    return {
      type: 'return',
      data: { approved: true, analysis },
      milestones: [{ name: 'ai_review', value: 'approved' }],
    };
  }

  // Not confident? Escalate.
  return {
    type: 'escalation',
    data: { content, analysis },
    message: `Review needed (confidence: ${analysis.confidence})`,
    role: 'reviewer',
  };
}
```

The framework handles everything else — task tracking, escalation records, durable pause/resume, audit trails. Your workflow reads like a decision tree because it is one.

### Activities

Activities are where side effects live. They run outside the deterministic workflow sandbox, so they can call APIs, run LLMs, read databases:

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

Activities are automatically retried on failure. Every execution is checkpointed. If the process crashes mid-workflow, it replays from the last checkpoint — not from the beginning.

### Orchestrating Workflows

Workflows can compose other workflows. An orchestrator coordinates child workflows, each of which can independently succeed or escalate:

```typescript
import { executeLT } from '@hotmeshio/long-tail';

export async function processDocument(envelope: LTEnvelope) {
  // Each child is independently durable — if it escalates, the
  // orchestrator waits. When a human resolves, it resumes here.
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

If `extractDocument` escalates to a human, the orchestrator simply waits. When the escalation is resolved, the orchestrator resumes exactly where it left off and runs `validateExtraction`. No polling, no callbacks, no state machines — just sequential code.

## The Escalation Queue

Escalations are the interface between AI and everyone else. When a workflow escalates, a record lands in the queue with full context: what the AI tried, why it wasn't confident, and what it needs from the resolver.

### Claim and Resolve

```bash
# See what's available
curl -s http://localhost:3000/api/escalations/available | jq

# Claim an escalation (30-minute lock)
curl -s -X POST http://localhost:3000/api/escalations/{id}/claim \
  -H "Content-Type: application/json" \
  -d '{"assignedTo": "user-123", "duration": 30}' | jq

# Resolve it — the original workflow resumes automatically
curl -s -X POST http://localhost:3000/api/escalations/{id}/resolve \
  -H "Content-Type: application/json" \
  -d '{"resolverPayload": {"approved": true, "note": "Verified against source"}}' | jq
```

Claims expire. If a reviewer doesn't finish in time, the escalation goes back to the queue. No work gets stuck.

### RBAC

Escalations are routed by role. Users are assigned roles with hierarchical types (`superadmin`, `admin`, `member`), and the queue filters accordingly:

```bash
# Create a reviewer
curl -s -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email": "reviewer@co.com", "displayName": "Jane", "roles": [{"role": "reviewer"}]}' | jq

# Query escalations by role
curl -s http://localhost:3000/api/escalations?role=reviewer&status=pending | jq
```

The same API serves a human-facing SPA, an AI agent with service credentials, or anything else that can make HTTP requests. The role determines what you see, not what you are.

## How It Works Under the Hood

Long Tail is built on [HotMesh](https://github.com/hotmeshio/sdk-typescript), a workflow engine that delivers Temporal-style durable execution using **PostgreSQL as its only dependency**. No Temporal server. No Redis. No message broker infrastructure.

What this means in practice:

- **Durable execution** — workflow state is transactionally persisted to Postgres. Process crashes, deploys, restarts — the workflow resumes from its last checkpoint.
- **Deterministic replay** — workflows replay from persisted state on recovery. Activities (side effects) are only executed once; their results are cached.
- **Signals** — workflows can pause and wait for external events (like a human resolving an escalation), then resume with the signal payload.
- **Child workflows** — compose workflows into pipelines where each step is independently durable and independently escalatable.

The LT interceptor adds the human-in-the-loop layer on top: task tracking, escalation management, claim/release with expiration, milestone recording, and audit trails. All stored in Postgres alongside the workflow state.

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
                        ┌────▼────┐
                        │ Postgres│
                        │         │
                        │ • State │
                        │ • Tasks │
                        │ • Queue │
                        │ • Audit │
                        └─────────┘
```

## API Reference

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workflows/review-content` | Start a content review workflow |
| `POST` | `/api/workflows/verify-document` | Start a document verification workflow |
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
| `GET` | `/api/escalations/available` | Available escalations (pending + unassigned/expired) |
| `GET` | `/api/escalations/:id` | Get escalation details |
| `POST` | `/api/escalations/:id/claim` | Claim an escalation (time-boxed lock) |
| `POST` | `/api/escalations/:id/resolve` | Resolve — resumes the paused workflow |
| `POST` | `/api/escalations/release-expired` | Release expired claims back to the queue |

### Users

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users` | List users (filter by `role`, `status`) |
| `POST` | `/api/users` | Create user with roles |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user |
| `POST` | `/api/users/:id/roles` | Add role to user |
| `DELETE` | `/api/users/:id/roles/:role` | Remove role from user |

## Testing

```bash
# Start Postgres and NATS
docker compose up -d postgres nats

# Run all tests
npm test

# Run workflow tests
npm run test:workflows
```

## License

See [LICENSE](LICENSE).
