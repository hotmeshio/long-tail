# Schema Exchange

Schema-driven data exchange with external service endpoints. Validates requests and responses against JSON Schema.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-schema-exchange` |
| Category | Data |
| AI required | No |
| Credential providers | — |

## Compile Hints

Validates requests before sending and responses after receiving. Embed request_schema and response_schema as STATIC values. Exchange output: { status, data, headers, elapsed_ms, validated }. API response is in .data field. For auth, prefer credential_provider over manual token wiring.

## Tools

### exchange

Exchange data with an external service endpoint under schema enforcement. Validates request body against request_schema before sending and response body against response_schema after receiving.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| endpoint | string | Yes | Service endpoint URL |
| method | string | Yes | HTTP method: GET, POST, PUT, DELETE, PATCH |
| headers | object | No | Request headers |
| query | object | No | Query parameters |
| body | any | No | Request body (validated against request_schema if provided) |
| request_schema | object | No | JSON Schema for request body validation |
| response_schema | object | No | JSON Schema for response body validation |
| timeout_ms | number | No | Request timeout in milliseconds |
| credential_provider | string | No | Credential provider name — resolves auth from the connection store automatically |
| credential_label | string | No | Credential label for multi-credential accounts |
| auth_scheme | string | No | Auth scheme (default: Bearer) |
| auth_header | string | No | Header name for credential (default: Authorization) |

### validate_schema

Validate any value against a JSON Schema without making a network call. Useful for pre-validation, testing, and transform verification.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| data | any | Yes | The value to validate |
| schema | object | Yes | JSON Schema to validate against |
