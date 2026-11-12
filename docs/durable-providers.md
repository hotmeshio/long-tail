# Durable Providers

Long Tail runs the escalation boundary for workflows on any durable engine. HotMesh is built in. Temporal and DBOS plug in through a provider, and their workflows wait on people the same way HotMesh workflows do: with one call, `conditional()`.

The engine owns time and causality. Long Tail owns everything that happens while a workflow waits: the role queue, RBAC, forms, schema enforcement, claims, facets, the SLA and the dashboard. The workflow receives exactly one terminal outcome.

| Engine | Package | Workflow call |
|---|---|---|
| HotMesh | `@hotmeshio/long-tail` | `conditional(signalId, config)` |
| Temporal | `@hotmeshio/long-tail-temporal` | `conditional(key, config)` from `@hotmeshio/long-tail-temporal/workflow` |
| DBOS | `@hotmeshio/long-tail-dbos` | `conditional(key, config)` from `@hotmeshio/long-tail-dbos` |

## The contract

A workflow opens a wait, and Long Tail creates the escalation. When the escalation is resolved, cancelled or expired, Long Tail delivers one outcome:

```ts
interface LTWaitOutcome {
  waitKey: string;
  escalationId: string;
  status: 'resolved' | 'expired' | 'cancelled';
  data?: Record<string, unknown>;   // the resolver payload when resolved
  resolvedBy?: string;
  resolvedAt?: string;
}
```

`conditional()` returns `data` when the escalation is resolved, and `null` when it expired or was cancelled.

A wait is identified by `(provider, workflowId, runScope, waitKey)`, so opening the same wait twice returns the same escalation. Keys are unique per wait within one workflow run, so a loop adds its round to the key.

## Configuration

```ts
import { start } from '@hotmeshio/long-tail';
import { temporalProvider } from '@hotmeshio/long-tail-temporal/provider';

await start({
  database: { connectionString: process.env.DATABASE_URL },
  durable: {
    provider: temporalProvider({ address: 'temporal:7233', namespace: 'default' }),
    consoleUrl: 'https://temporal.example.com/namespaces/default/workflows/{workflowId}',
    relay: { sweepMs: 30_000, reconcileMs: 900_000 },
  },
});
```

| Key | Meaning |
|---|---|
| `provider` | The engine running customer workflows. Omit it for HotMesh. |
| `consoleUrl` | Link to the engine's own console for one workflow. `{workflowId}` is the placeholder. |
| `relay.sweepMs` | Recovery sweep interval. Default 30 s. |
| `relay.leaseMs` | Delivery lease per wait. Default 30 s. |
| `relay.batch` | Waits claimed per pass. Default 50. |
| `relay.reconcileMs` | Interval for closing escalations whose workflow has ended. Default 15 min; `0` turns it off. |

With a non-HotMesh provider, `start()` refuses configuration that needs HotMesh workflows: `workers`, `examples` and `escalation.strategy: 'mcp'`.

## Opening a wait

Each provider package's `conditional()` calls this endpoint through an activity or a step. It authenticates as a service account (bot API key) that has write access to the target role.

`POST /api/escalations/waits`

```json
{
  "workflowId": "order-123",
  "runScope": "<engine run id, optional>",
  "workflowType": "reviewOrder",
  "waitKey": "review-order-123",
  "role": "reviewer",
  "type": "order-review",
  "description": "Review order 123",
  "priority": 2,
  "metadata": { "orderId": "order-123" },
  "data": { "risk": 0.42 },
  "expiresAt": "2026-11-13T12:00:00.000Z"
}
```

| Status | Meaning |
|---|---|
| 201 | Created. `{ escalationId, status: 'pending', created: true }` |
| 200 | The wait already exists. The existing row is returned with `created: false` |
| 400 | The body is invalid, or `metadata` does not match the role's `metadata_schema` |
| 403 | The caller lacks write access to the role |
| 501 | No provider is configured; HotMesh workflows call `conditional()` directly |

`metadata` holds the queryable facets and is validated against the role. `data` is shown to the resolver. `expiresAt` is the SLA.

## Delivery

The relay runs in every Long Tail container:

- It runs when an escalation is resolved or cancelled, and on a sweep (`relay.sweepMs`) that also runs at startup.
- It leases each undelivered terminal wait, so concurrent containers deliver it once.
- `provider.deliver` returns `delivered`, or `gone` when the workflow no longer exists. A thrown error is retried with capped exponential backoff, and the error is kept on the wait.
- Every resolve surface delivers the same way: the dashboard, the HTTP API, the MCP tools, bulk resolve, resolve-by-metadata and scan rules.
- The sweep expires pending waits whose `expiresAt` has passed and delivers `expired`.
- Reconcile asks the provider for each workflow with a pending escalation. When the workflow is no longer running, Long Tail cancels the escalation.
- Opening a wait again after its outcome was delivered clears the delivery, so the outcome is sent again. This covers an engine that re-runs the wait without its checkpoint.

Waits are stored in `lt_durable_waits`, one row per wait, keyed by the escalation id.

## The dashboard and API with a provider

The escalation, role, identity and admin surfaces work the same on every engine.

| Endpoint | Behavior with a provider |
|---|---|
| `GET /api/workflow-states/:id/execution` | The execution timeline from `provider.export`, in the same shape HotMesh returns |
| `POST /api/workflows/:id/terminate` | `provider.terminate`, then the workflow's pending escalations are cancelled |
| `GET /api/workflows/:id/describe` | `provider.describe`: the workflow's state, type and times |

These routes answer `501` with the provider's name, because they read or start HotMesh workflows:
- `/tasks`, `/controlplane`, `/dba`, `/pipelines`, `/yaml-workflows`, `/insight`, `/workflow-sets`, `/namespaces`, `/diagnostics` and `/config/maintenance`
- the other `/workflows` and `/workflow-states` routes
- `/escalations/bulk-triage`

The matching MCP tools are not registered.

`GET /api/settings` reports the engine, and the dashboard uses it to show or hide its pages:

```json
"engine": {
  "provider": "temporal",
  "native": false,
  "capabilities": { "execution": true, "terminate": true },
  "consoleUrl": "https://temporal.example.com/namespaces/default/workflows/{workflowId}"
}
```

## Writing a provider

```ts
import type { LTDurableProvider } from '@hotmeshio/long-tail';

export const myProvider: LTDurableProvider = {
  name: 'my-engine',
  capabilities: { native: false, execution: true, terminate: true },
  async deliver(ref, outcome) { /* signal ref.workflowId with outcome; return 'delivered' or 'gone' */ },
  async describe(workflowId) { /* return { workflowId, state, providerState } */ },
  async export(workflowId) { /* return an LTWorkflowExecution; summarizeExecution(events) fills summary */ },
  async terminate(workflowId, reason) { /* stop the workflow */ },
};
```

The workflow side needs three things:
- open the wait through `POST /api/escalations/waits` from an activity or step that the engine checkpoints,
- wait for the outcome on the key,
- treat the first outcome per key as final.
