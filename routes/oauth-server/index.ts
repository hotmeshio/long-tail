import { Router, allowAnyOrigin, type Request, type Response, type NextFunction } from '../../lib/http';
import { getOAuthServerSettings } from '../../modules/oauth-server';
import { authorizationServerMetadata } from '../../services/auth/oauth-server/metadata';
import registrationRouter from './registration';
import authorizeRouter from './authorize';
import tokenRouter from './token';
import grantsRouter from './grants';

/**
 * OAuth authorization server endpoints under /api/oauth. The public ones
 * (metadata, register, token, revoke) take no Long Tail session and allow
 * any origin. The consent endpoints take the person's dashboard session.
 * Every endpoint answers 404 until the server is configured.
 */
const router = Router();

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

router.use(registrationRouter);
router.use(authorizeRouter);
router.use(tokenRouter);
router.use(grantsRouter);

/**
 * Anything an endpoint did not answer itself answers in the RFC 6749 error
 * shape: a body that does not parse is the client's error, anything else the
 * server's. No message or stack reaches the client.
 */
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const malformed = err?.type === 'entity.parse.failed' || err?.status === 400;
  res.status(malformed ? 400 : 500).json(malformed
    ? { error: 'invalid_request', error_description: 'the request body is malformed' }
    : { error: 'server_error', error_description: 'the request could not be completed' });
});

export default router;
