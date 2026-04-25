# SDK

Long Tail exposes its full API as an in-process SDK. Every operation available through the REST API can be called directly as a function — same validation, same RBAC, same event publishing — without HTTP transport overhead.

Use the SDK when Long Tail runs as an embedded package inside your own application (NestJS, Next.js, Express, or any Node.js process). The HTTP server, socket.io, and dashboard are optional — disable them and call the SDK directly.

## Setup

```typescript
import { start, createClient } from '@hotmeshio/long-tail';

// Start without HTTP server
await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  workers: [{ taskQueue: 'default', workflow: myWorkflow.handler }],
});

// Create a client with a default auth context
const lt = createClient({ auth: { userId: 'my-service' } });
```

The `auth` context binds to every call that requires it. Override per-call when needed:

```typescript
// Uses the default auth ('my-service')
await lt.escalations.list({ status: 'pending' });

// Override for a specific call
await lt.escalations.claim({ id: 'esc_123' }, { userId: 'user-456' });
```

## LTApiResult

Every SDK call returns an `LTApiResult`:

```typescript
interface LTApiResult<T = any> {
  status: number;    // HTTP-equivalent status code (200, 400, 403, 404, 409, 500)
  data?: T;          // Success payload (present when status is 2xx)
  error?: string;    // Error message (present when status is 4xx/5xx)
}
```

Status codes follow the same semantics as the REST API. Check `result.status` to distinguish success from failure:

```typescript
const result = await lt.tasks.get({ id: 'task-123' });

if (result.status === 200) {
  console.log(result.data);  // the task record
} else if (result.status === 404) {
  console.log('not found');
} else {
  console.error(result.error);
}
```

## API Namespaces

The client mirrors the REST route structure:

| Namespace | REST equivalent | Key operations |
|-----------|----------------|----------------|
| `lt.tasks` | `/api/tasks` | `list`, `get`, `listProcesses`, `getProcess`, `getProcessStats` |
| `lt.escalations` | `/api/escalations` | `list`, `listAvailable`, `get`, `claim`, `release`, `resolve`, `escalate`, `bulkClaim`, `bulkAssign` |
| `lt.workflows` | `/api/workflows` | `invoke`, `getStatus`, `getResult`, `terminate`, `listWorkers`, `listDiscovered`, `listConfigs`, `getConfig`, `upsertConfig` |
| `lt.yamlWorkflows` | `/api/yaml-workflows` | `list`, `get`, `create`, `deploy`, `activate`, `invoke`, `archive` |
| `lt.users` | `/api/users` | `list`, `get`, `create`, `update`, `delete`, `getRoles`, `addRole`, `removeRole` |
| `lt.roles` | `/api/roles` | `list`, `listWithDetails`, `create`, `delete`, `getEscalationChains` |
| `lt.auth` | `/api/auth` | `login` |
| `lt.mcp` | `/api/mcp` | `listServers`, `createServer`, `getServer`, `connectServer`, `listTools`, `callTool` |
| `lt.mcpRuns` | `/api/mcp-runs` | `listEntities`, `listJobs`, `getExecution` |
| `lt.insight` | `/api/insight` | `mcpQuery`, `buildWorkflow`, `refineWorkflow`, `describeWorkflow` |
| `lt.exports` | `/api/workflow-states` | `listJobs`, `exportState`, `exportExecution`, `getStatus`, `getState` |
| `lt.controlplane` | `/api/controlplane` | `listApps`, `rollCall`, `throttle`, `getStreamStats` |
| `lt.botAccounts` | `/api/bot-accounts` | `list`, `get`, `create`, `update`, `delete`, `listKeys`, `createKey` |
| `lt.workflowSets` | `/api/workflow-sets` | `create`, `list`, `get`, `updatePlan`, `build`, `deploy` |
| `lt.settings` | `/api/settings` | `get` |
| `lt.dba` | `/api/dba` | `prune`, `deploy` |
| `lt.namespaces` | `/api/namespaces` | `list`, `register` |
| `lt.maintenance` | `/api/config/maintenance` | `getConfig`, `updateConfig` |

## Events

The SDK includes a callback-based event adapter. Subscribe to events directly — no socket.io client, no WebSocket connection.

```typescript
// Exact event type
const unsub = lt.events.on('escalation.claimed', (event) => {
  console.log('claimed:', event.escalationId, 'by:', event.data?.assigned_to);
});

// Category wildcard — matches all task.* events
lt.events.on('task.*', (event) => {
  metrics.increment(`task.${event.type}`);
});

// Global wildcard — every event
lt.events.on('*', (event) => {
  auditLog.append(event);
});

// Unsubscribe when done
unsub();
```

Events fire from the same publish calls that feed socket.io and NATS. The callback adapter runs in-process with zero serialization overhead. All event types documented in [Events](events.md) are available.

### Event types

```
task.created    task.started    task.completed    task.escalated    task.failed
escalation.created    escalation.claimed    escalation.released    escalation.resolved
workflow.started    workflow.completed    workflow.failed
activity.started    activity.completed    activity.failed
milestone
```

## Running Alongside an HTTP Server

The SDK works whether or not the HTTP server is running. If your application already has its own Express/Fastify/Koa server, you can start Long Tail without its built-in server and expose routes however you like:

```typescript
// Your NestJS controller
@Controller('workflows')
export class WorkflowController {
  private lt = createClient({ auth: { userId: 'nest-service' } });

  @Post(':type/invoke')
  async invoke(@Param('type') type: string, @Body() body: any) {
    return this.lt.workflows.invoke({ type, data: body.data });
  }

  @Get(':id/status')
  async status(@Param('id') id: string) {
    return this.lt.workflows.getStatus({ workflowId: id });
  }
}
```

## CallbackEventAdapter

If you need lower-level control over event subscriptions, use the `CallbackEventAdapter` directly:

```typescript
import { eventRegistry, CallbackEventAdapter } from '@hotmeshio/long-tail';

const adapter = new CallbackEventAdapter();
eventRegistry.register(adapter);
await adapter.connect();

// Subscribe
const unsub = adapter.on('task.completed', (event) => { ... });

// Unsubscribe
unsub();
```

The `createClient()` function manages this automatically — you only need the adapter directly if you want event subscriptions without the full SDK client.

## Mixing Transports

The event registry supports multiple adapters simultaneously. Events publish to all registered adapters in parallel:

```typescript
await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  events: { nats: { url: 'nats://localhost:4222' } },  // NATS for external consumers
});

const lt = createClient({ auth: { userId: 'system' } });

// In-process callbacks AND NATS — both receive every event
lt.events.on('task.*', handleTaskLocally);
```
