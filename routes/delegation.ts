import { Router } from 'express';

import { validateDelegationToken, requireScope } from '../services/auth/delegation';
import { validateServiceToken } from '../services/auth/service-token';
import { getFreshAccessToken } from '../services/oauth';

const router = Router();

/**
 * GET /api/delegation/oauth/:provider/token
 *
 * Returns a fresh OAuth access token for the user identified in
 * the delegation token. Requires scope `oauth:<provider>:read`.
 *
 * Auth: Bearer <delegation-token>
 */
router.get('/oauth/:provider/token', async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Delegation token required' });
    return;
  }

  try {
    const payload = validateDelegationToken(header.slice(7));
    const { provider } = req.params;
    requireScope(payload, `oauth:${provider}:read`);
    const label = (req.query.label as string) || undefined;

    const token = await getFreshAccessToken(payload.sub, provider, label);
    res.json({
      access_token: token.accessToken,
      expires_at: token.expiresAt?.toISOString() ?? null,
      scopes: token.scopes,
      provider,
    });
  } catch (err: any) {
    const status = err.message.includes('missing required scope') ? 403 : 401;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/delegation/validate
 *
 * Validates a delegation token and returns its claims.
 * Used by external MCP servers to verify tokens they receive.
 *
 * Auth: Bearer <service-token>
 * Body: { token: string }
 */
router.post('/validate', async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Service token required' });
    return;
  }

  // Validate the service token
  const serviceRecord = await validateServiceToken(header.slice(7));
  if (!serviceRecord) {
    res.status(401).json({ error: 'Invalid service token' });
    return;
  }

  const { token } = req.body || {};
  if (!token) {
    res.status(400).json({ error: 'token field required in body' });
    return;
  }

  try {
    const payload = validateDelegationToken(token);
    res.json({
      valid: true,
      userId: payload.sub,
      scopes: payload.scopes,
      workflowId: payload.workflowId,
      serverId: payload.serverId,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    });
  } catch (err: any) {
    res.json({ valid: false, error: err.message });
  }
});

export default router;
