import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { isSuperAdmin } from '../services/user';
import { validateBotApiKey } from '../services/auth/bot-api-key';
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
      return { userId: keyRecord.user_id, role: 'member' };
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

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const mw = _authMiddleware || createAuthMiddleware(new JwtAuthAdapter());
  mw(req, res, next);
};

/**
 * Replace the auth adapter used by `requireAuth`.
 * Call before starting the server.
 */
export function setAuthAdapter(adapter: LTAuthAdapter): void {
  _authMiddleware = createAuthMiddleware(adapter);
}

/**
 * Middleware that requires admin access. Must be placed AFTER requireAuth.
 *
 * Checks isSuperAdmin() via the database first, then falls back to the
 * JWT `role` claim for stateless admin checks. Returns 403 otherwise.
 */
export const requireAdmin: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.auth?.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    // Fast path: trust the JWT role claim for admin/superadmin
    if (req.auth.role === 'admin' || req.auth.role === 'superadmin') {
      next();
      return;
    }
    // Slow path: check database for superadmin role type
    if (await isSuperAdmin(req.auth.userId)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Forbidden: admin access required' });
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
