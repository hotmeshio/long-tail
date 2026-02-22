# Interceptor

The Long Tail interceptor wraps every registered HotMesh workflow. It reads configuration from the database (via a TTL cache) to decide how each workflow should be handled: as a **container** (orchestrator), a **Long Tail (LT) workflow**, or a plain **pass-through**.

## Lifecycle

```
Workflow starts
      |
      v
  Load config (ltGetWorkflowConfig — cached, 5-min TTL)
      |
      +-- is_container? --> Wrap next() in orchestrator context --> return
      |
      +-- is_lt: false? --> Pass through (next()) --> return
      |
      +-- No config entry? --> Pass through (next()) --> return
      |
      v
  LT Workflow Path
      |
  Detect re-run (resolver + escalationId in envelope?)
      |-- Yes: resolve old escalation
      |
  Build InterceptorState
      |
  Execute workflow (next())
      |
      +-- type: 'return'     --> handleCompletion
      |                           Augment milestones (re-run markers)
      |                           Publish milestone events
      |                           Signal parent orchestrator
      |
      +-- type: 'escalation' --> handleEscalation
      |                           Create escalation record
      |                           Workflow ENDS (resolution starts a new workflow)
      |
      +-- unhandled error    --> handleErrorEscalation
                                  Convert to escalation record
                                  Workflow ENDS
```

## What You Get for Free

When a workflow is registered with `is_lt: true` in `lt_config_workflows`:

- **Escalation management** — Return `{ type: 'escalation' }` and the interceptor creates an escalation record with full routing context. When a human (or AI) resolves it, a new workflow starts and the interceptor reconnects the dots automatically.
- **Error escalation** — Unhandled errors are caught and converted to escalation records so nothing is silently lost.
- **Re-run detection** — The interceptor detects when a workflow is a re-run (resolver data in the envelope), resolves the old escalation, and lets the workflow retry.
- **Parent signaling** — On completion, the interceptor signals the parent orchestrator (if any) so `executeLT`'s `waitFor` resolves.
- **Milestone events** — Milestones in the workflow return value are published to all registered event adapters (NATS, SNS, etc.) via the events service.
- **Activity-level milestones** — The activity interceptor inspects proxied activity results for a `milestones` field and publishes them as `source: 'activity'` events.

## Config-Driven Routing

The `lt_config_workflows` table controls behavior:

| Column | Effect |
|--------|--------|
| `is_container: true` | Interceptor wraps the workflow in orchestrator context (for `executeLT` to read parent routing) |
| `is_lt: true` | Full LT treatment: task tracking, escalation, re-runs, signaling |
| `is_lt: false` | Pass-through: interceptor calls `next()` and returns |
| No config entry | Pass-through (with legacy orchestrator detection for backward compatibility) |

## File Map

| File | Purpose |
|------|---------|
| `index.ts` | Main interceptor factory (`createLTInterceptor`) — routing logic |
| `activity-interceptor.ts` | Activity interceptor factory — inspects activity results for milestones |
| `state.ts` | `InterceptorState` type, `buildStoredEnvelope`, `extractEnvelope` |
| `completion.ts` | `handleCompletion` — milestone augmentation, event publishing, parent signaling |
| `escalation.ts` | `handleEscalation`, `handleErrorEscalation` — escalation record creation |
| `context.ts` | `AsyncLocalStorage` for orchestrator context propagation |
| `activities/` | Proxy activities that bridge the durable sandbox to DB operations |
| `activities/config.ts` | Config lookup via TTL cache (`ltGetWorkflowConfig`, `ltGetProviderData`) |
| `activities/task.ts` | Task CRUD (`ltCreateTask`, `ltCompleteTask`, `ltGetTaskByWorkflowId`, etc.) |
| `activities/escalation.ts` | Escalation CRUD (`ltCreateEscalation`, `ltResolveEscalation`) |
| `activities/workflow.ts` | Workflow ops (`ltStartWorkflow`, `ltSignalParent`, `ltGenerateWorkflowId`) |
