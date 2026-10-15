import { Router, allowAnyOrigin } from '../../lib/http';
import { getOAuthServerSettings } from '../../modules/oauth-server';
import { OAUTH_REGISTRATIONS_PER_WINDOW, OAUTH_REGISTRATION_WINDOW_SECONDS } from '../../modules/defaults';
import { registerClient } from '../../services/auth/oauth-server';
import { validateClientMetadata, RegistrationLimiter, registrationAddressKey } from '../../services/auth/oauth-server/registration';

const router = Router();
const limiter = new RegistrationLimiter(OAUTH_REGISTRATIONS_PER_WINDOW, OAUTH_REGISTRATION_WINDOW_SECONDS * 1000);

/**
 * POST /api/oauth/register
 * Dynamic client registration (RFC 7591) for public clients.
 * Body: { redirect_uris, client_name?, grant_types?, response_types?, token_endpoint_auth_method? }
 */
router.options('/register', allowAnyOrigin(['POST']));
router.post('/register', allowAnyOrigin(['POST']), async (req, res) => {
  if (!limiter.allow(registrationAddressKey(req.ip ?? 'unknown'))) {
    res.status(429).json({ error: 'rate_limited', error_description: 'too many client registrations; try again later' });
    return;
  }
  const settings = getOAuthServerSettings()!;
  const checked = validateClientMetadata(req.body, settings.allowedRedirectUris);
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
