import { Router, allowAnyOrigin } from '../lib/http';
import { getOAuthServerSettings } from '../modules/oauth-server';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  wellKnownPaths,
} from '../services/auth/oauth-server/metadata';

/**
 * The two OAuth well-known documents, mounted at the host's root. Answers
 * exactly those paths and passes every other request on, so it never shadows
 * the host's routes. Paths are computed per request because the issuer is
 * configured after the router is mounted.
 */
export function createWellKnownRouter(): Router {
  const router = Router();
  const cors = allowAnyOrigin(['GET']);

  router.use((req, res, next) => {
    const settings = getOAuthServerSettings();
    if (!settings || (req.method !== 'GET' && req.method !== 'OPTIONS')) return next();
    const paths = wellKnownPaths(settings);
    const document = req.path === paths.authorizationServer
      ? authorizationServerMetadata(settings)
      : req.path === paths.protectedResource
        ? protectedResourceMetadata(settings)
        : null;
    if (!document) return next();
    cors(req, res, () => res.json(document));
  });

  return router;
}
