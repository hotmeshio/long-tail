# lt.controlplane

Manage the HotMesh control plane: application discovery, worker health, throttling, and stream statistics.

## listApps

List all registered application namespaces.

```typescript
const result = await lt.controlplane.listApps();
```

**Parameters:** None

**Returns:** `LTApiResult<{ apps: string[] }>`

**Auth:** Not required

---

## rollCall

Query active worker profiles for an application. Sends a roll-call request to the mesh and collects responses within the delay window.

```typescript
const result = await lt.controlplane.rollCall({ appId: 'durable', delay: 2000 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appId` | `string` | No | Application namespace to query (defaults to `'durable'`) |
| `delay` | `number` | No | Milliseconds to wait for worker responses before returning |

**Returns:** `LTApiResult<{ profiles: object[] }>`

**Auth:** Not required

---

## throttle

Apply a throttle rate to workflow execution. Also publishes a synthetic `mesh.throttle` event to the dashboard event stream.

```typescript
const result = await lt.controlplane.throttle({ throttle: 50, topic: 'my-topic' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `throttle` | `number` | Yes | Throttle value to apply |
| `appId` | `string` | No | Application namespace (defaults to `'durable'`) |
| `topic` | `string` | No | Topic to scope the throttle to |
| `guid` | `string` | No | Workflow GUID to scope the throttle to |

**Returns:** `LTApiResult<{ success: boolean }>`

**Auth:** Not required

---

## getStreamStats

Retrieve stream statistics (throughput, backlog) for an application over a time window.

```typescript
const result = await lt.controlplane.getStreamStats({ app_id: 'durable', duration: '30m' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `app_id` | `string` | No | Application namespace (defaults to `'durable'`) |
| `duration` | `string` | No | Time window for stats aggregation, e.g. `'1h'`, `'30m'` (defaults to `'1h'`) |
| `stream` | `string` | No | Specific stream name to filter results |

**Returns:** `LTApiResult<StreamStats>`

**Auth:** Not required

---

## subscribe

Subscribe to mesh events for an application so they are captured and forwarded.

```typescript
const result = await lt.controlplane.subscribe({ appId: 'durable' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appId` | `string` | No | Application namespace to subscribe to (defaults to `'durable'`) |

**Returns:** `LTApiResult<{ subscribed: true, appId: string }>`

**Auth:** Not required
