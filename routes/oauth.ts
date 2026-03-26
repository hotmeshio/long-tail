import { Router } from 'express';

import { signToken } from '../modules/auth';
import { loggerRegistry } from '../services/logger';
import {
  listProviders,
  getProvider,
  createOAuthState,
  consumeOAuthState,
  upsertOAuthToken,
  getUserByOAuthProvider,
  deleteOAuthConnection,
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
 * GET /api/auth/oauth/:provider
 * Initiate the OAuth flow — redirects the browser to the provider.
 */
router.get('/:provider', (req, res) => {
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

  const url = handler.createAuthorizationURL(state, codeVerifier);
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
 * DELETE /api/auth/oauth/connections/:provider
 * Revoke a stored OAuth connection (requires auth — applied by parent router).
 */
router.delete('/connections/:provider', async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const deleted = await deleteOAuthConnection(userId, req.params.provider);
  res.json({ deleted });
});

export default router;
