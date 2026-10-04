import { Request, Response, NextFunction, RequestHandler } from '../lib/http';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { getSSOConfig } from './sso';
import { loggerRegistry } from '../lib/logger';
import { mayAdminister, mayBuild, mayManageRoles, mayReadWorkflowRun, type CapabilityPrincipal } from './capabilities';
import { ssoProvision } from '../services/user/sso-provision';
import { validateBotApiKey } from '../services/auth/bot-api-key';
import { resolvePrincipal } from '../services/iam/principal';
import type { AuthPayload, LTAuthAdapter } from '../types';

// Re-export types for convenience
export type { AuthPayload, LTAuthAdapter };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

/**
 * Reference JWT auth adapter using `jsonwebtoken`.
 *
 * Reads a Bearer token from the Authorization header and verifies it
 * with the configured secret. Returns the decoded payload or null.
 */
export class JwtAuthAdapter implements LTAuthAdapter {
  private explicitSecret: string | undefined;

  constructor(secret?: string) {
    this.explicitSecret = secret;
  }

  authenticate(req: Request): AuthPayload | null | Promise<AuthPayload | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const token = header.slice(7);

    // Bot API key authentication (async path)
    if (token.startsWith('lt_bot_')) {
      return this.authenticateBotApiKey(token);
    }

    // JWT authentication (sync path)
    const secret = this.explicitSecret ?? config.JWT_SECRET;
    if (!secret) return null;
    try {
      return jwt.verify(token, secret) as AuthPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        // Tag the request so the middleware can return a specific message
        (req as any)._authError = 'expired';
      }
      return null;
    }
  }

  private async authenticateBotApiKey(rawKey: string): Promise<AuthPayload | null> {
    try {
      const keyRecord = await validateBotApiKey(rawKey);
      if (!keyRecord) return null;

      // Resolve bot's actual roles (single JOIN query) instead of hardcoding 'member'
      const principal = await resolvePrincipal(keyRecord.user_id);
      const role = principal?.roleType ?? 'member';

      return {
        userId: keyRecord.user_id,
        role,
        scopes: keyRecord.scopes ?? [],
        principalType: 'bot',
      };
    } catch {
      return null;
    }
  }
}

/**
 * Create Express middleware from any auth adapter.
 *
 * The adapter handles token extraction and verification.
 * This middleware handles the HTTP response (401) and ensures
 * the payload contains a `userId` claim before setting `req.auth`.
 *
 * Usage:
 * ```typescript
 * import { createAuthMiddleware, JwtAuthAdapter } from '@hotmeshio/long-tail';
 *
 * // Use the reference JWT adapter
 * app.use(createAuthMiddleware(new JwtAuthAdapter('my-secret')));
 *
 * // Or plug in your own adapter
 * app.use(createAuthMiddleware(myClerkAdapter));
 * ```
 */
export function createAuthMiddleware(adapter: LTAuthAdapter): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = await adapter.authenticate(req);
      if (!payload) {
        const isExpired = (req as any)._authError === 'expired';
        res.status(401).json({ error: isExpired ? 'Token expired' : 'Unauthorized' });
        return;
      }
      if (!payload.userId) {
        res.status(401).json({ error: 'Token missing required userId claim' });
        return;
      }
      req.auth = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

/**
 * Default auth middleware using JWT with `config.JWT_SECRET`.
 * Drop-in replacement for custom middleware — just import and use.
 *
 * When `setAuthAdapter()` is called (e.g., from `start()`), this
 * middleware delegates to the custom adapter instead.
 */
let _authMiddleware: RequestHandler | null = null;

export const requireAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  // Fast path: Bearer token present — use standard JWT/adapter auth
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const mw = _authMiddleware || createAuthMiddleware(new JwtAuthAdapter());
    return mw(req, res, next);
  }

  // SSO fallback: no Bearer, but host may have authenticated via cookies/headers.
  // `res` is deliberately NOT passed to resolve here: this path runs on every
  // cookie-bearing request, and ambient API traffic must never slide the host
  // session — only the explicit exchange (login + gated keepalive beat) does.
  const ssoConfig = getSSOConfig();
  if (ssoConfig) {
    try {
      const identity = await ssoConfig.resolve(req);
      if (identity) {
        const provisioned = await ssoProvision(identity, ssoConfig);
        const highestType = provisioned.roles.some((r) => r.type === 'superadmin')
          ? 'superadmin'
          : provisioned.roles.some((r) => r.type === 'admin')
            ? 'admin'
            : 'member';
        req.auth = {
          userId: provisioned.userId,
          role: highestType,
          roles: provisioned.roles,
          sso: true,
        };
        return next();
      }
    } catch (err: any) {
      // SSO resolve failed — fall through to 401, but leave a trace so host
      // resolve errors are diagnosable.
      loggerRegistry.debug(`[long-tail] sso resolve failed on auth fallback: ${err?.message}`);
    }
  }

  // No Bearer, no SSO — delegate to standard middleware (returns 401)
  const mw = _authMiddleware || createAuthMiddleware(new JwtAuthAdapter());
  mw(req, res, next);
};

/**
 * `requireAuth` without the SSO fallback: only a credential the request
 * carries itself (the configured adapter, else a Bearer JWT or bot key).
 * For endpoints a cross-site page must not reach through the host's cookie.
 */
export const requireCredentialAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const mw = _authMiddleware || createAuthMiddleware(new JwtAuthAdapter());
  return mw(req, res, next);
};

/**
 * Replace the auth adapter used by `requireAuth`.
 * Call before starting the server.
 */
export function setAuthAdapter(adapter: LTAuthAdapter): void {
  _authMiddleware = createAuthMiddleware(adapter);
}

type CapabilityCheck = (principal: CapabilityPrincipal | undefined) => Promise<boolean>;

/** Express gate over a capability predicate. Must be placed AFTER requireAuth. */
function requireCapability(check: CapabilityCheck, denial: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth?.userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (await check(req.auth)) {
        next();
        return;
      }
      res.status(403).json({ error: denial });
    } catch {
      res.status(403).json({ error: 'Forbidden' });
    }
  };
}

/** Admin access: admin or superadmin claim, or a superadmin in the database. */
export const requireAdmin = requireCapability(mayAdminister, 'Forbidden: admin access required');

/** Builder access: superadmin or the 'engineer' role. Backend twin of the dashboard's `isBuilder`. */
export const requireBuilder = requireCapability(mayBuild, 'Forbidden: builder access required');

/** Role-management access: admin access or the 'engineer' role. Backend twin of `isBuilder || isOps`. */
export const requireRoleManager = requireCapability(mayManageRoles, 'Forbidden: role-management access required');

/** Reads of one workflow run (`:workflowId`): builder access, or the person who started it or it runs as. */
export const requireWorkflowReader: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.auth?.userId && await mayReadWorkflowRun(req.auth, String(req.params.workflowId))) {
      next();
      return;
    }
    res.status(403).json({ error: 'Forbidden: workflow read access required' });
  } catch {
    res.status(403).json({ error: 'Forbidden' });
  }
};

/**
 * Generate a JWT token. Utility for tests and token provisioning.
 */
export function signToken(payload: AuthPayload, expiresIn: string = '24h'): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn } as jwt.SignOptions);
}
