# Orchestrator

The orchestrator is a durable map of work. It spawns child workflows, waits for them to complete (via signals), and manages the full task lifecycle. It never needs the child to complete automatically — if all else fails, manually sending the signal will resume it.

## Philosophy

Workflows are **eddies** — vortexes that swirl between AI and human teams until the work completes. The orchestrator doesn't care how many times a child escalates, fails, or gets re-run. It simply waits for the signal. This makes it resilient by design: the parent is always recoverable.

The actual AI-to-human-to-AI loop is handled by the **interceptor**. The orchestrator's job is to coordinate the sequence of work units and track their results.

## executeLT Lifecycle

```
executeLT(options)
      |
  1. Generate child workflow ID (activity, cached across replays)
  2. Create task record with routing metadata
  3. Mark task as in_progress
  4. Load workflow config (cached, 5-min TTL)
  5. Inject provider data into envelope (if consumers configured)
  6. Inject taskId into envelope
      |
  7. Execute onBefore lifecycle hooks (execChild, not LT)
      |
  8. Start child workflow via activity (SEVERED connection)
      |
  9. waitFor signal from child's interceptor
      |       ^
      |       | (child escalates, re-runs, eventually succeeds)
      |       | (interceptor signals back on completion)
      |
  10. Complete task — persist result data + milestones
  11. Publish milestone events (source: 'orchestrator')
      |
  12. Execute onAfter lifecycle hooks
      |
  13. Return result
```

## What You Get for Free

When using `executeLT` from within an orchestrator workflow:

- **Task tracking** — Every child workflow gets a task record in `lt_tasks` with status progression: `pending` -> `in_progress` -> `completed` (or `needs_intervention`).
- **Provider data injection** — If the workflow config declares `consumers`, completed sibling task data is automatically injected into the envelope under `envelope.lt.providers`.
- **Lifecycle hooks** — `onBefore` and `onAfter` hooks run as child workflows (via `execChild`) at the configured points. Use them for validation, notification, cleanup, etc.
- **Severed connection resilience** — The child workflow is started via an activity (not `execChild`), which means the orchestrator is completely decoupled. The child can crash, escalate, and restart without the parent noticing.
- **Milestone events** — When the task completes, milestones are published to all registered event adapters with `source: 'orchestrator'`.
- **Origin ID correlation** — Pass `originId` to `executeLT` and all tasks in the pipeline share a correlation key for provider data lookups.

## Usage

```typescript
import { executeLT } from '../orchestrator';

export async function myPipeline(envelope: LTEnvelope) {
  // Step 1: Verify the document
  const verifyResult = await executeLT({
    workflowName: 'verifyDocument',
    args: [envelope],
    taskQueue: 'long-tail-verify',
    originId: envelope.data.orderId,
  });

  // Step 2: Review the content (can consume verifyDocument's result)
  const reviewResult = await executeLT({
    workflowName: 'reviewContent',
    args: [envelope],
    taskQueue: 'long-tail',
    originId: envelope.data.orderId,
  });

  return reviewResult;
}
```

## File Map

| File | Purpose |
|------|---------|
| `index.ts` | `executeLT` function and `ExecuteLTOptions` type |
