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
    "transport": "socketio",
    "natsWsUrl": null,
    "reconnect": { "initialDelayMs": 1000, "maxDelayMs": 60000, "noticeAfterMs": 30000, "spreadMs": 5000 }
  },
  "auth": {
    "sso": false,
    "ssoLogoutUrl": null
  },
  "ai": {
    "enabled": true
  },
  "branding": {
    "appName": "LongTail"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `telemetry.traceUrl` | `string \| null` | Template string where `{traceId}` is replaced with the actual trace ID to build a link to the trace viewer. Returns `null` if no trace URL is configured. |
| `escalation.claimDurations` | `number[]` | Available claim duration options in minutes. Used by the frontend to populate duration selectors. Configurable via the `LT_CLAIM_DURATION_OPTIONS` environment variable (JSON array). |
| `events.transport` | `'socketio' \| 'nats' \| 'none'` | Dashboard event transport. Defaults to `socketio`. Reports `nats` only when `EVENT_TRANSPORT=nats` is set and a NATS adapter is registered. |
| `events.natsWsUrl` | `string \| null` | NATS WebSocket URL for browser connections. Only present when a NATS adapter is registered. Read from `NATS_WS_URL`. |
| `events.reconnect.initialDelayMs` | `number` | First delay before the dashboard retries a dropped event connection. Read from `NATS_RECONNECT_INITIAL_MS` (default `1000`). |
| `events.reconnect.maxDelayMs` | `number` | Upper bound on the retry delay as it backs off. Read from `NATS_RECONNECT_MAX_MS` (default `60000`). |
| `events.reconnect.noticeAfterMs` | `number` | How long the connection may stay down before the dashboard shows a notice. Read from `NATS_LIVE_NOTICE_AFTER_MS` (default `30000`). |
| `events.reconnect.spreadMs` | `number` | Window the first retry after a drop, and the catch-up refetch after reconnecting, are spread across, so tabs return gradually after a deploy. Read from `NATS_RECONNECT_SPREAD_MS` (default `5000`). |
| `auth.sso` | `boolean` | Whether SSO is configured for embedded deployments. When `true`, the dashboard auto-exchanges host auth for an LT JWT instead of showing the login form. |
| `auth.ssoLogoutUrl` | `string \| null` | URL to redirect the browser on logout. Set by the host via `sso.logoutUrl` in the startup config. When `null`, the dashboard shows its own login page on logout. |
| `ai.enabled` | `boolean` | Whether an LLM API key is configured. When `false`, the dashboard hides AI-specific features (pipelines designer, AI assistant, triage). |
| `branding.appName` | `string` | The product name shown in the dashboard header. Configured via `branding.appName` in the startup config; defaults to `"LongTail"`. |

## Get NATS credentials

```
GET /api/nats-credentials
```

**Auth:** Requires authentication.

Returns the connection details the dashboard uses to subscribe to NATS events.

**Response 200:**

```json
{
  "natsWsUrl": "wss://example.com/nats?ticket=...",
  "natsToken": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `natsWsUrl` | `string \| null` | NATS WebSocket URL. Behind the WebSocket proxy, the URL carries a `ticket` query parameter for the caller, valid for `NATS_WS_TICKET_TTL_SECONDS` (default `300`). `null` when no NATS adapter is registered. |
| `natsToken` | `string \| null` | `null` behind the WebSocket proxy, since the proxy holds the NATS credential and the ticket allows subscribing only. For direct connections, `NATS_DASHBOARD_TOKEN` when set, else `NATS_TOKEN`. |
