import { Router, allowAnyOrigin, type Request, type Response } from '../lib/http';
import { requireAuth } from '../modules/auth';
import { getOAuthServerSettings } from '../modules/oauth-server';
import {
  OAUTH_CODE_TTL_SECONDS, OAUTH_REGISTRATIONS_PER_WINDOW, OAUTH_REGISTRATION_WINDOW_SECONDS,
} from '../modules/defaults';
import { registerClient, getClient, issueAuthorizationCode, PRESET_SCOPE } from '../services/auth/oauth-server';
import {
  checkAuthorizationRequest, isGrantPreset, withQuery, type AuthorizationCheck,
} from '../services/auth/oauth-server/authorization';
import { authorizationServerMetadata } from '../services/auth/oauth-server/metadata';
import { validateClientMetadata, RegistrationLimiter } from '../services/auth/oauth-server/registration';

/**
 * OAuth authorization server endpoints under /api/oauth. The public ones
 * (metadata, register) take no Long Tail session and allow any origin. The
 * consent endpoints take the person's dashboard session. Every endpoint
 * answers 404 until the server is configured.
 */
const router = Router();
const CONSENT_PAGE_PATH = '/oauth/consent';
const BOT_PRINCIPAL_TYPE = 'bot';
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

/** Send a failed authorization check: here when the client is untrusted, else back to the client. */
function sendAuthorizationError(res: Response, check: Exclude<AuthorizationCheck, { ok: true }>, issuer: string, asJson: boolean): void {
  if (!check.redirect) {
    res.status(400).json({ error: check.error, error_description: check.description });
    return;
  }
  const redirect = withQuery(check.redirectUri, {
    error: check.error, error_description: check.description, state: check.state, iss: issuer,
  });
  if (asJson) res.json({ redirect });
  else res.redirect(302, redirect);
}

/**
 * GET /api/oauth/authorize
 * The authorization request (RFC 6749 §4.1.1, PKCE S256 required). Redirects
 * to the dashboard consent page with the validated request.
 */
router.get('/authorize', async (req, res) => {
  const settings = getOAuthServerSettings()!;
  const check = await checkAuthorizationRequest(req.query as Record<string, unknown>, settings);
  if (!check.ok) return sendAuthorizationError(res, check, settings.issuer, false);
  const { client, redirectUri, codeChallenge, state, scope, resource } = check.request;
  res.redirect(302, withQuery(`${settings.issuer}${CONSENT_PAGE_PATH}`, {
    client_id: client.client_id, redirect_uri: redirectUri, code_challenge: codeChallenge,
    code_challenge_method: 'S256', response_type: 'code', state, scope, resource,
  }));
});

/** Consent is a person's decision: a bot key may not grant access. */
function refuseBots(req: Request, res: Response): boolean {
  if ((req.auth as { principalType?: string } | undefined)?.principalType !== BOT_PRINCIPAL_TYPE) return false;
  res.status(403).json({ error: 'access_denied', error_description: 'a service account cannot grant access' });
  return true;
}

/**
 * POST /api/oauth/authorize
 * The person approves. Body: the authorization request plus
 * { preset: 'read_only' | 'just_me' }. Returns { redirect } for the consent
 * page to navigate to, carrying the code.
 */
router.post('/authorize', requireAuth, async (req, res) => {
  if (refuseBots(req, res)) return;
  const settings = getOAuthServerSettings()!;
  const check = await checkAuthorizationRequest(req.body ?? {}, settings);
  if (!check.ok) return sendAuthorizationError(res, check, settings.issuer, true);
  const preset = req.body?.preset;
  if (!isGrantPreset(preset)) {
    res.status(400).json({ error: 'invalid_request', error_description: 'preset must be read_only or just_me' });
    return;
  }
  const { client, redirectUri, codeChallenge, state, resource } = check.request;
  const { code } = await issueAuthorizationCode({
    userId: req.auth!.userId, clientId: client.client_id, policy: { preset }, scope: PRESET_SCOPE[preset],
    redirectUri, codeChallenge, resource, ttlSeconds: OAUTH_CODE_TTL_SECONDS,
  });
  res.json({ redirect: withQuery(redirectUri, { code, state, iss: settings.issuer }) });
});

/**
 * POST /api/oauth/deny
 * The person declines. Body: { client_id, redirect_uri, state? }. Returns
 * { redirect } carrying error=access_denied.
 */
router.post('/deny', requireAuth, async (req, res) => {
  const settings = getOAuthServerSettings()!;
  const clientId = typeof req.body?.client_id === 'string' ? req.body.client_id : '';
  const client = clientId ? await getClient(clientId) : null;
  const redirectUri = req.body?.redirect_uri;
  if (!client || typeof redirectUri !== 'string' || !client.redirect_uris.includes(redirectUri)) {
    res.status(400).json({ error: 'invalid_request', error_description: 'unknown client or redirect_uri' });
    return;
  }
  const state = typeof req.body?.state === 'string' ? req.body.state : undefined;
  res.json({ redirect: withQuery(redirectUri, { error: 'access_denied', state, iss: settings.issuer }) });
});

/**
 * GET /api/oauth/clients/:id
 * The client the consent page is asking about.
 */
router.get('/clients/:id', requireAuth, async (req, res) => {
  const client = await getClient(String(req.params.id));
  if (!client) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ client_id: client.client_id, client_name: client.client_name, redirect_uris: client.redirect_uris });
});

export default router;
