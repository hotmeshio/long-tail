# Insight API

Run AI-powered analytical queries against the system database. Requires `OPENAI_API_KEY` to be configured. All endpoints require authentication.

## Run an insight query

```
POST /api/insight
```

Starts an insight workflow that generates a structured analysis in response to a natural language question about system data.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | `string` | Yes | Natural language question about system data |

**Example request:**

```json
{ "question": "What are the most common escalation types this week?" }
```

**Response 200:**

```json
{
  "title": "Escalation Types This Week",
  "summary": "Document verification escalations dominate...",
  "sections": [
    { "heading": "Top Escalation Types", "content": "..." }
  ],
  "metrics": [
    { "label": "Total Escalations", "value": "42" }
  ],
  "query": "What are the most common escalation types this week?",
  "workflow_id": "insight-1705312000000-a1b2c3",
  "duration_ms": 8500
}
```

**Response 400:** Missing `question`.

**Response 503:** `OPENAI_API_KEY` not configured.

**Response 504:** Query timed out.
