# lt.settings

Platform settings for the current deployment.

## get

Return platform settings including telemetry configuration, escalation claim duration options, and event transport details.

```typescript
const result = await lt.settings.get();
```

**Parameters:** None

**Returns:** `LTApiResult<{ telemetry, escalation, events, auth, ai, branding }>`

| Field | Type | Description |
|-------|------|-------------|
| `telemetry.traceUrl` | `string \| null` | Trace URL for the telemetry provider |
| `escalation.claimDurations` | `number[]` | Available claim duration options (minutes) |
| `events.transport` | `'socketio' \| 'nats' \| 'none'` | Dashboard event transport (default: `socketio`; `nats` when `EVENT_TRANSPORT=nats`) |
| `events.natsWsUrl` | `string \| null` | NATS WebSocket URL (present when NATS adapter registered) |
| `events.reconnect` | `{ initialDelayMs, maxDelayMs, noticeAfterMs }` | Dashboard reconnect timing in ms (`NATS_RECONNECT_INITIAL_MS` default `1000`, `NATS_RECONNECT_MAX_MS` default `60000`, `NATS_LIVE_NOTICE_AFTER_MS` default `30000`) |
| `auth.sso` | `boolean` | Whether SSO is configured for embedded deployments |
| `auth.ssoLogoutUrl` | `string \| null` | Host logout URL (redirected to on dashboard sign out) |
| `ai.enabled` | `boolean` | Whether an LLM API key is configured |
| `branding.appName` | `string` | Product name shown in the dashboard header (defaults to `"LongTail"`) |

**Auth:** Not required
