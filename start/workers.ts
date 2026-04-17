import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../modules/config';
import { registerLT } from '../services/interceptor';
import { registerWorker } from '../services/workers/registry';
import { loggerRegistry } from '../lib/logger';
import { telemetryRegistry } from '../lib/telemetry';
import { eventRegistry } from '../lib/events';
import { maintenanceRegistry } from '../services/maintenance';
import { cronRegistry } from '../services/cron';
import { mcpRegistry } from '../services/mcp';
import * as yamlWorkflowWorkers from '../services/yaml-workflow/workers';
import { migrate } from '../lib/db/migrate';

import type { LTStartConfig } from '../types/startup';

type WorkerEntry = { taskQueue: string; workflow: (...args: any[]) => any };

/**
 * Build the connection descriptor used by HotMesh / Durable.
 */
export function buildConnection() {
  return { class: Postgres, options: postgres_options };
}

/**
 * Collect all workers: system, optional examples, and user-provided.
 */
export async function collectWorkers(startConfig: LTStartConfig): Promise<{
  workers: WorkerEntry[];
  builtinMcpServerFactories: Record<string, any>;
}> {
  const { getSystemWorkers, builtinMcpServerFactories } = await import('../system');
  const workers: WorkerEntry[] = [
    ...getSystemWorkers(),
    ...(startConfig.workers ?? []),
  ];
  loggerRegistry.info('[long-tail] system workflows loaded');

  if (startConfig.examples) {
    const { exampleWorkers } = await import('../examples');
    workers.push(...exampleWorkers);
    loggerRegistry.info('[long-tail] example workflows loaded');
  }

  return { workers, builtinMcpServerFactories };
}

/**
 * Run database migrations, start all workers, connect adapters,
 * register MCP server factories, and seed data.
 */
export async function startWorkers(
  startConfig: LTStartConfig,
  workers: WorkerEntry[],
  builtinMcpServerFactories: Record<string, any>,
): Promise<void> {
  // Run migrations
  loggerRegistry.info('[long-tail] running migrations...');
  await migrate();

  const connection = buildConnection();

  if (workers.length) {
    // Connect telemetry before HotMesh starts
    if (telemetryRegistry.hasAdapter) {
      await telemetryRegistry.connect();
    }

    // Register LT interceptors
    await registerLT(connection, {
      defaultRole: startConfig.interceptor?.defaultRole ?? 'reviewer',
    });

    // Start each worker
    for (const w of workers) {
      const label = `${w.taskQueue}::${w.workflow.name}`;
      const worker = await Durable.Worker.create({
        connection,
        taskQueue: w.taskQueue,
        workflow: w.workflow,
        guid: `${label}-${Durable.guid()}`,
      });
      await worker.run();
      registerWorker(w.workflow.name, w.taskQueue);
    }

    loggerRegistry.info(
      `[long-tail] workers started on queues: ${workers.map((w) => w.taskQueue).join(', ')}`,
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

    // Register MCP server factories: built-in (from system/) + user-provided
    const { registerBuiltinServer } = await import('../services/mcp/client');
    const allFactories = {
      ...builtinMcpServerFactories,
      ...(startConfig.mcp?.serverFactories ?? {}),
    };
    for (const [name, factory] of Object.entries(allFactories)) {
      registerBuiltinServer(name, factory);
    }
    loggerRegistry.info(`[long-tail] ${Object.keys(allFactories).length} MCP server factories registered`);

    // Register workers for active YAML (deterministic) workflows
    await yamlWorkflowWorkers.registerAllActiveWorkers();
  }

  // Seed system MCP servers (always)
  const { seedSystemMcpServers } = await import('../system/seed');
  await seedSystemMcpServers();

  // Ensure system bot account exists for cron/system-initiated workflows
  const { ensureSystemBot } = await import('../services/iam/bots');
  await ensureSystemBot().catch((err: any) =>
    loggerRegistry.warn(`[long-tail] system bot seed error: ${err.message}`),
  );

  // Seed example data when enabled
  if (startConfig.examples) {
    const { seedExamples } = await import('../examples');
    const seedClient = new Durable.Client({ connection });
    setTimeout(() => {
      seedExamples(seedClient).catch((err: any) =>
        loggerRegistry.warn(`[long-tail] seed error: ${err.message}`),
      );
    }, 2000);
  }
}
