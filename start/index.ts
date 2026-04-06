import { Durable } from '@hotmeshio/hotmesh';

import { loggerRegistry } from '../services/logger';
import { telemetryRegistry } from '../services/telemetry';
import { eventRegistry } from '../services/events';
import { maintenanceRegistry } from '../services/maintenance';
import { cronRegistry } from '../services/cron';
import { mcpRegistry } from '../services/mcp';
import { escalationStrategyRegistry } from '../services/escalation-strategy';

import { applyDatabaseConfig, applyServerAuthConfig } from './config';
import { registerAdapters } from './adapters';
import { buildConnection, collectWorkers, startWorkers } from './workers';
import { startServer } from './server';
import { SocketIOEventAdapter } from '../services/events/socketio';

import type { LTStartConfig, LTInstance } from '../types/startup';

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
  // 1. Apply database config
  applyDatabaseConfig(startConfig.database);

  // 2. Apply server/auth config
  await applyServerAuthConfig(startConfig);

  // 3. Register adapters
  registerAdapters(startConfig);
  loggerRegistry.info('[long-tail] starting...');

  // 4-5. Collect workers, run migrations, start workers, seed data
  const { workers, builtinMcpServerFactories } = await collectWorkers(startConfig);
  await startWorkers(startConfig, workers, builtinMcpServerFactories);

  // 6. Start embedded server (if enabled)
  const serverEnabled = startConfig.server?.enabled !== false;
  let httpServer: ReturnType<typeof startServer> | null = null;
  if (serverEnabled) {
    httpServer = startServer();

    // Attach socket.io adapter to the HTTP server (if registered)
    const socketAdapter = eventRegistry.getAdapter(SocketIOEventAdapter);
    if (socketAdapter && httpServer) {
      socketAdapter.attachServer(httpServer);
      await socketAdapter.connect();
    }
  }

  // 7. Return instance
  const connection = buildConnection();
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
