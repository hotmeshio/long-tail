import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import { config } from './config';
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

  authenticate(req: Request): AuthPayload | null {
    // Use explicit secret if provided, otherwise read config lazily
    const secret = this.explicitSecret ?? config.JWT_SECRET;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    if (!secret) return null;
    try {
      return jwt.verify(header.slice(7), secret) as AuthPayload;
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
        res.status(401).json({ error: 'Unauthorized' });
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
 */
export const requireAuth = createAuthMiddleware(new JwtAuthAdapter());

/**
 * Generate a JWT token. Utility for tests and token provisioning.
 */
export function signToken(payload: AuthPayload, expiresIn: string = '24h'): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn });
}
