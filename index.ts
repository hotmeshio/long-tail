import { config } from './modules/config';
import { loggerRegistry } from './services/logger';

import { start } from './start';

import * as reviewContentWorkflow from './workflows/review-content';
import * as verifyDocumentWorkflow from './workflows/verify-document';
import * as verifyDocumentMcpWorkflow from './workflows/verify-document-mcp';
import * as reviewContentOrchWorkflow from './workflows/review-content/orchestrator';
import * as verifyDocumentOrchWorkflow from './workflows/verify-document/orchestrator';
import * as verifyDocumentMcpOrchWorkflow from './workflows/verify-document-mcp/orchestrator';

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
    workers: [
      { taskQueue: 'long-tail', workflow: reviewContentWorkflow.reviewContent },
      { taskQueue: 'long-tail-verify', workflow: verifyDocumentWorkflow.verifyDocument },
      { taskQueue: 'long-tail-verify-mcp', workflow: verifyDocumentMcpWorkflow.verifyDocumentMcp },
      { taskQueue: 'lt-review-orch', workflow: reviewContentOrchWorkflow.reviewContentOrchestrator },
      { taskQueue: 'lt-verify-orch', workflow: verifyDocumentOrchWorkflow.verifyDocumentOrchestrator },
      { taskQueue: 'lt-verify-mcp-orch', workflow: verifyDocumentMcpOrchWorkflow.verifyDocumentMcpOrchestrator },
    ],
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
