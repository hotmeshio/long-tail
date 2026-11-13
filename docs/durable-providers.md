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
  data?: Record<string, unknown>;   // the resolver payload; on expiry, a collection when one was kept
  resolvedBy?: string;
  resolvedAt?: string;
}
```

`conditional()` returns the payload when resolved; the collection when an accumulator or `partialOnTimeout` batch expires; `false` on any other expiry; `null` when cancelled, the same as HotMesh.

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

With a non-HotMesh provider, `start()` refuses configuration that needs HotMesh workflows: workflow functions in `workers`, `examples` and `escalation.strategy: 'mcp'`.

## Registering and invoking workflows

A provider that starts workflows (`capabilities.start` and `provider.start`) gets the same registry, Invoke Tool and schedules HotMesh has. Register each workflow by name in `workers`; the engine runs its own workers, so Long Tail only stores the config:

```ts
await start({
  durable: { provider: temporalProvider({ address: 'temporal:7233', namespace: 'default' }) },
  workers: [{
    taskQueue: 'orders',
    workflow: 'reviewOrder',
    config: {
      invocable: true,
      description: 'Review an order',
      invocationRoles: ['reviewer'],
      inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
    },
  }],
});
```

`taskQueue` is the engine's queue: the Temporal task queue, or the DBOS queue name. Configs can also be registered from the dashboard's Registry page, `PUT /api/workflows/:type/config` or the `upsert_workflow_config` MCP tool.

An invoke (`POST /api/workflows/:type/invoke`, the Invoke Tool, the `invoke_workflow` MCP tool, an `x-lt-invoke` form widget or an agent reaction) runs the same checks as on HotMesh: `invocable`, invocation roles, bot scopes, the input schema and `execute_as`. Long Tail then calls `provider.start` with one argument, the envelope:

```json
{
  "data": { "orderId": "42" },
  "metadata": { "source": "dashboard" },
  "lt": { "userId": "<who invoked>", "principal": { "id": "...", "roles": [] }, "scopes": ["workflow:invoke"] }
}
```

Long Tail's own workflows, such as `capabilityInvoke`, which agent capability reactions start, run on HotMesh inside Long Tail and start there under any provider. `GET /api/workflows/:id/result` finds their runs too.

A config with `cronSchedule` starts the workflow on that schedule, on every engine. Each tick reads the config as stored at that moment, so every container starts the run with the same `envelopeSchema`, `executeAs` and task queue. Saving a config leaves its schedule running unless the schedule itself changes; a changed, removed or re-enabled schedule moves to a new cron job (`lt_workflow_crons`), and deleting the config stops it. A workflow that returns `{ data }` shows that payload in the Invoke Tool when it completes; `GET /api/workflows/:id/result` returns whatever the workflow returned.

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
| 404 | `originId` or `parentId` names no escalation the caller can read |
| 409 | `signalKey` is held by another wait or escalation |
| 501 | No provider is configured; HotMesh workflows call `conditional()` directly |

`metadata` holds the queryable facets and is validated against the role. `data` is shown to the resolver. `expiresAt` is the SLA.

The other fields match what HotMesh's `conditional()` writes:

| Field | Effect |
|---|---|
| `envelope` | Render-only data for the form: `formDefaults` prefills it, `confidence` drives `x-lt-confidence`, and any key is readable as `envelope.*`. Keys starting `batch_` or `accumulate_` are reserved |
| `lookups` | Knowledge entries the form reads, stored as `envelope.lookups`. Pass it here or in `envelope`, not both |
| `files` | Stored files the form shows, stored as `envelope.files` |
| `schemaVersion` | The role form version the resolve UI renders, stored as `metadata.schema_version` |
| `assignee` | Assigns the escalation when it is created; others can still claim it |
| `durationMinutes` | With `assignee`, claims the escalation for that many minutes, timed by the database clock |
| `originId`, `parentId` | Lineage for claim groups and `x-lt-transition`. Each must name an escalation the caller can read (`404` otherwise); with both, `originId` must be the parent's origin |
| `signalKey` | Addresses the wait on the signal-key surfaces (below) |

Opening the same wait again returns the first escalation unchanged.

### Signal keys

A wait opened with `signalKey` is addressed by key, as a HotMesh escalation is: `POST /api/escalations/resolve-by-signal-key`, `accumulate-by-signal-key`, `remove-item-by-signal-key`, `resolve-batch-item-by-signal-key`, `GET /api/escalations/items-by-signal-key`, a reciprocal named by `signalKey`, and the matching MCP tools. Long Tail looks the key up in `lt_durable_waits` and acts on the escalation by id, and the relay delivers the outcome.

A key is unique across waits and HotMesh escalations for the life of the row; a key already held answers `409`. The escalation row itself carries no `signal_key`, so the escalation store never tries to wake HotMesh for it.

### Batch and accumulate waits

A wait can collect many items into one escalation, with the same declarations HotMesh's `conditional()` takes. Long Tail stores the row in the shape HotMesh writes, so every item surface works on it: `resolve_batch_item`, `accumulate_item`, flags, resolve by metadata, and the dashboard.

| Field | Meaning |
|---|---|
| `batch` | Item keys, filled once each. The last fill resolves the wait with every item: `{ [itemKey]: payload }` |
| `filled` | Batch items already satisfied, keyed by item: `{ payload, at, actor? }` |
| `wakeOnFill` | A fill ends the wait with the items so far, plus `$filled`, `$filledAt`, `$filledBy` and `$trigger: 'fill'`. `true` for every key, or a list |
| `wakeOnFlag` | A flagged item ends the wait |
| `partialOnTimeout` | On expiry the outcome carries the items filled so far and `$trigger: 'timeout'` |
| `accumulate` | `{ max?, resolveAtMax?, unique? }`. Collects any item keys. The outcome carries `$accumulated` (items in arrival order) and `$trigger`: `count` at `max`, `timeout` on expiry, `resolve` when a person resolves it |

`batch` and `accumulate` are exclusive, and the `batch_*` and `accumulate_*` metadata keys are reserved. An invalid declaration answers `400` before anything is written.

An expired accumulator, or an expired batch with `partialOnTimeout`, delivers its collection in `data` with `status: 'expired'`. Every other expiry delivers no `data`.

## Delivery

The relay runs in every Long Tail container:

- It runs when an escalation is resolved or cancelled, and on a sweep (`relay.sweepMs`) that also runs at startup.
- It leases each undelivered terminal wait, so concurrent containers deliver it once.
- `provider.deliver` returns `delivered`, or `gone` when the workflow no longer exists. A thrown error is retried with capped exponential backoff, and the error is kept on the wait.
- Every resolve surface delivers the same way: the dashboard, the HTTP API, the MCP tools, bulk resolve, resolve-by-metadata and scan rules.
- The sweep expires pending waits whose `expiresAt` has passed and delivers `expired`, with the collection for an accumulator or a `partialOnTimeout` batch.
- Reconcile asks the provider for each workflow with a pending escalation. When the workflow is no longer running, Long Tail cancels the escalation.
- Opening a wait again after its outcome was delivered clears the delivery, so the outcome is sent again. This covers an engine that re-runs the wait without its checkpoint.
- After a delivery, the relay checks the workflow with `provider.describe` at growing intervals for about 25 seconds. When the engine reports it closed, Long Tail publishes `workflow.completed` or `workflow.failed`, the events HotMesh publishes, so the dashboard's workflow pages refresh. A workflow still running after that refreshes on its next escalation event.

Waits are stored in `lt_durable_waits`, one row per wait, keyed by the escalation id.

## The dashboard and API with a provider

The escalation, role, identity and admin surfaces work the same on every engine.

| Endpoint | Behavior with a provider |
|---|---|
| `GET /api/workflow-states/jobs` | The executions list from `provider.list`, in the same shape HotMesh returns. `search` is a workflow id prefix, `entity` one workflow type, `status` one of `running`, `completed`, `failed`; `namespace`, `registered` and sorting do not apply |
| `GET /api/workflow-states/:id/execution` | The execution timeline from `provider.export`, in the same shape HotMesh returns |
| `POST /api/workflows/:id/terminate` | `provider.terminate`, then the workflow's pending escalations are cancelled |
| `GET /api/workflows/:id/describe` | `provider.describe`: the workflow's state, type and times |
| `GET /api/workflows/:id/result` | `202` while running; once closed, the result from `provider.export` |
| `GET`, `PUT`, `DELETE /api/workflows/:type/config`, `GET /api/workflows/config`, `/discovered`, `/invocable`, `/:type/input-lookups`, `/cron/status` | The workflow registry. `/discovered` lists the registered configs |
| `POST /api/workflows/:type/invoke` | `provider.start` with the envelope; `501` when the provider does not start workflows |

These routes answer `501` with the provider's name, because they read or start HotMesh workflows:
- `/tasks`, `/controlplane`, `/dba`, `/pipelines`, `/yaml-workflows`, `/insight`, `/workflow-sets`, `/namespaces`, `/diagnostics` and `/config/maintenance`
- the other `/workflows` and `/workflow-states` routes
- `/escalations/bulk-triage`

The matching MCP tools are not registered. Triage never resolves an escalation a provider workflow waits on: bulk triage skips those rows, as it skips HotMesh escalations that have a signal key.

A Temporal activity or DBOS step calls an MCP tool with `POST /api/mcp/servers/:id/tools/:toolName/call`, where `:id` is the server's id or its name.

### Machine lines

Line workflows on Temporal or DBOS import the contracts from `@hotmeshio/long-tail/machines/contracts`: row types, facets, decisions, form schemas, `commandRow`, `commandTarget` and the line roles. Nothing behind that path loads Node built-ins, the database or HotMesh, so it fits a Temporal workflow bundle. The machine gateway resolves command rows and adds hop items by escalation id, so it works on the rows these workflows wait on.

`GET /api/settings` reports the engine, and the dashboard uses it to show or hide its pages:

```json
"engine": {
  "provider": "temporal",
  "native": false,
  "capabilities": { "execution": true, "terminate": true, "list": true, "start": true },
  "consoleUrl": "https://temporal.example.com/namespaces/default/workflows/{workflowId}"
}
```

With `start`, the sidebar shows Registry and Invoke Tool. With `list`, it shows Executions, and the executions page lists the engine's workflows.

## Writing a provider

```ts
import type { LTDurableProvider } from '@hotmeshio/long-tail';

export const myProvider: LTDurableProvider = {
  name: 'my-engine',
  capabilities: { native: false, execution: true, terminate: true, list: true, start: true },
  async deliver(ref, outcome) { /* signal ref.workflowId with outcome; return 'delivered' or 'gone' */ },
  async describe(workflowId) { /* return { workflowId, state, providerState } */ },
  async export(workflowId) { /* return an LTWorkflowExecution; summarizeExecution(events) fills summary */ },
  async terminate(workflowId, reason) { /* stop the workflow */ },
  async list(query) { /* return { workflows, total }: one page, newest first, and the count of every match */ },
  async start({ workflowType, workflowId, taskQueue, args }) { /* start the workflow; args is [envelope] */ },
};
```

The workflow side needs three things:
- open the wait through `POST /api/escalations/waits` from an activity or step that the engine checkpoints,
- wait for the outcome on the key,
- treat the first outcome per key as final.
