import { Router, allowAnyOrigin, formBody, type Response } from '../../lib/http';
import { getOAuthServerSettings } from '../../modules/oauth-server';
import { OAUTH_REFRESH_TOKEN_TTL_SECONDS } from '../../modules/defaults';
import {
  exchangeAuthorizationCode, rotateRefreshToken, revokeByRefreshToken, revokeGrant,
  signAccessToken, verifyAccessToken,
} from '../../services/auth/oauth-server';
import { markRevoked } from '../../services/auth/oauth-server/revocations';
import type { LTGrantSnapshot } from '../../types';

const router = Router();

/** A form field, taking the first value when the host parsed repeats into an array. */
function field(body: unknown, name: string): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : undefined;
}

function tokenError(res: Response, error: string, description: string): void {
  res.status(400).json({ error, error_description: description });
}

function sendTokens(res: Response, snapshot: LTGrantSnapshot, refreshToken: string): void {
  const settings = getOAuthServerSettings()!;
  const { token, expiresIn } = signAccessToken(snapshot, { issuer: settings.issuer, audience: settings.resource });
  res.json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn, refresh_token: refreshToken, scope: snapshot.scope });
}

const tokenEndpoint = [allowAnyOrigin(['POST']), formBody()];

/**
 * POST /api/oauth/token
 * grant_type=authorization_code: code, redirect_uri, client_id, code_verifier
 * grant_type=refresh_token: refresh_token, client_id
 * Returns { access_token, token_type, expires_in, refresh_token, scope }.
 */
router.options('/token', allowAnyOrigin(['POST']));
router.post('/token', ...tokenEndpoint, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  const settings = getOAuthServerSettings()!;
  const grantType = field(req.body, 'grant_type');
  const clientId = field(req.body, 'client_id');
  if (!clientId) return tokenError(res, 'invalid_request', 'client_id is required');

  if (grantType === 'authorization_code') {
    const code = field(req.body, 'code');
    const redirectUri = field(req.body, 'redirect_uri');
    const codeVerifier = field(req.body, 'code_verifier');
    if (!code || !redirectUri || !codeVerifier) {
      return tokenError(res, 'invalid_request', 'code, redirect_uri and code_verifier are required');
    }
    const resource = field(req.body, 'resource');
    if (resource !== undefined && resource !== settings.resource) {
      return tokenError(res, 'invalid_target', `resource must be ${settings.resource}`);
    }
    const exchanged = await exchangeAuthorizationCode({
      code, clientId, redirectUri, codeVerifier, refreshTtlSeconds: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    });
    if (!exchanged) return tokenError(res, 'invalid_grant', 'the authorization code is invalid, expired or already used');
    return sendTokens(res, exchanged.snapshot, exchanged.refreshToken);
  }

  if (grantType === 'refresh_token') {
    const refreshToken = field(req.body, 'refresh_token');
    if (!refreshToken) return tokenError(res, 'invalid_request', 'refresh_token is required');
    const rotated = await rotateRefreshToken({ refreshToken, clientId, refreshTtlSeconds: OAUTH_REFRESH_TOKEN_TTL_SECONDS });
    if (rotated.snapshot === null) {
      if ('revoked' in rotated && rotated.revoked) markRevoked({ grantId: rotated.revoked.grant_id });
      return tokenError(res, 'invalid_grant', 'the refresh token is invalid, expired or revoked');
    }
    return sendTokens(res, rotated.snapshot, rotated.refreshToken);
  }

  return tokenError(res, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
});

/**
 * POST /api/oauth/revoke
 * Token revocation (RFC 7009): a refresh token or an access token, with the
 * client_id that holds it. Revokes the whole grant. Always answers 200.
 */
router.options('/revoke', allowAnyOrigin(['POST']));
router.post('/revoke', ...tokenEndpoint, async (req, res) => {
  const settings = getOAuthServerSettings()!;
  const token = field(req.body, 'token');
  const clientId = field(req.body, 'client_id');
  if (token && clientId) {
    const claims = verifyAccessToken(token, { issuer: settings.issuer, audience: settings.resource });
    const revoked = claims
      ? (claims.client_id === clientId ? await revokeGrant(claims.gid) : null)
      : await revokeByRefreshToken(token, clientId);
    if (revoked) markRevoked({ grantId: revoked.grant_id });
  }
  res.status(200).end();
});

export default router;
