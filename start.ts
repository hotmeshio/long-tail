import express from 'express';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { config, postgres_options } from './modules/config';
import { setAuthAdapter } from './modules/auth';
import { migrate } from './services/db/migrate';
import { registerLT } from './interceptor';
import { loggerRegistry } from './services/logger';
import { PinoLoggerAdapter } from './services/logger/pino';
import { telemetryRegistry } from './services/telemetry';
import { HoneycombTelemetryAdapter } from './services/telemetry/honeycomb';
import { eventRegistry } from './services/events';
import { NatsEventAdapter } from './services/events/nats';
import { maintenanceRegistry } from './services/maintenance';
import { defaultMaintenanceConfig } from './modules/maintenance';
import { mcpRegistry } from './services/mcp';
import { BuiltInMcpAdapter } from './services/mcp/adapter';
import { escalationStrategyRegistry } from './services/escalation-strategy';
import { DefaultEscalationStrategy } from './services/escalation-strategy/default';
import { McpEscalationStrategy } from './services/escalation-strategy/mcp';
import routes from './routes';

import type { LTStartConfig, LTInstance } from './types/startup';

/**
 * Start Long Tail with a declarative configuration.
 *
 * Handles database connection, migrations, adapter registration,
 * worker startup, and the embedded API server. Returns a client
 * for starting workflows and a shutdown function.
 *
 * ```typescript
 * import { start } from '@hotmeshio/long-tail';
 * import * as myWorkflow from './workflows/my-workflow';
 *
 * const lt = await start({
 *   database: { host: 'localhost', port: 5432, user: 'postgres', password: 'password', database: 'mydb' },
 *   workers: [
 *     { taskQueue: 'my-queue', workflow: myWorkflow.myWorkflow },
 *   ],
 * });
 * ```
 */
