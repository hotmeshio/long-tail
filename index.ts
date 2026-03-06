import { config } from './modules/config';
import { loggerRegistry } from './services/logger';

import { start } from './start';

// ─── Package Exports ─────────────────────────────────────────────────────────

export { start } from './start';
export { registerLT, createLTInterceptor } from './interceptor';
export { createLTActivityInterceptor } from './interceptor/activity-interceptor';
export { executeLT } from './orchestrator';
export type { ExecuteLTOptions } from './orchestrator';
export { JwtAuthAdapter, createAuthMiddleware, requireAuth, requireAdmin, signToken } from './modules/auth';
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
export { loggerRegistry } from './services/logger';
export { PinoLoggerAdapter } from './services/logger/pino';
export { maintenanceRegistry } from './services/maintenance';
export { defaultMaintenanceConfig } from './modules/maintenance';
export { mcpRegistry } from './services/mcp';
export { BuiltInMcpAdapter } from './services/mcp/adapter';
export * as McpService from './services/mcp/db';
export * as McpClient from './services/mcp/client';
export * as McpServer from './services/mcp/server';
export * as McpVisionServer from './services/mcp/vision-server';
export * as McpTelemetryServer from './services/mcp/telemetry-server';
export { escalationStrategyRegistry } from './services/escalation-strategy';
export { DefaultEscalationStrategy } from './services/escalation-strategy/default';
export { McpEscalationStrategy } from './services/escalation-strategy/mcp';
export { exampleWorkers, seedExamples } from './examples';

// ─── Server ──────────────────────────────────────────────────────────────────

async function main() {
  const honeycombKey = process.env.HONEYCOMB_API_KEY;

  await start({
    database: {
      host: config.POSTGRES_HOST,
      port: config.POSTGRES_PORT,
      user: config.POSTGRES_USER,
      password: config.POSTGRES_PASSWORD,
      database: config.POSTGRES_DB,
    },
    server: {
      port: config.PORT,
    },
    examples: true,
    mcp: {
      server: { enabled: true },
    },
    escalation: {
      strategy: 'mcp',
    },
    telemetry: honeycombKey ? { honeycomb: { apiKey: honeycombKey } } : undefined,
    events: config.NATS_URL ? { nats: { url: config.NATS_URL } } : undefined,
  });
}

// Run server when executed directly
if (require.main === module) {
  require('dotenv').config();
  main().catch((err) => {
    loggerRegistry.error(`[long-tail] fatal: ${err}`);
    process.exit(1);
  });
}
