import { Router, allowAnyOrigin } from '../lib/http';
import { getOAuthServerSettings } from '../modules/oauth-server';
import { OAUTH_REGISTRATIONS_PER_WINDOW, OAUTH_REGISTRATION_WINDOW_SECONDS } from '../modules/defaults';
import { registerClient } from '../services/auth/oauth-server';
import { authorizationServerMetadata } from '../services/auth/oauth-server/metadata';
import { validateClientMetadata, RegistrationLimiter } from '../services/auth/oauth-server/registration';

/**
 * OAuth authorization server endpoints under /api/oauth. The public ones
 * (metadata, register) take no Long Tail session and allow any origin.
 * Every endpoint answers 404 until the server is configured.
 */
const router = Router();
const limiter = new RegistrationLimiter(OAUTH_REGISTRATIONS_PER_WINDOW, OAUTH_REGISTRATION_WINDOW_SECONDS * 1000);

router.use((_req, res, next) => {
  if (!getOAuthServerSettings()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
});

/**
 * GET /api/oauth/metadata
 * The authorization server metadata, for clients that do not use the
 * well-known document.
 */
router.get('/metadata', allowAnyOrigin(['GET']), (_req, res) => {
  res.json(authorizationServerMetadata(getOAuthServerSettings()!));
});

/**
 * POST /api/oauth/register
 * Dynamic client registration (RFC 7591) for public clients.
 * Body: { redirect_uris, client_name?, grant_types?, response_types?, token_endpoint_auth_method? }
 */
router.options('/register', allowAnyOrigin(['POST']));
router.post('/register', allowAnyOrigin(['POST']), async (req, res) => {
  if (!limiter.allow(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'rate_limited', error_description: 'too many client registrations; try again later' });
    return;
  }
  const settings = getOAuthServerSettings()!;
  const checked = validateClientMetadata(req.body, settings.allowedRedirectHosts);
  if (!checked.ok) {
    res.status(400).json({ error: checked.error, error_description: checked.description });
    return;
  }
  const client = await registerClient({ clientName: checked.clientName, redirectUris: checked.redirectUris });
  res.status(201).json({
    client_id: client.client_id,
    client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
    client_name: client.client_name ?? undefined,
    redirect_uris: client.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});

export default router;
