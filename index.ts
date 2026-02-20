import express from 'express';

import { config } from './modules/config';
import { migrate } from './services/db/migrate';
import { startWorkers } from './workers';
import routes from './routes';

// ─── Package Exports ─────────────────────────────────────────────────────────

export { createLTInterceptor } from './interceptor';
export { executeLT } from './lib/executeLT';
export type { ExecuteLTOptions } from './lib/executeLT';
export { JwtAuthAdapter, createAuthMiddleware, requireAuth, signToken } from './modules/auth';
export * from './types';
export * as TaskService from './services/task';
export * as EscalationService from './services/escalation';
export * as ConfigService from './services/config';
export * as UserService from './services/user';
export { ltConfig } from './modules/ltconfig';

// ─── Server ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('[long-tail] starting...');

  // 1. Run database migrations
  console.log('[long-tail] running migrations...');
  await migrate();

  // 2. Start HotMesh workers + interceptor
  console.log('[long-tail] starting workers...');
  await startWorkers();

  // 3. Start Express server
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api', routes);

  app.listen(config.PORT, () => {
    console.log(`[long-tail] server running on port ${config.PORT}`);
    console.log(`[long-tail] API: http://localhost:${config.PORT}/api`);
    console.log(`[long-tail] Health: http://localhost:${config.PORT}/health`);
  });
}

// Run server when executed directly
if (require.main === module) {
  require('dotenv').config();
  main().catch((err) => {
    console.error('[long-tail] fatal:', err);
    process.exit(1);
  });
}
