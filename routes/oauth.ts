import { Router } from 'express';

import { signToken, requireAuth } from '../modules/auth';
import { loggerRegistry } from '../services/logger';
import {
  listProviders,
  getProvider,
  createOAuthState,
  consumeOAuthState,
  upsertOAuthToken,
  getUserByOAuthProvider,
  deleteOAuthConnection,
  listOAuthConnections,
} from '../services/oauth';
import { getUserByEmail, createUser } from '../services/user';

const router = Router();

// ── OAuth startup config (set by initializeOAuth) ────────────────────────────

let _oauthConfig = {
  autoProvision: true,
  defaultRoleType: 'member' as 'admin' | 'member',
  baseUrl: '',
};

export function setOAuthConfig(cfg: {
  autoProvision?: boolean;
  defaultRoleType?: 'admin' | 'member';
  baseUrl?: string;
}): void {
  if (cfg.autoProvision !== undefined) _oauthConfig.autoProvision = cfg.autoProvision;
  if (cfg.defaultRoleType) _oauthConfig.defaultRoleType = cfg.defaultRoleType;
  if (cfg.baseUrl) _oauthConfig.baseUrl = cfg.baseUrl;
}

/**
 * GET /api/auth/oauth/providers
 * List configured OAuth providers (for login page buttons).
 */
router.get('/providers', (_req, res) => {
  res.json(listProviders());
});

/**
 * GET /api/auth/oauth/connections
 * List all OAuth connections for the authenticated user.
 * Must be registered BEFORE /:provider to avoid catch-all match.
 */
