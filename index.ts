import { config } from './modules/config';
import { loggerRegistry } from './lib/logger';
import { midnightTheme } from './themes/midnight';

import { start } from './start';

// ─── Package Exports ─────────────────────────────────────────────────────────

export { start } from './start';
export { midnightTheme } from './themes/midnight';
export { registerLT, createLTInterceptor } from './services/interceptor';
export { createLTActivityInterceptor } from './services/interceptor/activity-interceptor';
export { executeLT } from './services/orchestrator';
export { conditional, conditionLT, conditionalAccumulator } from './services/orchestrator/condition';
export type { ConditionEscalationConfig, ConditionAccumulatorConfig } from './services/orchestrator/condition';
export type { ExecuteLTOptions } from './services/orchestrator/types';
export { JwtAuthAdapter, createAuthMiddleware, requireAuth, requireAdmin, signToken, setAuthAdapter } from './modules/auth';
export * from './types';
export * as TaskService from './services/task';
export * as EscalationService from './services/escalation';
export * as ConfigService from './services/config';
export * as UserService from './services/user';
export * as TopicService from './services/topics';
export { seedSystemTopics, seedConfigTopics } from './services/topics/system-topics';
export { ltConfig } from './modules/ltconfig';
export { eventRegistry } from './lib/events';
export { NatsEventAdapter } from './lib/events/nats';
export { InMemoryEventAdapter } from './lib/events/memory';
export { SocketIOEventAdapter, type SocketIOAuthenticator } from './lib/events/socketio';
export { publishMilestoneEvent, publishTaskEvent, publishEscalationEvent, publishActivityEvent, publishWorkflowEvent, publishAgentEvent, publishKnowledgeEvent } from './lib/events/publish';
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
export { getActivityIdentity } from './services/iam/activity';
export { getToolContext } from './services/iam/context';
export { registerMcpTool } from './services/mcp/register-tool';
export { getSystemWorkers, getSystemAgents, builtinMcpServerFactories } from './system';
export { CallbackEventAdapter } from './lib/events/callback';
export { createClient } from './sdk';
export { getFreshAccessToken, listOAuthConnections } from './services/oauth';
export { getStorageBackend } from './lib/storage';
export { mimeFromPath } from './lib/storage/mime';
export { resolveCredential } from './services/iam/credentials';
export * as KnowledgeApi from './api/knowledge';
export type { LTClient, LTClientOptions } from './sdk';
export * as api from './api';
export { LTExpressAdapter } from './adapters/express';

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
    seed: {
      admin: {
        externalId: 'superadmin',
        displayName: 'Super Admin',
        email: 'admin@longtail.local',
        password: 'l0ngt@1l',
      },
    },
    examples: true,
    // Code-owned declaration for the reviewer queue the examples route to: a
    // portal that leads with the queue's counts and lays its lists beneath.
    // `reset` keeps the declaration applied on every boot.
    roles: [
      {
        role: 'reviewer',
        title: 'Reviewer',
        reset: true,
        portals: [
          {
            key: 'review-desk',
            label: 'Review desk',
            counts: [
              { label: 'Waiting', url: '/escalations/available?role=reviewer', blurb: 'Unclaimed items in the queue' },
              { label: 'In progress', url: '/escalations/available?role=reviewer&status=claimed', blurb: 'Claimed and being worked' },
              { label: 'Resolved', url: '/escalations/available?role=reviewer&status=resolved', blurb: 'Closed out by a reviewer' },
              { label: 'Expired', url: '/escalations/available?role=reviewer&status=expired', blurb: 'Timed out before anyone acted' },
              { label: 'Cancelled', url: '/escalations/available?role=reviewer&status=cancelled', blurb: 'Withdrawn by the workflow' },
            ],
            rows: [
              [
                { label: 'Waiting', url: '/escalations/available?role=reviewer&view=table&layout=compact', badge: true },
                { label: 'In progress', url: '/escalations/available?role=reviewer&status=claimed&view=table&layout=compact', badge: true },
              ],
            ],
          },
        ],
      },
      {
        // The rollup-bin example's container queue: the list shows each
        // bin's fill level from the accumulator facets.
        role: 'bin',
        title: 'Bin',
        description: 'Open containers filling with scanned bags. Ships at max or when the window closes.',
        reset: true,
        list_schema: {
          'x-lt-layout': 'facet-table',
          'x-lt-columns': [
            { label: 'Bin', value: '{{metadata.binKey}}' },
            { label: 'Held', value: '{{metadata.accumulate_count}}' },
            { label: 'Max', value: '{{metadata.accumulate_max}}', priority: 2 },
            { label: 'Open since', value: '{{escalation.created_at}}', format: 'age', priority: 2 },
          ],
        },
      },
      {
        role: 'bag',
        title: 'Bag',
        description: 'Bags waiting to be scanned into a bin.',
        reset: true,
        list_schema: {
          'x-lt-layout': 'facet-table',
          'x-lt-columns': [
            { label: 'Order', value: '{{metadata.orderId}}' },
            { label: 'Bin', value: '{{metadata.binKey}}', priority: 2 },
            { label: 'Waiting', value: '{{escalation.created_at}}', format: 'age', priority: 2 },
          ],
        },
      },
    ],
    features: {
      // The examples ship the full scan demo (schemes 10/11); surface it.
      scanCodes: true,
    },
    search: {
      // The examples surface the global search bar with the seed data's
      // primary facet; escalationId/workflowId are always present.
      enabled: true,
      facets: ['orderId'],
    },
    mcp: {
      server: { enabled: true },
    },
    escalation: {
      strategy: 'mcp',
    },
    branding: {
      ...(process.env.WHITE_LABEL ? { appName: process.env.WHITE_LABEL } : {}),
      // Midnight ships as a registered theme — the working proof that a
      // deployment-supplied stylesheet controls the entire design system.
      themes: [midnightTheme],
    },
    telemetry: honeycombKey ? { honeycomb: { apiKey: honeycombKey } } : undefined,
    events: config.EVENT_TRANSPORT === 'nats'
      ? { nats: { url: config.NATS_URL, wsUrl: config.NATS_WS_URL || undefined, token: config.NATS_TOKEN || undefined } }
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
