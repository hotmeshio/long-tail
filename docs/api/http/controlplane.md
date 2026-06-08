# Control Plane API

Admin-only endpoints for application discovery, worker health, throttling, stream statistics, and stream message browsing.

All endpoints require builder access (superadmin role type or engineer role).

---

## List applications

```
GET /api/controlplane/apps
```

List all registered HotMesh application namespaces.

**Response 200:**

```json
{ "apps": [{ "appId": "durable", "version": "1.0.0" }] }
```

---

## Roll call

```
GET /api/controlplane/rollcall?app_id=durable&delay=2000
```

Discover all running engines and workers for an application by broadcasting a ping.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `string` | No | Application namespace (default: `durable`) |
| `delay` | `number` | No | Milliseconds to wait for responses |

**Response 200:**

```json
{ "profiles": [{ "engine_id": "...", "worker_topic": "...", "throttle": 0 }] }
```

---

## Throttle

```
POST /api/controlplane/throttle
```

Apply a throttle rate to workflow execution across the mesh.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appId` | `string` | No | Application namespace (default: `durable`) |
| `throttle` | `number` | Yes | Delay in ms per message (`-1` = pause, `0` = resume) |
| `topic` | `string` | No | Scope throttle to a specific worker topic |
| `guid` | `string` | No | Scope throttle to a specific engine/worker GUID |

**Response 200:**

```json
{ "success": true }
```

---

## Stream statistics

```
GET /api/controlplane/streams?app_id=durable&duration=1h&stream=hmsh:durable:w:
```

Throughput and backlog metrics for engine and worker streams.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `string` | No | Application namespace (default: `durable`) |
| `duration` | `string` | No | Time window: `15m`, `30m`, `1h`, `1d`, `7d` (default: `1h`) |
| `stream` | `string` | No | Filter to a specific stream name |

**Response 200:**

```json
{
  "pending": 12,
  "processed": 340,
  "byStream": [
    { "stream_type": "engine", "stream_name": "hmsh:durable:x:", "count": 88 },
    { "stream_type": "worker", "stream_name": "hmsh:durable:w:default", "count": 16 }
  ]
}
```

---

## Browse stream messages

```
GET /api/controlplane/stream-messages?namespace=durable&source=worker
    &limit=25&offset=0&sort_by=created_at&order=desc
    &status=pending&stream_name=hmsh:durable:w:&msg_type=WORKER
```

Browse messages from a single stream table. Engine and worker streams are separate tables with different schemas and must never be commingled in a single query. Both `namespace` and `source` are required.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | `string` | **Yes** | Postgres schema / application namespace |
| `source` | `string` | **Yes** | Stream type: `engine` or `worker` |
| `limit` | `number` | No | Page size, 1–100 (default: `25`) |
| `offset` | `number` | No | Pagination offset (default: `0`) |
| `sort_by` | `string` | No | Sort column: `created_at`, `stream_name`, `priority`, `id` (default: `created_at`) |
| `order` | `string` | No | Sort direction: `asc` or `desc` (default: `desc`) |
| `status` | `string` | No | Filter: `pending`, `claimed`, `processed`, `dead_lettered` |
| `stream_name` | `string` | No | Partial match on stream name (ILIKE) |
| `msg_type` | `string` | No | Filter by message type (worker streams only) |

**Status derivation:**

Messages have no explicit status column. Status is derived from timestamps:

| Status | Condition |
|--------|-----------|
| `dead_lettered` | `dead_lettered_at IS NOT NULL` |
| `processed` | `expired_at IS NOT NULL` |
| `claimed` | `reserved_at IS NOT NULL` |
| `pending` | All timestamps NULL |

**Response 200:**

```json
{
  "messages": [
    {
      "id": "42",
      "source": "worker",
      "stream_name": "hmsh:durable:w:default",
      "message": "{\"type\":\"WORKER\",\"metadata\":{...}}",
      "status": "processed",
      "created_at": "2026-05-23T14:30:00.000Z",
      "reserved_at": "2026-05-23T14:30:01.000Z",
      "reserved_by": "worker-abc",
      "expired_at": "2026-05-23T14:30:02.000Z",
      "dead_lettered_at": null,
      "priority": 0,
      "visible_at": "2026-05-23T14:30:00.000Z",
      "retry_attempt": 0,
      "max_retry_attempts": 3,
      "workflow_name": "my-workflow",
      "jid": "job-123",
      "aid": "greet",
      "dad": "",
      "msg_type": "WORKER",
      "topic": "default"
    }
  ],
  "total": 1247
}
```

Engine messages have `null` for worker-only fields (`workflow_name`, `jid`, `aid`, `dad`, `msg_type`, `topic`).

---

## Subscribe to mesh events

```
POST /api/controlplane/subscribe
```

Start the quorum-to-NATS bridge for an application so mesh events are forwarded to the dashboard.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appId` | `string` | No | Application namespace (default: `durable`) |

**Response 200:**

```json
{ "subscribed": true, "appId": "durable" }
```
