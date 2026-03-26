import { existsSync } from 'fs';
import path from 'path';
import express from 'express';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { config, postgres_options } from './modules/config';
import { setAuthAdapter } from './modules/auth';
import { migrate } from './services/db/migrate';
import { registerLT } from './services/interceptor';
import { loggerRegistry } from './services/logger';
import { PinoLoggerAdapter } from './services/logger/pino';
import { telemetryRegistry } from './services/telemetry';
import { HoneycombTelemetryAdapter } from './services/telemetry/honeycomb';
import { eventRegistry } from './services/events';
import { NatsEventAdapter } from './services/events/nats';
import { maintenanceRegistry } from './services/maintenance';
import { defaultMaintenanceConfig } from './modules/maintenance';
import { cronRegistry } from './services/cron';
import { mcpRegistry } from './services/mcp';
import * as yamlWorkflowWorkers from './services/yaml-workflow/workers';
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

  // Initialize OAuth providers (from startup config and/or env vars)
  const { initializeOAuth } = await import('./services/oauth');
  initializeOAuth(startConfig.auth?.oauth);

  if (startConfig.auth?.oauth) {
    const { setOAuthConfig } = await import('./routes/oauth');
    setOAuthConfig({
      autoProvision: startConfig.auth.oauth.autoProvision,
      defaultRoleType: startConfig.auth.oauth.defaultRoleType,
      baseUrl: startConfig.auth.oauth.baseUrl,
    });
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

  // System workers always load (mcp-triage, insight when OPENAI_API_KEY set)
  const { getSystemWorkers, builtinMcpServerFactories } = await import('./system');
  const allWorkers = [...getSystemWorkers(), ...(startConfig.workers ?? [])];
  loggerRegistry.info('[long-tail] system workflows loaded');

  // Merge example workers when examples flag is set
  if (startConfig.examples) {
    const { exampleWorkers } = await import('./examples');
    allWorkers.push(...exampleWorkers);
    loggerRegistry.info('[long-tail] example workflows loaded');
  }

  if (allWorkers.length) {
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
    for (const w of allWorkers) {
      const worker = await Durable.Worker.create({
        connection,
        taskQueue: w.taskQueue,
        workflow: w.workflow,
      });
      await worker.run();
    }

    loggerRegistry.info(
      `[long-tail] workers started on queues: ${allWorkers.map((w) => w.taskQueue).join(', ')}`,
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

    // Start workflow cron schedules
    await cronRegistry.connect();

    // Connect MCP adapter
    if (mcpRegistry.hasAdapter) {
      await mcpRegistry.connect();
      loggerRegistry.info('[long-tail] MCP adapter connected');
    }

    // Register built-in MCP server factories from system/
    const { registerBuiltinServer } = await import('./services/mcp/client');
    for (const [name, factory] of Object.entries(builtinMcpServerFactories)) {
      registerBuiltinServer(name, factory);
    }
    loggerRegistry.info(`[long-tail] ${Object.keys(builtinMcpServerFactories).length} MCP server factories registered`);

    // Register workers for active YAML (deterministic) workflows
    await yamlWorkflowWorkers.registerAllActiveWorkers();
  }

  // ── 5b. Seed system MCP servers (always) + example data (when enabled) ─
  const { seedSystemMcpServers } = await import('./system/seed');
  await seedSystemMcpServers();

  if (startConfig.examples) {
    const { seedExamples } = await import('./examples');
    const seedClient = new Durable.Client({ connection });
    // Delay slightly to let workers fully register
    setTimeout(() => {
      seedExamples(seedClient).catch((err: any) =>
        loggerRegistry.warn(`[long-tail] seed error: ${err.message}`),
      );
    }, 2000);
  }

  // ── 6. Start embedded server (if enabled) ──────────────────────────────
  if (serverEnabled) {
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.use('/api', routes);

    // Serve dashboard static assets
    // Resolves correctly in both dev (ts-node from root) and prod (node build/)
    const devDist = path.join(__dirname, 'dashboard', 'dist');
    const prodDist = path.join(__dirname, '..', 'dashboard', 'dist');
    const dashboardDist = existsSync(devDist) ? devDist : prodDist;

    if (existsSync(dashboardDist)) {
      app.use(express.static(dashboardDist));

      // SPA fallback — all non-API routes serve index.html
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(dashboardDist, 'index.html'));
      });

      loggerRegistry.info(`[long-tail] Dashboard: http://localhost:${serverPort}/`);
    }

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
    if (cronRegistry.hasActiveCrons) {
      await cronRegistry.disconnect();
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
