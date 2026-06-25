# Authentication

Every API request in Long Tail passes through an authentication adapter before reaching route handlers. The adapter inspects the incoming request, verifies the caller's identity, and returns a structured `AuthPayload`. If verification fails, the adapter returns `null` and the middleware responds with `401 Unauthorized`.

This design decouples identity verification from the rest of the application. The built-in adapter handles JWTs. Teams that rely on OAuth providers, API keys, or session cookies can swap in a custom adapter without modifying any route logic.

## Interface

Two types define the contract between Long Tail and any authentication strategy:

```typescript
interface LTAuthAdapter {
  authenticate(req: any): Promise<AuthPayload | null>;
}

interface AuthPayload {
  userId: string;
  email?: string;
  role?: string;
  [key: string]: any;
}
```

`LTAuthAdapter` requires a single method. It receives the raw request object and returns either a valid `AuthPayload` or `null`. The index signature on `AuthPayload` allows adapters to attach arbitrary claims (tenant ID, permissions bitmask, etc.) without altering the interface.

## Configuration via start()

The simplest way to configure auth is through the `start()` config:

```typescript
import { start } from '@hotmeshio/long-tail';

// Use the built-in JWT adapter with an explicit secret
await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { secret: process.env.JWT_SECRET },
  workers: [ ... ],
});

// Or plug in a custom adapter
await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { adapter: new GoogleOAuthAdapter() },
  workers: [ ... ],
});
```

When `auth.secret` is provided, Long Tail uses the built-in `JwtAuthAdapter` with that secret. When `auth.adapter` is provided, the custom adapter replaces the JWT adapter entirely. If neither is set, the built-in JWT adapter reads from the `JWT_SECRET` environment variable.

## Built-in JWT Adapter

`JwtAuthAdapter` is the default adapter. It extracts a Bearer token from the `Authorization` header and verifies it against the `JWT_SECRET` environment variable.

A companion utility, `signToken`, generates tokens for use in tests or login endpoints:

```typescript
import { signToken } from '@hotmeshio/long-tail';

const token = signToken({ userId: '42', email: 'ops@example.com' }, '8h');
```

The first argument is the payload. The second, optional argument is the expiration duration (defaults vary by configuration). The function uses `JWT_SECRET` internally.

## Middleware

Long Tail's embedded server automatically applies auth middleware to all API routes. The following middleware functions are also exported for advanced use cases.

### createAuthMiddleware

`createAuthMiddleware` accepts any `LTAuthAdapter` and returns Express-compatible middleware. On each request, it calls the adapter's `authenticate` method and attaches the result to `req.auth`. If the adapter returns `null`, the middleware halts the request with a `401` response.

### requireAuth

`requireAuth` is the default auth middleware used by Long Tail's embedded server. It delegates to whatever adapter was configured via `start()`, or falls back to the built-in `JwtAuthAdapter`.

### requireAdmin

`requireAdmin` is a separate middleware that runs after authentication. It checks whether the authenticated user holds superadmin status, either through a database lookup (`isSuperAdmin()`) or by verifying that the JWT `role` claim equals `'admin'`. Requests that fail this check receive a `403 Forbidden` response.

## Custom Adapter Example

The following adapter authenticates requests using Google OAuth ID tokens. It verifies the token with Google's servers, extracts the user's subject identifier and email, and returns them as an `AuthPayload`.

```typescript
import type { LTAuthAdapter, AuthPayload } from '@hotmeshio/long-tail';
import { OAuth2Client } from 'google-auth-library';

const google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class GoogleOAuthAdapter implements LTAuthAdapter {
  async authenticate(req): Promise<AuthPayload | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const ticket = await google.verifyIdToken({
        idToken: header.slice(7),
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const { sub, email } = ticket.getPayload()!;
      return { userId: sub, email, role: 'member' };
    } catch {
      return null;
    }
  }
}

// Pass to start()
await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { adapter: new GoogleOAuthAdapter() },
  workers: [ ... ],
});
```

The same pattern applies to any identity provider: extract credentials from the request, verify them against the provider, and return an `AuthPayload` or `null`.

## Development Shortcut

During local development, a no-op adapter that returns a hardcoded payload removes the need for a running identity provider:

```typescript
import type { LTAuthAdapter, AuthPayload } from '@hotmeshio/long-tail';

class DevAdapter implements LTAuthAdapter {
  async authenticate(): Promise<AuthPayload> {
    return { userId: 'dev-user', email: 'dev@localhost', role: 'admin' };
  }
}

await start({
  database: { connectionString: process.env.DATABASE_URL },
  auth: { adapter: new DevAdapter() },
  workers: [ ... ],
});
```

This adapter grants admin access to every request. Restrict its use to local environments.

## SSO for Embedded Deployments

When Long Tail is mounted inside a host application (NestJS, Express, Rails, etc.) at a subpath, users authenticate with the host — not with Long Tail. The host's middleware validates cookies, headers, or session tokens before requests reach Long Tail's routes. SSO integration tells Long Tail how to extract that identity and transparently provision matching users.

### How It Works

1. User authenticates with the host application (via OIDC, SAML, cookies, etc.)
2. Host middleware validates identity and attaches user context to the request
3. Dashboard loads, detects SSO is enabled via `/api/settings`
4. Dashboard calls `POST /api/auth/sso` — host cookies are sent automatically
5. Long Tail calls `sso.resolve(req)`, extracts the host identity, and JIT provisions a user in `lt_users`
6. Long Tail returns its own JWT — the dashboard stores it for subsequent API calls
7. All downstream RBAC, escalation claims, and audit trails use the provisioned `lt_users.id`

