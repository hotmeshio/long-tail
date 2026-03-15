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

## Environment Variables

| Variable     | Required | Description                                      |
|--------------|----------|--------------------------------------------------|
| `JWT_SECRET` | Yes      | Signing and verification key for the JWT adapter. |

`JWT_SECRET` must be set when using `JwtAuthAdapter` or `signToken`. Omitting it will cause token verification to fail at runtime. Use a cryptographically random string of at least 32 characters in production.
