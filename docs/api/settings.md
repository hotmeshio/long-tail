# Settings API

Returns frontend-relevant configuration. No secrets are exposed. All endpoints require authentication.

## Get settings

```
GET /api/settings
```

**Response 200:**

```json
{
  "telemetry": {
    "traceUrl": "https://ui.honeycomb.io/pubsubdb/environments/test/datasets/long-tail/trace?trace_id={traceId}"
  }
}
```

The `traceUrl` field is a template string where `{traceId}` is replaced with the actual trace ID to build a link to the trace viewer. Returns `null` if no trace URL is configured.
