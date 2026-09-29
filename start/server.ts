import type { Server } from 'http';

import { LTExpressAdapter } from '../adapters/express';
import { createApp } from '../lib/http';
import { config } from '../modules/config';
import { loggerRegistry } from '../lib/logger';

/**
 * Create and start the standalone server. It owns its app and mounts the
 * same router an embedding host mounts, at the root, so standalone and
 * embedded deployments serve one surface.
 */
export function startServer(adapter: LTExpressAdapter): Server {
  const app = createApp();
  if (process.env.NODE_ENV !== 'production') {
    app.disable('etag');
  }
  app.use(adapter.getWellKnownRouter());
  app.use(adapter.getRouter());

  const httpServer = app.listen(config.PORT, () => {
    loggerRegistry.info(`[long-tail] server running on port ${config.PORT}`);
    loggerRegistry.info(`[long-tail] API: http://localhost:${config.PORT}/api`);
    loggerRegistry.info(`[long-tail] Health: http://localhost:${config.PORT}/health`);
    if (adapter.hasDashboard()) {
      loggerRegistry.info(`[long-tail] Dashboard: http://localhost:${config.PORT}/`);
    }
  });

  return httpServer;
}
