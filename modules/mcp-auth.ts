import jwt from 'jsonwebtoken';

import type { Request, Response, NextFunction, RequestHandler } from '../lib/http';
import { requireAuth } from './auth';
import { getOAuthServerSettings, type OAuthServerSettings } from './oauth-server';
import {
  ACCESS_TOKEN_TYPE,
  verifyAccessToken,
  accessTokenPrincipal,
} from '../services/auth/oauth-server';
import { isRevoked } from '../services/auth/oauth-server/revocations';

const CHALLENGE_HEADER = 'WWW-Authenticate';

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function isAccessToken(token: string): boolean {
  const decoded = jwt.decode(token, { complete: true });
  return decoded?.header?.typ === ACCESS_TOKEN_TYPE;
}

function challenge(settings: OAuthServerSettings, error?: string): string {
  const base = `Bearer resource_metadata="${settings.resourceMetadataUrl}"`;
  return error ? `${base}, error="${error}"` : base;
}

/**
 * Authentication for `/mcp`. With the OAuth server configured, an access
 * token for this resource authenticates the request and every 401 carries the
 * RFC 9728 challenge, so MCP clients can discover how to sign in. Any other
 * credential goes through `requireAuth` unchanged. Without the OAuth server,
 * this is `requireAuth`.
 */
export const requireMcpAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const settings = getOAuthServerSettings();
  if (!settings) return requireAuth(req, res, next);

  const token = bearerToken(req);
  if (token && isAccessToken(token)) {
    const claims = verifyAccessToken(token, { issuer: settings.issuer, audience: settings.resource });
    if (!claims || isRevoked(claims)) {
      res.setHeader(CHALLENGE_HEADER, challenge(settings, 'invalid_token'));
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    req.auth = accessTokenPrincipal(claims);
    next();
    return;
  }

  res.setHeader(CHALLENGE_HEADER, challenge(settings));
  return requireAuth(req, res, (err?: unknown) => {
    res.removeHeader(CHALLENGE_HEADER);
    next(err);
  });
};
