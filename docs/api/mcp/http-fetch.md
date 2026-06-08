# HTTP Fetch

HTTP client tools for making GET, POST, and arbitrary HTTP requests.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-http-fetch` |
| Category | Data |
| AI required | No |
| Credential providers | — |

## Compile Hints

HTTP response bodies may be large. Prefer specific fields from parsed JSON rather than raw body.

## Tools

### http_request

Make an HTTP request to any URL. Supports all methods, custom headers, and request bodies. Returns status, headers, and body.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | URL to request |
| method | string | No | HTTP method (default: GET) |
| headers | object | No | Request headers |
| body | string | No | Request body |
| timeout_ms | number | No | Request timeout in milliseconds |

### fetch_json

GET a URL and parse the response as JSON. Convenience wrapper around http_request.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | URL to fetch JSON from |
| headers | object | No | Request headers |

### fetch_text

GET a URL and return the response as text. Returns content, status, and content type.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | URL to fetch text from |
| headers | object | No | Request headers |
