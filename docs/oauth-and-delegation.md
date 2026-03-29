# OAuth, Delegation, and External MCP Server Authentication

Long Tail supports OAuth login for the dashboard, delegated authority for MCP tools acting on behalf of users, and service tokens for external MCP servers running in separate containers. This document covers the full chain from user authentication through tool-level credential delegation, and how to test it locally.

## Overview

Three layers of authentication work together:

1. **Identity OAuth** — Users sign in to the dashboard with Google, GitHub, or Microsoft. The system issues a JWT (same as password login). OAuth tokens are stored encrypted for later use.

2. **Delegation tokens** — When a workflow calls an MCP tool on behalf of a user, it creates a short-lived, scoped JWT. The tool receives this token and can use it to access user-specific resources (like the user's Google API credentials).

3. **Service tokens** — External MCP servers authenticate to Long Tail with long-lived API keys. Combined with delegation tokens, they can act on behalf of users with least-privilege scoping.

```
User logs in via OAuth
    │
    ▼
JWT issued (same as password login)
    │
    ▼
Workflow started → envelope carries userId
    │
    ▼
Activity creates delegation token (scoped, 5-min TTL)
    │
    ▼
MCP tool receives _auth.token in args
    │
    ▼
External server validates token, calls delegation API
    │
    ▼
Gets user's fresh OAuth access token → calls external API
```

## OAuth Login

### Supported Providers

- **Google** — OpenID Connect with PKCE
- **GitHub** — OAuth2 authorization code
- **Microsoft** — Entra ID with PKCE
- **Mock** — Test provider for local development (no real accounts needed)

### Configuration

Set environment variables for each provider you want to enable:

```bash
# Encryption key for OAuth token storage (required, 32 bytes as hex)
OAUTH_ENCRYPTION_KEY=a1b2c3d4e5f6...  # 64 hex characters

# Google
OAUTH_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret

# GitHub
OAUTH_GITHUB_CLIENT_ID=your-github-client-id
OAUTH_GITHUB_CLIENT_SECRET=your-github-client-secret

# Microsoft
OAUTH_MICROSOFT_CLIENT_ID=your-azure-app-id
OAUTH_MICROSOFT_CLIENT_SECRET=your-azure-secret
OAUTH_MICROSOFT_TENANT_ID=common  # or your tenant ID
```

No environment variables set = no OAuth buttons shown on the login page. Password login always works.

### Startup Config

OAuth can also be configured programmatically:

```typescript
await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: {
    secret: process.env.JWT_SECRET,
    oauth: {
      encryptionKey: process.env.OAUTH_ENCRYPTION_KEY,
      autoProvision: true,      // create user on first OAuth login
      defaultRoleType: 'member', // role for auto-provisioned users
      providers: [
        {
          provider: 'google',
          clientId: process.env.OAUTH_GOOGLE_CLIENT_ID!,
          clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET!,
          scopes: ['openid', 'email', 'profile'],
        },
      ],
    },
  },
});
```

### How It Works

1. The login page fetches available providers from `GET /api/auth/oauth/providers`.
2. User clicks "Sign in with Google" → browser redirects to `GET /api/auth/oauth/google`.
3. Backend generates CSRF state + PKCE code verifier, redirects to Google's consent screen.
4. Google redirects back to `GET /api/auth/oauth/google/callback` with an authorization code.
5. Backend exchanges the code for tokens, fetches user info (email, name).
6. If the user exists (matched by email or OAuth provider ID), they're logged in. If not and `autoProvision` is true, a new user is created.
7. OAuth tokens are encrypted (AES-256-GCM) and stored in `lt_oauth_tokens`.
8. A JWT is issued and the browser redirects to `/?token=<jwt>`.
9. The dashboard's `useOAuthCallback` hook picks up the token and completes login.

### Token Storage

OAuth access and refresh tokens are encrypted at rest using AES-256-GCM. The encryption key comes from `OAUTH_ENCRYPTION_KEY` (environment variable) or `auth.oauth.encryptionKey` (startup config).

The `lt_oauth_tokens` table stores one token set per user per provider. Tokens are automatically refreshed when expired (for providers that support refresh tokens).

## User Context Propagation

When a workflow is started via the API, the authenticated user's ID is injected into the envelope:

```
HTTP request (req.auth.userId)
    → LTEnvelope.lt.userId
        → OrchestratorContext.userId
            → Activities read via getOrchestratorContext()
```

This happens automatically. The interceptor reads `envelope.lt.userId` and makes it available to all activities in the workflow chain via `AsyncLocalStorage`. Child workflows spawned by `executeLT()` inherit the parent's `userId`.

For cron-triggered workflows (no HTTP request), `userId` is `undefined`. Activities that require user context should check for this and fail gracefully.

## Delegation Tokens

Delegation tokens are scoped, short-lived JWTs that authorize MCP tools to act on behalf of a user.

### Creating a Delegation Token

```typescript
import { createDelegationToken } from './services/auth/delegation';

const token = createDelegationToken(
  'user-123',                        // userId
  ['oauth:google:read', 'files:read'], // scopes
  300,                                 // TTL in seconds (default: 300, max: 3600)
  { workflowId: 'wf-abc', serverId: 'ext-server' }, // optional metadata
);
```

### Token Structure

```json
{
  "type": "delegation",
  "sub": "user-123",
  "scopes": ["oauth:google:read", "files:read"],
  "workflowId": "wf-abc",
  "serverId": "ext-server",
  "iss": "long-tail",
  "iat": 1711461600,
  "exp": 1711461900
}
```

### How Tools Receive Delegation Tokens

When a workflow activity calls an MCP tool, the framework automatically:

1. Reads `userId` from the `OrchestratorContext`.
2. Creates a delegation token with `['mcp:tool:call']` scope.
3. Passes it as `_auth: { userId, token }` in the tool's arguments.

Tools that don't need auth simply ignore the `_auth` field. External MCP servers extract `_auth.token` and use it to call back to Long Tail's delegation API.

### Validating a Delegation Token

```typescript
import { validateDelegationToken, requireScope } from './services/auth/delegation';

const payload = validateDelegationToken(token);
requireScope(payload, 'oauth:google:read'); // throws if scope missing
console.log(payload.sub); // userId
```

## Delegation API

External MCP servers use these endpoints to access user-scoped resources:

### Get OAuth Access Token

```
GET /api/delegation/oauth/:provider/token
Authorization: Bearer <delegation-token>
```

Returns a fresh access token for the user identified in the delegation token. Requires scope `oauth:<provider>:read`.

```json
{
  "access_token": "ya29.a0AfH6...",
  "expires_at": "2024-03-26T18:00:00.000Z",
  "scopes": ["openid", "email", "profile"],
  "provider": "google"
}
```

### Validate Delegation Token

```
POST /api/delegation/validate
Authorization: Bearer <service-token>
Content-Type: application/json

{ "token": "<delegation-token>" }
```

Returns the token's claims. Used by external servers to verify tokens without having `JWT_SECRET`.

```json
{
  "valid": true,
  "userId": "user-123",
  "scopes": ["oauth:google:read"],
  "workflowId": "wf-abc",
  "expiresAt": "2024-03-26T17:05:00.000Z"
}
```

## Service Tokens

External MCP servers authenticate to Long Tail using service tokens — long-lived API keys prefixed with `lt_svc_`.

### Generating a Service Token

```
POST /api/mcp/servers/:id/service-token
Authorization: Bearer <admin-jwt>

{ "name": "ext-calendar-server", "scopes": ["delegation:validate"] }
```

Returns the raw token **once**. The system stores only a bcrypt hash.

### Using a Service Token

Include it as a Bearer token in requests to delegation endpoints:

```bash
curl -H "Authorization: Bearer lt_svc_a1b2c3..." \
  -H "Content-Type: application/json" \
  -d '{"token": "<delegation-token>"}' \
  http://localhost:3000/api/delegation/validate
```

## External MCP Server Pattern

An external MCP server running in a separate container (or separate docker-compose) follows this pattern:

1. **Register** with Long Tail as an SSE-based MCP server.
2. **Receive a service token** from an admin.
3. **Accept tool calls** with `_auth.token` in the args.
4. **Validate** the delegation token against Long Tail's delegation API.
5. **Fetch** user-scoped credentials (OAuth tokens, files, etc.) via the delegation API.
6. **Execute** the operation and return results.

See `examples/external-mcp-server/` for a working example.

### Docker Compose Overlay

```bash
# Start the main stack + external MCP server
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --build
```

The external server connects to the same Docker network and calls back to `http://long-tail:3000`.

## Testing Locally

### 1. Generate an Encryption Key

```bash
# Generate a 32-byte hex key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Test with Mock OAuth Provider

The mock OAuth provider is a lightweight Express server that implements the OAuth2 authorization code flow without requiring real provider credentials. It auto-authorizes as a preconfigured test user.

```bash
# Start the stack with the mock OAuth provider
docker compose --profile test down -v
docker compose --profile test up -d --build

# Wait for services to be healthy
docker compose --profile test ps
```

Set these environment variables on the `long-tail` service (add to docker-compose.yml or use `.env`):

```bash
OAUTH_ENCRYPTION_KEY=<your-64-hex-char-key>
OAUTH_MOCK_CLIENT_ID=test-client
OAUTH_MOCK_CLIENT_SECRET=test-secret
MOCK_OAUTH_AUTH_URL=http://mock-oauth:9080/authorize
MOCK_OAUTH_TOKEN_URL=http://mock-oauth:9080/token
MOCK_OAUTH_USERINFO_URL=http://mock-oauth:9080/userinfo
```

Then:

1. Navigate to `http://localhost:3000/login`.
2. Click "Sign in with Mock (Test)".
3. The mock provider auto-authorizes and redirects back.
4. You land on the dashboard, logged in as `alice@test.local`.

### 3. Test the Full Delegation Chain

```bash
# 1. Log in (password or OAuth) and get a JWT
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"l0ngt@1l"}' | jq -r .token)

# 2. Start an mcpQuery workflow (userId is injected into the envelope)
WORKFLOW_ID=$(curl -s -X POST http://localhost:3000/api/insight \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"List all files","wait":false}' | jq -r .workflow_id)

echo "Workflow $WORKFLOW_ID started with userId in envelope"

# 3. The workflow's activities automatically create delegation tokens
#    when calling MCP tools. Check logs for:
#    [lt-mcp:...] tool call received _auth.userId = <user-id>
```

### 4. Test External MCP Server Delegation

```bash
# Start with external server overlay
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --build

# Generate a service token for the external server (requires admin JWT)
SERVICE_TOKEN=$(curl -s -X POST http://localhost:3000/api/mcp/servers/<server-id>/service-token \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ext-test","scopes":["delegation:validate"]}' | jq -r .rawToken)

# Create a delegation token manually (for testing)
DELEGATION=$(node -e "
  const {createDelegationToken} = require('./services/auth/delegation');
  console.log(createDelegationToken('$USER_ID', ['oauth:google:read'], 300));
")

# Call the external MCP server's tool
curl -X POST http://localhost:9090/tools/fetch_external_data \
  -H 'Content-Type: application/json' \
  -d "{
    \"provider\": \"google\",
    \"query\": \"my calendar events\",
    \"_auth\": { \"token\": \"$DELEGATION\" }
  }"
```

### 5. Run Unit Tests

```bash
# Delegation token tests (9 tests)
npx vitest run tests/delegation-tokens.test.ts

# OAuth tests (28 tests)
npx vitest run tests/oauth

# All backend tests (487 tests)
npx vitest run

# Frontend tests (520 tests)
cd dashboard && npx vitest run
```

## Security Model

### Least Privilege

| Token Type | Lifetime | Scope | Who Creates | Who Consumes |
|---|---|---|---|---|
| User JWT | 24 hours | Full API access | Login endpoint | Dashboard, API routes |
| Delegation token | 5 minutes | Specific scopes (e.g., `oauth:google:read`) | Workflow activities | MCP tools, delegation API |
| Service token | Long-lived | Server-specific (e.g., `delegation:validate`) | Admin | External MCP servers |
| OAuth access token | Provider-set (~1hr) | Provider scopes (e.g., `email`, `profile`) | OAuth flow | External APIs |

### Trust Boundaries

```
┌──────────────────────────────────────────────┐
│  Long Tail Core (trusted)                    │
│  - User JWTs signed with JWT_SECRET          │
│  - Delegation tokens signed with JWT_SECRET  │
│  - OAuth tokens encrypted with AES-256-GCM   │
│  - Service token hashes stored with bcrypt   │
└────────────────────────┬─────────────────────┘
                         │
            Delegation API (scoped access)
                         │
┌────────────────────────▼─────────────────────┐
│  External MCP Server (semi-trusted)          │
│  - Has service token (server identity)       │
│  - Receives delegation tokens (user scoping) │
│  - Can only access scoped resources          │
│  - Cannot forge or extend token permissions  │
└──────────────────────────────────────────────┘
```

### What Delegation Tokens Cannot Do

- Access resources outside their declared scopes
- Be used after expiry (5-minute default, 1-hour max)
- Be refreshed or extended (create a new one instead)
- Authenticate as a different user
- Access the Admin API or user management endpoints

## Database Tables

| Table | Purpose |
|---|---|
| `lt_oauth_tokens` | Encrypted per-user, per-provider OAuth tokens |
| `lt_service_tokens` | Hashed service tokens for external MCP servers |
| `lt_users.oauth_provider` | Identity link: which OAuth provider the user signed up with |
| `lt_escalations.created_by` | Audit: which user initiated the escalation |
| `lt_mcp_servers.required_scopes` | Declares what scopes a server needs from delegation tokens |

## Environment Variables Reference

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OAUTH_ENCRYPTION_KEY` | For OAuth | — | 32-byte hex key for token encryption |
| `OAUTH_GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret |
| `OAUTH_GITHUB_CLIENT_ID` | No | — | GitHub OAuth client ID |
| `OAUTH_GITHUB_CLIENT_SECRET` | No | — | GitHub OAuth client secret |
| `OAUTH_MICROSOFT_CLIENT_ID` | No | — | Microsoft OAuth client ID |
| `OAUTH_MICROSOFT_CLIENT_SECRET` | No | — | Microsoft OAuth client secret |
| `OAUTH_MICROSOFT_TENANT_ID` | No | `common` | Azure AD tenant |
| `OAUTH_MOCK_CLIENT_ID` | No | — | Mock provider client ID (testing) |
| `OAUTH_MOCK_CLIENT_SECRET` | No | — | Mock provider client secret (testing) |
| `MOCK_OAUTH_AUTH_URL` | No | `http://localhost:9080/authorize` | Mock provider authorization URL |
| `MOCK_OAUTH_TOKEN_URL` | No | `http://localhost:9080/token` | Mock provider token URL |
| `MOCK_OAUTH_USERINFO_URL` | No | `http://localhost:9080/userinfo` | Mock provider userinfo URL |
