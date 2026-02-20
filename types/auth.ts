import type { Request } from 'express';

/**
 * The identity payload extracted from an authenticated request.
 * All auth adapters must return this shape.
 */
export interface AuthPayload {
  userId: string;
  role?: string;
  [key: string]: any;
}

/**
 * Pluggable authentication adapter interface.
 *
 * Implement this to integrate your own auth provider (Clerk, Auth0, jose, etc.)
 * with Long Tail's middleware. The adapter extracts identity from the request;
 * the middleware handles 401 responses and `userId` validation.
 *
 * Usage:
 * ```typescript
 * import { createAuthMiddleware, LTAuthAdapter, AuthPayload } from '@hotmeshio/long-tail';
 *
 * class MyAuthAdapter implements LTAuthAdapter {
 *   async authenticate(req: Request): Promise<AuthPayload | null> {
 *     // your verification logic
 *     return { userId: 'user-1', role: 'admin' };
 *   }
 * }
 *
 * const authMiddleware = createAuthMiddleware(new MyAuthAdapter());
 * ```
 */
export interface LTAuthAdapter {
  authenticate(req: Request): Promise<AuthPayload | null> | (AuthPayload | null);
}
