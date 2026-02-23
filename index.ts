import express from 'express';

import { config } from './modules/config';
import { migrate } from './services/db/migrate';
import { startWorkers } from './workers';
import { telemetryRegistry } from './services/telemetry';
import { HoneycombTelemetryAdapter } from './services/telemetry/honeycomb';
import routes from './routes';

// ─── Package Exports ─────────────────────────────────────────────────────────

export { createLTInterceptor } from './interceptor';
export { createLTActivityInterceptor } from './interceptor/activity-interceptor';
export { executeLT } from './orchestrator';
export type { ExecuteLTOptions } from './orchestrator';
export { JwtAuthAdapter, createAuthMiddleware, requireAuth, signToken } from './modules/auth';
export * from './types';
export * as TaskService from './services/task';
export * as EscalationService from './services/escalation';
export * as ConfigService from './services/config';
export * as UserService from './services/user';
export { ltConfig } from './modules/ltconfig';
export { eventRegistry } from './services/events';
export { NatsEventAdapter } from './services/events/nats';
export { InMemoryEventAdapter } from './services/events/memory';
export { publishMilestoneEvent } from './services/events/publish';
export { telemetryRegistry } from './services/telemetry';
export { HoneycombTelemetryAdapter } from './services/telemetry/honeycomb';

// ─── Server ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('[long-tail] starting...');

  // 0. Register telemetry adapter (if HONEYCOMB_API_KEY is set)
  //    Read from process.env directly since dotenv loads after module init.
  const honeycombKey = process.env.HONEYCOMB_API_KEY;
  if (honeycombKey) {
    telemetryRegistry.register(new HoneycombTelemetryAdapter({
      apiKey: honeycombKey,
    }));
  }

  // 1. Run database migrations
  console.log('[long-tail] running migrations...');
  await migrate();

  // 2. Start HotMesh workers + interceptor (telemetry connects first)
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
