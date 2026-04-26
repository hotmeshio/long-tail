# lt.settings

Platform settings for the current deployment.

## get

Return platform settings including telemetry configuration, escalation claim duration options, and event transport details.

```typescript
const result = await lt.settings.get();
```

**Parameters:** None

**Returns:** `LTApiResult<{ telemetry, escalation, events }>`

| Field | Type | Description |
|-------|------|-------------|
| `telemetry.traceUrl` | `string \| null` | Trace URL for the telemetry provider |
| `escalation.claimDurations` | `number[]` | Available claim duration options (minutes) |
| `events.transport` | `'socketio' \| 'nats' \| 'none'` | Active event transport |
| `events.natsWsUrl` | `string \| null` | NATS WebSocket URL (only when transport is `nats`) |

**Auth:** Not required
