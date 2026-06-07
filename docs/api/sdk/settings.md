# lt.settings

Platform settings for the current deployment.

## get

Return platform settings including telemetry configuration, escalation claim duration options, and event transport details.

```typescript
const result = await lt.settings.get();
```

**Parameters:** None

**Returns:** `LTApiResult<{ telemetry, escalation, events, auth, ai }>`

| Field | Type | Description |
|-------|------|-------------|
| `telemetry.traceUrl` | `string \| null` | Trace URL for the telemetry provider |
| `escalation.claimDurations` | `number[]` | Available claim duration options (minutes) |
| `events.transport` | `'socketio' \| 'nats' \| 'none'` | Dashboard event transport (default: `socketio`; `nats` when `EVENT_TRANSPORT=nats`) |
| `events.natsWsUrl` | `string \| null` | NATS WebSocket URL (present when NATS adapter registered) |
| `auth.sso` | `boolean` | Whether SSO is configured for embedded deployments |
| `auth.ssoLogoutUrl` | `string \| null` | Host logout URL (redirected to on dashboard sign out) |
| `ai.enabled` | `boolean` | Whether an LLM API key is configured |

**Auth:** Not required