export async function start(startConfig: LTStartConfig): Promise<LTInstance> {
  // ── 1. Apply database config ────────────────────────────────────────────
  const db = startConfig.database;
  if (db.connectionString) {
    // pg accepts connectionString as a top-level option
    Object.assign(postgres_options, {
      connectionString: db.connectionString,
      host: undefined,
      port: undefined,
      user: undefined,
      password: undefined,
      database: undefined,
    });
  } else {
    Object.assign(postgres_options, {
      host: db.host ?? postgres_options.host,
      port: db.port ?? postgres_options.port,
      user: db.user ?? postgres_options.user,
      password: db.password ?? postgres_options.password,
      database: db.database ?? (postgres_options as any).database,
    });
  }

  // ── 2. Apply server/auth config ─────────────────────────────────────────
  const serverEnabled = startConfig.server?.enabled !== false;
  const serverPort = startConfig.server?.port ?? config.PORT;
  config.PORT = serverPort;

  if (startConfig.auth?.secret) {
    config.JWT_SECRET = startConfig.auth.secret;
  }
  if (startConfig.auth?.adapter) {
    setAuthAdapter(startConfig.auth.adapter);
  }

  // ── 3. Register adapters ────────────────────────────────────────────────
  // Logging (register first so subsequent log calls use it)
  if (startConfig.logging?.adapter) {
    loggerRegistry.register(startConfig.logging.adapter);
  } else if (startConfig.logging?.pino) {
    loggerRegistry.register(new PinoLoggerAdapter(startConfig.logging.pino));
  }

  loggerRegistry.info('[long-tail] starting...');

  // Telemetry
  if (startConfig.telemetry?.adapter) {
    telemetryRegistry.register(startConfig.telemetry.adapter);
  } else if (startConfig.telemetry?.honeycomb) {
    telemetryRegistry.register(new HoneycombTelemetryAdapter(startConfig.telemetry.honeycomb));
  }

  // Events
  if (startConfig.events?.adapters) {
    for (const adapter of startConfig.events.adapters) {
      eventRegistry.register(adapter);
    }
  } else if (startConfig.events?.nats) {
    eventRegistry.register(new NatsEventAdapter(startConfig.events.nats));
  }

  // Maintenance
  if (startConfig.maintenance === false) {
    // Disabled — do nothing
  } else if (startConfig.maintenance === true || startConfig.maintenance === undefined) {
    maintenanceRegistry.register(defaultMaintenanceConfig);
  } else {
    maintenanceRegistry.register(startConfig.maintenance);
  }

  // Escalation strategy
  if (startConfig.escalation?.adapter) {
    escalationStrategyRegistry.register(startConfig.escalation.adapter);
  } else if (startConfig.escalation?.strategy === 'mcp') {
    escalationStrategyRegistry.register(new McpEscalationStrategy());
  } else {
    escalationStrategyRegistry.register(new DefaultEscalationStrategy());
  }

  // MCP
  if (startConfig.mcp?.adapter) {
    mcpRegistry.register(startConfig.mcp.adapter);
  } else if (startConfig.mcp) {
    mcpRegistry.register(new BuiltInMcpAdapter({
      server: startConfig.mcp.server,
      autoConnect: startConfig.mcp.autoConnect,
    }));
  }

  // ── 4. Run migrations ──────────────────────────────────────────────────
  loggerRegistry.info('[long-tail] running migrations...');
  await migrate();

  // ── 5. Start workers (if configured) ───────────────────────────────────
  const connection = { class: Postgres, options: postgres_options };
  let httpServer: ReturnType<typeof express.application.listen> | null = null;

  if (startConfig.workers?.length) {
    // Connect telemetry BEFORE HotMesh starts
    if (telemetryRegistry.hasAdapter) {
      await telemetryRegistry.connect();
    }

    // Register LT interceptors
    await registerLT(connection, {
      defaultRole: startConfig.interceptor?.defaultRole ?? 'reviewer',
      defaultModality: startConfig.interceptor?.defaultModality ?? 'default',
    });

    // Start each worker
    for (const w of startConfig.workers) {
      const worker = await Durable.Worker.create({
        connection,
        taskQueue: w.taskQueue,
        workflow: w.workflow,
      });
      await worker.run();
    }

    loggerRegistry.info(
      `[long-tail] workers started on queues: ${startConfig.workers.map((w) => w.taskQueue).join(', ')}`,
    );

    // Connect event adapters
    if (eventRegistry.hasAdapters) {
      await eventRegistry.connect();
      loggerRegistry.info('[long-tail] event adapters connected');
    }

    // Start maintenance cron
    if (maintenanceRegistry.hasConfig) {
      await maintenanceRegistry.connect();
      loggerRegistry.info('[long-tail] maintenance cron started');
    }

    // Connect MCP adapter
    if (mcpRegistry.hasAdapter) {
      await mcpRegistry.connect();
      loggerRegistry.info('[long-tail] MCP adapter connected');
    }
  }

  // ── 6. Start embedded server (if enabled) ──────────────────────────────
  if (serverEnabled) {
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.use('/api', routes);

    httpServer = app.listen(serverPort, () => {
      loggerRegistry.info(`[long-tail] server running on port ${serverPort}`);
      loggerRegistry.info(`[long-tail] API: http://localhost:${serverPort}/api`);
      loggerRegistry.info(`[long-tail] Health: http://localhost:${serverPort}/health`);
    });
  }

  // ── 7. Return instance ─────────────────────────────────────────────────
  const client = new Durable.Client({ connection });

  const shutdown = async () => {
    loggerRegistry.info('[long-tail] shutting down...');
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    if (mcpRegistry.hasAdapter) {
      await mcpRegistry.disconnect();
    }
    if (maintenanceRegistry.hasConfig) {
      await maintenanceRegistry.disconnect();
    }
    if (eventRegistry.hasAdapters) {
      await eventRegistry.disconnect();
    }
    if (telemetryRegistry.hasAdapter) {
      await telemetryRegistry.disconnect();
    }
    escalationStrategyRegistry.clear();
    await Durable.shutdown();
    loggerRegistry.info('[long-tail] shutdown complete');
  };

  return { client, shutdown };
}
