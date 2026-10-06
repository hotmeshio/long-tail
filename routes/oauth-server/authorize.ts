import { Router, type Request, type Response } from '../../lib/http';
import { requireAuth } from '../../modules/auth';
import { getOAuthServerSettings } from '../../modules/oauth-server';
import { OAUTH_CODE_TTL_SECONDS } from '../../modules/defaults';
import { getClient, issueAuthorizationCode, PRESET_SCOPE } from '../../services/auth/oauth-server';
import {
  checkAuthorizationRequest, grantablePresets, isGrantPreset, withQuery, type AuthorizationCheck,
} from '../../services/auth/oauth-server/authorization';
import { getUserRoles } from '../../services/user';

const router = Router();
const CONSENT_PAGE_PATH = '/oauth/consent';
const BOT_PRINCIPAL_TYPE = 'bot';

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
  if (!grantablePresets(await getUserRoles(req.auth!.userId)).includes(preset)) {
    res.status(403).json({ error: 'access_denied', error_description: `you may not grant ${preset}` });
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
