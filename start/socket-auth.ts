import jwt from 'jsonwebtoken';

import { config } from '../modules/config';
import type { SocketIOAuthenticator } from '../lib/events/socketio';
import type { LTStartConfig } from '../types/startup';

/**
 * Build a Socket.IO handshake authenticator from the startup config.
 *
 * Uses the same JWT secret as `requireAuth` — either the explicit
 * secret from startConfig.auth.secret or the JWT_SECRET env var.
 *
 * Returns `undefined` when no secret is configured (e.g. tests or
 * deployments that intentionally skip auth), which leaves Socket.IO
 * open as before.
 */
export function createSocketIOAuthenticator(
  startConfig: LTStartConfig,
): SocketIOAuthenticator | undefined {
  const secret = startConfig.auth?.secret ?? config.JWT_SECRET;
  if (!secret) return undefined;

  return (token: string): boolean => {
    try {
      const payload = jwt.verify(token, secret);
      return !!(payload && typeof payload === 'object' && (payload as any).userId);
    } catch {
      return false;
    }
  };
}
