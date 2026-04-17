import { config } from './modules/config';
import { loggerRegistry } from './lib/logger';

import { start } from './start';

// ─── Package Exports ─────────────────────────────────────────────────────────

export { start } from './start';
export { registerLT, createLTInterceptor } from './services/interceptor';
export { createLTActivityInterceptor } from './services/interceptor/activity-interceptor';
export { executeLT } from './services/orchestrator';
export type { ExecuteLTOptions } from './services/orchestrator/types';
export { JwtAuthAdapter, createAuthMiddleware, requireAuth, requireAdmin, signToken } from './modules/auth';
export * from './types';
export * as TaskService from './services/task';
export * as EscalationService from './services/escalation';
export * as ConfigService from './services/config';
export * as UserService from './services/user';
export { ltConfig } from './modules/ltconfig';
export { eventRegistry } from './lib/events';
export { NatsEventAdapter } from './lib/events/nats';
export { InMemoryEventAdapter } from './lib/events/memory';
export { SocketIOEventAdapter } from './lib/events/socketio';
export { publishMilestoneEvent, publishTaskEvent, publishEscalationEvent, publishWorkflowEvent } from './lib/events/publish';
export { telemetryRegistry } from './lib/telemetry';
export { HoneycombTelemetryAdapter } from './lib/telemetry/honeycomb';
export { loggerRegistry } from './lib/logger';
export { PinoLoggerAdapter } from './lib/logger/pino';
export { maintenanceRegistry } from './services/maintenance';
export { defaultMaintenanceConfig } from './modules/maintenance';
export { mcpRegistry } from './services/mcp';
export { BuiltInMcpAdapter } from './services/mcp/adapter';
export * as McpService from './services/mcp/db';
export * as McpClient from './services/mcp/client';
export * as McpServer from './services/mcp/server';
export * as McpTranslationServer from './system/mcp-servers/translation';
export * as McpVisionServer from './system/mcp-servers/vision';
export { escalationStrategyRegistry } from './services/escalation-strategy';
export { DefaultEscalationStrategy } from './services/escalation-strategy/default';
export { McpEscalationStrategy } from './services/escalation-strategy/mcp';
export { exampleWorkers, seedExamples } from './examples';
export { getActivityIdentity } from './services/iam/activity';
export { getToolContext } from './services/iam/context';
export { registerMcpTool } from './services/mcp/register-tool';
export { getSystemWorkers, builtinMcpServerFactories } from './system';
export { seedSystemMcpServers } from './system/seed';

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
    events: process.env.NATS_URL
      ? { nats: { url: config.NATS_URL, token: process.env.NATS_TOKEN || 'dev_api_secret' } }
      : undefined,
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