router.get('/connections', requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const connections = await listOAuthConnections(userId);
    res.json({ connections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/oauth/:provider
 * Initiate the OAuth flow — redirects the browser to the provider.
 */
router.get('/:provider', async (req, res) => {
  const { provider } = req.params;
  const handler = getProvider(provider);
  if (!handler) {
    res.status(404).json({ error: `OAuth provider "${provider}" not configured` });
    return;
  }

  const returnTo = (req.query.returnTo as string) || '/';
  const { state, codeVerifier } = createOAuthState(provider, returnTo);

  // Compute redirect URI dynamically if not set in provider config
  const baseUrl = _oauthConfig.baseUrl || `${req.protocol}://${req.get('host')}`;
  if (!handler.config.redirectUri) {
    handler.config.redirectUri = `${baseUrl}/api/auth/oauth/${provider}/callback`;
  }

  const url = await handler.createAuthorizationURL(state, codeVerifier);
  res.redirect(url.toString());
});

/**
 * GET /api/auth/oauth/:provider/callback
 * Handle the OAuth callback — exchange code, provision user, issue JWT.
 */
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state parameter' });
    return;
  }

  // Validate state (CSRF protection)
  const oauthState = consumeOAuthState(state as string);
  if (!oauthState || oauthState.provider !== provider) {
    res.status(400).json({ error: 'Invalid or expired OAuth state' });
    return;
  }

  const handler = getProvider(provider);
  if (!handler) {
    res.status(404).json({ error: `OAuth provider "${provider}" not configured` });
    return;
  }

  try {
    // Exchange authorization code for tokens
    const tokens = await handler.validateAuthorizationCode(
      code as string,
      oauthState.codeVerifier,
    );

    // Fetch user info from the provider
    const userInfo = await handler.fetchUserInfo(tokens.accessToken);

    // ── Credential-only providers (e.g., Anthropic) ──────────────────────
    // These providers store API keys for an already-authenticated user.
    // They don't create users or issue JWTs — the user must be logged in.
    if (oauthState.connectOnly) {
      const userId = oauthState.userId;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required to connect a credential provider' });
        return;
      }
      const label = oauthState.label || 'default';
      await upsertOAuthToken(
        userId,
        provider,
        tokens,
        handler.config.scopes,
        userInfo.providerUserId,
        userInfo.email,
        { display_name: userInfo.displayName, ...userInfo.raw },
        label,
      );
      loggerRegistry.info(`[oauth] stored ${provider} credentials (label: ${label}) for user ${userId}`);
      const returnTo = oauthState.returnTo || '/';
      res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}connected=${provider}&label=${encodeURIComponent(label)}`);
      return;
    }

    // ── Identity providers (Google, GitHub, Microsoft, etc.) ─────────────
    // Find or create the user
    let user = await getUserByOAuthProvider(provider, userInfo.providerUserId);

    if (!user && userInfo.email) {
      // Try matching by email
      user = await getUserByEmail(userInfo.email);
    }

    if (!user) {
      if (!_oauthConfig.autoProvision) {
        res.status(403).json({ error: 'No account found. Contact an administrator.' });
        return;
      }
      // Auto-provision new user
      user = await createUser({
        external_id: `${provider}:${userInfo.providerUserId}`,
        email: userInfo.email || undefined,
        display_name: userInfo.displayName || undefined,
        oauth_provider: provider,
        oauth_provider_id: userInfo.providerUserId,
        roles: [{ role: _oauthConfig.defaultRoleType, type: _oauthConfig.defaultRoleType }],
      });
      loggerRegistry.info(`[oauth] auto-provisioned user ${user.id} from ${provider}`);
    }

    // Store the OAuth tokens (encrypted)
    await upsertOAuthToken(
      user.id,
      provider,
      tokens,
      handler.config.scopes,
      userInfo.providerUserId,
      userInfo.email,
      { avatar: userInfo.raw?.picture || userInfo.raw?.avatar_url },
    );

    // Determine highest role type
    const roles = user.roles || [];
    const highestType = roles.some((r) => r.type === 'superadmin')
      ? 'superadmin'
      : roles.some((r) => r.type === 'admin')
        ? 'admin'
        : 'member';

    // Issue JWT (same as password login)
    const jwt = signToken(
      {
        userId: user.id,
        role: highestType,
        roles: roles.map((r) => ({ role: r.role, type: r.type })),
      },
      '24h',
    );

    // Redirect to login page with token + user info — plays the comet animation, then navigates
    const returnTo = oauthState.returnTo || '/';
    const displayName = user.display_name || userInfo.displayName || '';
    const userName = user.external_id || '';
    res.redirect(
      `/login?token=${encodeURIComponent(jwt)}` +
      `&returnTo=${encodeURIComponent(returnTo)}` +
      `&displayName=${encodeURIComponent(displayName)}` +
      `&username=${encodeURIComponent(userName)}`,
    );
  } catch (err: any) {
    loggerRegistry.error(`[oauth] callback error for ${provider}: ${err.message}`);
    res.redirect(`/login?error=${encodeURIComponent('OAuth login failed. Please try again.')}`);
  }
});

/**
 * GET /api/auth/oauth/connect/:provider
 * Initiate a credential-only connection flow for an already-authenticated user.
 * Unlike the login flow (GET /:provider), this stores the provider's token
 * against the current user without issuing a new JWT or creating a user.
 * Used for resource providers like Anthropic (API key storage).
 */
// Bridge for browser redirects: accept token from query param since browsers
// can't set Authorization headers during navigation.
router.get('/connect/:provider', (req, res, next) => {
  const token = req.query.token as string;
  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`;
  }
  next();
}, requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const provider = req.params.provider as string;
  const handler = getProvider(provider);
  if (!handler) {
    res.status(404).json({ error: `OAuth provider "${provider}" not configured` });
    return;
  }

  const returnTo = (req.query.returnTo as string) || '/';
  const label = (req.query.label as string) || 'default';
  const { state, codeVerifier } = createOAuthState(provider, returnTo, {
    connectOnly: true,
    userId,
    label,
  });

  const baseUrl = _oauthConfig.baseUrl || `${req.protocol}://${req.get('host')}`;
  if (!handler.config.redirectUri) {
    handler.config.redirectUri = `${baseUrl}/api/auth/oauth/${provider}/callback`;
  }

  const url = await handler.createAuthorizationURL(state, codeVerifier);
  res.redirect(url.toString());
});

/**
 * DELETE /api/auth/oauth/connections/:provider
 * Revoke a stored OAuth connection (requires auth — applied by parent router).
 */
router.delete('/connections/:provider', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const label = (req.query.label as string) || undefined;
  const deleted = await deleteOAuthConnection(userId, req.params.provider, label);
  res.json({ deleted });
});

export default router;
