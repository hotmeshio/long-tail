# Settings API

Returns frontend-relevant configuration. No secrets are exposed. This endpoint does not require authentication — it is public so the login page can read configuration before the user has a token.

## Get settings

```
GET /api/settings
```

**Response 200:**

```json
{
  "telemetry": {
    "traceUrl": "https://ui.honeycomb.io/pubsubdb/environments/test/datasets/long-tail/trace?trace_id={traceId}"
  },
  "escalation": {
    "claimDurations": [15, 30, 60, 120, 480]
  },
  "events": {
    "transport": "nats",
    "natsWsUrl": "ws://localhost:8222"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `telemetry.traceUrl` | `string \| null` | Template string where `{traceId}` is replaced with the actual trace ID to build a link to the trace viewer. Returns `null` if no trace URL is configured. |
| `escalation.claimDurations` | `number[]` | Available claim duration options in minutes. Used by the frontend to populate duration selectors. Configurable via the `LT_CLAIM_DURATION_OPTIONS` environment variable (JSON array). |
| `events.transport` | `string \| null` | Event transport type (e.g., `"nats"`). `null` if no event transport is configured. |
| `events.natsWsUrl` | `string \| null` | NATS WebSocket URL for real-time event subscriptions. Only present when NATS is the configured transport. |
