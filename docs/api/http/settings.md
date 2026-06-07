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
    "natsToken": null
  },
  "auth": {
    "sso": false,
    "ssoLogoutUrl": null
  },
  "ai": {
    "enabled": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `telemetry.traceUrl` | `string \| null` | Template string where `{traceId}` is replaced with the actual trace ID to build a link to the trace viewer. Returns `null` if no trace URL is configured. |
| `escalation.claimDurations` | `number[]` | Available claim duration options in minutes. Used by the frontend to populate duration selectors. Configurable via the `LT_CLAIM_DURATION_OPTIONS` environment variable (JSON array). |
| `events.transport` | `'socketio' \| 'nats' \| 'none'` | Dashboard event transport. Defaults to `socketio`. Reports `nats` only when `EVENT_TRANSPORT=nats` is set and a NATS adapter is registered. |
| `events.natsWsUrl` | `string \| null` | NATS WebSocket URL for browser connections. Only present when a NATS adapter is registered. Read from `NATS_WS_URL`. |
| `events.natsToken` | `string \| null` | NATS auth token for browser connections. Only present when a NATS adapter is registered. Read from `NATS_TOKEN`. |
| `auth.sso` | `boolean` | Whether SSO is configured for embedded deployments. When `true`, the dashboard auto-exchanges host auth for an LT JWT instead of showing the login form. |
| `auth.ssoLogoutUrl` | `string \| null` | URL to redirect the browser on logout. Set by the host via `sso.logoutUrl` in the startup config. When `null`, the dashboard shows its own login page on logout. |
| `ai.enabled` | `boolean` | Whether an LLM API key is configured. When `false`, the dashboard hides AI-specific features (pipelines designer, AI assistant, triage). |
