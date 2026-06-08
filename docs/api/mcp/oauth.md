# OAuth

OAuth token management. Get fresh access tokens for external services. Handles automatic token refresh.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-oauth` |
| Category | System |
| AI required | No |
| Credential providers | — |

## Compile Hints

get_access_token returns a short-lived token. Call immediately before authenticated API requests — do not cache across steps.

## Tools

### get_access_token

Get a fresh OAuth access token for an external service. Automatically refreshes expired tokens.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| provider | string | Yes | OAuth provider name (google, github, microsoft, anthropic, etc.) |
| user_id | string | Yes | User ID to get token for |
| label | string | No | Credential label (default: "default"). Select among multiple credentials for the same provider. |

### list_connections

List all OAuth providers connected for a user. Returns provider, label, and credential type for each connection.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | string | Yes | User ID to list connections for |

### revoke_connection

Disconnect an OAuth provider for a user, removing stored tokens. Use label to target a specific credential.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| provider | string | Yes | OAuth provider name to disconnect |
| user_id | string | Yes | User ID to revoke connection for |
| label | string | No | Credential label to revoke (default: "default") |
