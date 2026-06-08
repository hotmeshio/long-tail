import { existsSync, readFileSync } from 'fs';
import path from 'path';
import express from 'express';

import { config } from '../modules/config';
import { loggerRegistry } from '../lib/logger';
import routes from '../routes';
import mcpEndpoint from '../routes/mcp-endpoint';

/**
 * Create and start the embedded Express server with health check,
 * API routes, and optional dashboard static assets.
 */
export function startServer(): ReturnType<typeof express.application.listen> {
  const app = express();
  if (process.env.NODE_ENV !== 'production') {
    app.disable('etag');
  }
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', routes);
  app.use('/mcp', mcpEndpoint);

  // Serve dashboard static assets
  // Resolves correctly in both dev (ts-node from root) and prod (node build/)
  const devDist = path.join(__dirname, '..', 'dashboard', 'dist');
  const prodDist = path.join(__dirname, '..', '..', 'dashboard', 'dist');
  const dashboardDist = existsSync(devDist) ? devDist : prodDist;

  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist, { index: false }));

    // SPA fallback — inject <base href="/"> so relative asset paths
    // resolve from root regardless of route depth (e.g. /admin/users).
    // Read on each request so dashboard rebuilds take effect without restart.
    const indexPath = path.join(dashboardDist, 'index.html');

    app.get('/{*splat}', (_req, res) => {
      const html = readFileSync(indexPath, 'utf-8').replace('<head>', '<head><base href="/">');
      res.type('html').send(html);
    });

    loggerRegistry.info(`[long-tail] Dashboard: http://localhost:${config.PORT}/`);
  }

  const httpServer = app.listen(config.PORT, () => {
    loggerRegistry.info(`[long-tail] server running on port ${config.PORT}`);
    loggerRegistry.info(`[long-tail] API: http://localhost:${config.PORT}/api`);
    loggerRegistry.info(`[long-tail] Health: http://localhost:${config.PORT}/health`);
  });

  return httpServer;
}