### Configuration

The host provides a single `resolve` function. Long Tail handles provisioning, role mapping, JWT issuance, and dashboard awareness.

```typescript
import { start } from '@hotmeshio/long-tail';

await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false }, // host owns the HTTP server

  auth: {
    secret: process.env.JWT_SECRET,
    sso: {
      // Extract identity from the host's already-validated request.
      // req.user is set by the host's auth middleware before Long Tail sees it.
      resolve: (req) => {
        const user = (req as any).user;
        if (!user) return null;
        return {
          externalId: user.id,           // stable identifier → lt_users.external_id
          displayName: user.displayName,
          email: user.email,
          roles: ['operator', 'reviewer'],
        };
      },

      // Optional: map host role names to LT role names.
      // Unmapped roles are ignored. Omit to pass roles through as-is.
      roleMap: {
        admin: 'superadmin',
        operator: 'station-operator',
      },

      // Optional: default role type for provisioned users (default: 'member')
      defaultRoleType: 'member',

      // Optional: redirect here when user logs out of LT dashboard
      logoutUrl: '/auth/logout',
    },
  },
});
```

### SSOIdentity

The `resolve` function returns an `SSOIdentity` or `null`:

```typescript
interface SSOIdentity {
  externalId: string;                    // mapped to lt_users.external_id
  displayName?: string;                  // lt_users.display_name
  email?: string;                        // lt_users.email
  roles?: string[];                      // mapped to lt_user_roles via roleMap
  metadata?: Record<string, any>;        // lt_users.metadata (JSONB)
}
```

### JIT Provisioning

On first contact, Long Tail creates a `lt_users` record with the resolved identity. On subsequent contacts, it syncs any new roles. The internal `lt_users.id` (UUID) is used for all RBAC, escalation claims, and audit trails — the host's external ID is stored in `lt_users.external_id` as a stable lookup key.

### Token Exchange

`POST /api/auth/sso` is a public endpoint (no Bearer required). It calls `sso.resolve(req)`, provisions the user, and returns an LT JWT. The dashboard calls this automatically when `auth.sso` is `true` in settings.

```
POST /api/auth/sso

Response 200:
{
  "token": "<jwt>",
  "user": {
    "id": "lt-uuid",
    "external_id": "host-user-id",
    "display_name": "Jane Doe",
    "roles": [{ "role": "operator", "type": "member" }]
  }
}
```

### requireAuth Fallback

When SSO is configured and a request arrives without a Bearer token, `requireAuth` calls `sso.resolve(req)` as a fallback. This allows direct API calls from the host backend (which forward cookies but not Bearer tokens) to authenticate without an explicit exchange. The dashboard always uses Bearer after the initial exchange.

### Role Mapping

Roles are resolved once during the token exchange (not per-request) and baked into the JWT — the same pattern as the built-in login. When the host system changes a user's roles, the new roles take effect on the next token refresh.

If `roleMap` is provided, only mapped roles are assigned. If omitted, host role names are passed through directly as LT role names. Roles named `superadmin` or `admin` are assigned the corresponding role type; all others default to `member`. Provisioned `member` grants take the default work-surface scope of `read_all`/`write_all` — the full-queue worker. Narrower scopes (for one-time or read-only users) are set through the [Roles API](api/http/roles.md#work-surface-scope) or the dashboard Scope picker.

### Standalone Deployments

When `auth.sso` is not configured, nothing changes. The login page, OAuth providers, service accounts, and JWT auth all work exactly as before. SSO is purely additive.

## Service Account Authentication

Service accounts are named identities that authenticate with API keys instead of passwords or OAuth. They share the same RBAC system as human users — same roles, same delegation tokens, same credential storage.

### How It Works

Service account API keys are prefixed with `lt_bot_` and validated via bcrypt comparison, following the same pattern as service tokens. The built-in `JwtAuthAdapter` detects the prefix automatically:

```
Authorization: Bearer lt_bot_a1b2c3d4e5f6...
```

When a service account API key is validated, the adapter returns an `AuthPayload` with the account's `userId` (from the `lt_users` table). From that point forward, the request is indistinguishable from a human user's — the same middleware, RBAC checks, and identity propagation apply.

### Creating a Service Account

Service accounts are managed via the `/api/bot-accounts` endpoints (admin-only). See the [Service Accounts API](api/service-accounts.md) for full documentation.

```bash
# Create a service account
curl -X POST http://localhost:3000/api/bot-accounts \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "ci-bot", "description": "Runs scheduled workflows"}'

# Generate an API key (shown once)
curl -X POST http://localhost:3000/api/bot-accounts/$BOT_ID/api-keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "production", "scopes": ["mcp:tool:call"]}'
```

### Identity in Workflows

When a service account starts a workflow, its `userId` flows through the same envelope and `ToolContext` path as a human user. Activities that call `getToolContext()` receive a `ToolPrincipal` with `type: 'bot'`, and the task record's `initiated_by` column stores the account's user ID for audit.

## Environment Variables

| Variable     | Required | Description                                      |
|--------------|----------|--------------------------------------------------|
| `JWT_SECRET` | Yes      | Signing and verification key for the JWT adapter. |

`JWT_SECRET` must be set when using `JwtAuthAdapter` or `signToken`. Omitting it will cause token verification to fail at runtime. Use a cryptographically random string of at least 32 characters in production.
