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

/**
 * Identity resolved from the host application's authentication.
 *
 * Returned by the SSO `resolve` function. Long Tail maps this to an
 * `lt_users` record via JIT provisioning — the host never touches
 * Long Tail's user tables directly.
 */
export interface SSOIdentity {
  /** Stable external identifier (e.g., host user UUID, employee ID).
   *  Mapped to `lt_users.external_id`. */
  externalId: string;
  /** Display name for the user. */
  displayName?: string;
  /** Email address. */
  email?: string;
  /** Role names from the host system. Mapped to LT roles via `roleMap`
   *  (if provided) or passed through directly as LT role names. */
  roles?: string[];
  /** Arbitrary metadata stored on the `lt_users.metadata` JSONB field. */
  metadata?: Record<string, any>;
}

/**
 * SSO configuration for embedded deployments.
 *
 * When Long Tail is mounted inside a host application (NestJS, Express, etc.),
 * the host's auth middleware validates users before requests reach Long Tail.
 * This config tells Long Tail how to extract that identity and provision
 * matching `lt_users` records.
 *
 * The host provides ONE function (`resolve`). Long Tail handles JIT provisioning,
 * role sync, JWT issuance, and dashboard awareness.
 *
 * @example NestJS (Acme Corp)
 * ```typescript
 * await start({
 *   auth: {
 *     secret: process.env.JWT_SECRET,
 *     sso: {
 *       resolve: (req) => {
 *         const user = (req as any).user; // set by NestJS middleware
 *         if (!user) return null;
 *         return {
 *           externalId: user.id,
 *           displayName: user.displayName,
 *           email: user.email,
 *           roles: ['grinder', 'quality-inspector'],
 *         };
 *       },
 *       roleMap: { admin: 'superadmin' },
 *       logoutUrl: '/auth/logout',
 *     },
 *   },
 * });
 * ```
 */
export interface LTSSOConfig {
  /** Extract user identity from the host's authenticated request.
   *  Return `null` if the request is not authenticated by the host.
   *  The `req` object carries cookies, headers, and any properties
   *  attached by upstream middleware (e.g., `req.user`). */
  resolve: (req: Request) => Promise<SSOIdentity | null> | (SSOIdentity | null);
  /** Map host role names to LT role names.
   *  Key = host role, value = LT role name.
   *  Unmapped roles are ignored. If omitted, host roles pass through as-is. */
  roleMap?: Record<string, string>;
  /** Default LT role type for provisioned users. Default: `'member'`. */
  defaultRoleType?: 'admin' | 'member';
  /** URL to redirect the browser on logout (host's logout endpoint).
   *  If omitted, the dashboard shows its own login page on logout. */
  logoutUrl?: string;
}
