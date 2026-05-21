import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../lib/db';
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

import type { LTStartConfig, LTWorkerConfig } from '../types/startup';

type WorkerEntry = {
  taskQueue: string;
  workflow: (...args: any[]) => any;
  connection?: { readonly?: boolean; retry?: Record<string, unknown> };
  config?: LTWorkerConfig;
};

/**
 * Create a named no-op workflow function for readonly/observer workers.
 * The function name is used by `registerWorker` for discovery.
 */
function createNoOpWorkflow(name: string): (...args: any[]) => any {
  const container = {
    [name](..._args: any[]) {
      /* readonly no-op */
    },
  };
  return container[name];
}

/**
 * Build the connection descriptor used by HotMesh / Durable.
 */
export function buildConnection(): { class: unknown; options: Record<string, unknown> } {
  return getConnection();
}

/**
 * Collect all workers: system, optional examples, and user-provided.
 */
export async function collectWorkers(startConfig: LTStartConfig): Promise<{
  workers: WorkerEntry[];
  builtinMcpServerFactories: Record<string, any>;
}> {
  const { getSystemWorkers, builtinMcpServerFactories } = await import('../system');
  // Normalize user workers: string workflows become named no-ops (readonly only)
  const userWorkers: WorkerEntry[] = (startConfig.workers ?? []).map((w) => {
    if (typeof w.workflow === 'string') {
      if (!w.connection?.readonly) {
        throw new Error(
          `Worker "${w.workflow}" on queue "${w.taskQueue}": ` +
            'string workflow names require connection.readonly = true',
        );
      }
      return { ...w, workflow: createNoOpWorkflow(w.workflow) };
    }
    return w as WorkerEntry;
  });

  const workers: WorkerEntry[] = [
    ...getSystemWorkers(),
    ...userWorkers,
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

  // Readonly mode: all user-provided workers are observers — skip crons, triggers, and agent seeding.
  // System workers (mcpQuery, etc.) are always added by collectWorkers, so check the original config.
  const userWorkers = startConfig.workers ?? [];
  const isReadonly = userWorkers.length > 0 && userWorkers.every((w) => w.connection?.readonly);

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
      if (w.connection?.readonly) {
        // Readonly workers register for discovery only — they must not
        // consume messages from the stream (that is the real worker's job).
        registerWorker(w.workflow.name, w.taskQueue);
        loggerRegistry.info(
          `[long-tail] readonly worker registered: ${w.taskQueue}::${w.workflow.name}`,
        );
        continue;
      }
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

    // Seed workflow configs (insert-if-absent — DB is source of truth)
    const workersWithConfig = workers.filter((w) => w.config);
    if (workersWithConfig.length) {
      const { seedWorkflowConfig } = await import('../services/config/write');
      const { ltConfig } = await import('../modules/ltconfig');
      for (const w of workersWithConfig) {
        const workflowType = w.workflow.name;
        const c = w.config!;
        try {
          const inserted = await seedWorkflowConfig({
            workflow_type: workflowType,
            task_queue: w.taskQueue,
            invocable: c.invocable ?? false,
            default_role: c.defaultRole ?? 'reviewer',
            description: c.description ?? null,
            roles: c.roles ?? [],
            invocation_roles: c.invocationRoles ?? [],
            consumes: c.consumes ?? [],
            tool_tags: c.toolTags ?? [],
            envelope_schema: c.envelopeSchema ?? null,
            resolver_schema: c.resolverSchema ?? null,
            cron_schedule: c.cronSchedule ?? null,
            execute_as: c.executeAs ?? null,
          });
          if (inserted) loggerRegistry.info(`[long-tail] config seeded: ${workflowType}`);
        } catch (err: any) {
          loggerRegistry.warn(`[long-tail] config seed failed for ${workflowType}: ${err.message}`);
        }
      }
      ltConfig.invalidate();
    }

    // Start maintenance cron (skip in readonly/API mode)
    if (maintenanceRegistry.hasConfig && !isReadonly) {
      await maintenanceRegistry.connect();
      loggerRegistry.info('[long-tail] maintenance cron started');
    }

    // Start workflow cron schedules (skip in readonly/API mode)
    if (!isReadonly) {
      await cronRegistry.connect();
    }

    // Connect MCP adapter
    if (mcpRegistry.hasAdapter) {
      await mcpRegistry.connect();
      loggerRegistry.info('[long-tail] MCP adapter connected');
    }

    // Register MCP server factories: built-in (from system/) + user-provided
    // Both system and user factories can carry inline config for DB seeding.
    const { registerBuiltinServer } = await import('../services/mcp/client');
    const { seedMcpServer, cleanStaleBuiltinServers } = await import('../services/mcp/db');
    const userFactories = startConfig.mcp?.serverFactories ?? {};

    // Resolve user factories — plain function or { factory, config }
    const resolvedUserFactories: Record<string, { factory: () => any; config?: import('../types/startup').LTMcpServerConfig }> = {};
    for (const [name, entry] of Object.entries(userFactories)) {
      if (typeof entry === 'function') {
        resolvedUserFactories[name] = { factory: entry };
      } else {
        resolvedUserFactories[name] = entry;
      }
    }

    // Merge system (always have config) + user factories
    const allFactories: Record<string, { factory: () => any; config?: import('../types/startup').LTMcpServerConfig }> = {
      ...builtinMcpServerFactories,
      ...resolvedUserFactories,
    };

    // 1. Register all factories (runtime — always applied)
    for (const [name, entry] of Object.entries(allFactories)) {
      registerBuiltinServer(name, entry.factory);
    }
    loggerRegistry.info(`[long-tail] ${Object.keys(allFactories).length} MCP server factories registered`);

    // 2. Seed MCP server configs (insert-if-absent + drift log)
    for (const [name, entry] of Object.entries(allFactories)) {
      if (entry.config) {
        try {
          const inserted = await seedMcpServer({ name, ...entry.config });
          if (inserted) loggerRegistry.info(`[long-tail] MCP server seeded: ${name}`);
        } catch (err: any) {
          loggerRegistry.warn(`[long-tail] MCP server seed failed for ${name}: ${err.message}`);
        }
      }
    }

    // 3. Clean stale builtin servers no longer in factory list
    await cleanStaleBuiltinServers(Object.keys(allFactories));

    // Register workers for active YAML (deterministic) workflows
    await yamlWorkflowWorkers.registerAllActiveWorkers();
  }

  // Seed topic catalog (system topics + user-declared topics)
  const { seedSystemTopics, seedConfigTopics } = await import('../services/topics/system-topics');
  await seedSystemTopics();
  if (startConfig.topics?.length) await seedConfigTopics(startConfig.topics);

  // Seed agents (from startConfig + example system agents when enabled)
  const systemAgents = startConfig.examples
    ? (await import('../system')).getSystemAgents()
    : [];
  const allAgentConfigs = [...(startConfig.agents ?? []), ...systemAgents];
  if (allAgentConfigs.length > 0) {
    const { seedAgent, getAgentByName } = await import('../services/agent');
    const { seedSubscription } = await import('../services/agent/subscriptions');
    for (const agentConfig of allAgentConfigs) {
      try {
        // Map flat schedules into behaviors.schedules for DB storage
        const behaviors: Record<string, any> = {};
        if (agentConfig.schedules?.length) {
          behaviors.schedules = agentConfig.schedules;
          behaviors.cron = agentConfig.schedules[0].cron;
        }
        const inserted = await seedAgent({
          name: agentConfig.name,
          description: agentConfig.description,
          goals: agentConfig.goals,
          rules: agentConfig.rules,
          status: (agentConfig.status ?? 'active') as any,
          knowledge_domain: agentConfig.knowledge_domain,
          behaviors,
          workflow_type: agentConfig.schedules?.[0]?.workflow_type,
        });
        if (inserted) loggerRegistry.info(`[long-tail] agent seeded: ${agentConfig.name}`);

        // Seed subscriptions for this agent
        if (agentConfig.subscriptions?.length) {
          const agent = await getAgentByName(agentConfig.name);
          if (agent) {
            for (const sub of agentConfig.subscriptions) {
              try {
                const subInserted = await seedSubscription(agent.id, sub);
                if (subInserted) loggerRegistry.info(`[long-tail] subscription seeded: ${agentConfig.name}/${sub.topic}`);
              } catch (subErr: any) {
                loggerRegistry.warn(`[long-tail] subscription seed failed: ${agentConfig.name}/${sub.topic}: ${subErr.message}`);
              }
            }
          }
        }
      } catch (err: any) {
        loggerRegistry.warn(`[long-tail] agent seed failed for ${agentConfig.name}: ${err.message}`);
      }
    }
  }

  // Register the in-process callback adapter for agent event triggers
  const { CallbackEventAdapter } = await import('../lib/events/callback');
  const { agentTriggerRegistry } = await import('../services/agent/trigger-registry');
  const callbackAdapter = new CallbackEventAdapter();
  eventRegistry.register(callbackAdapter);

  // Connect event adapters (outside workers guard so API-only containers
  // still connect to NATS and can publish/receive events)
  if (eventRegistry.hasAdapters) {
    await eventRegistry.connect();
    loggerRegistry.info('[long-tail] event adapters connected');
  }

  // Arm agent event subscriptions and crons (skip in readonly/API mode)
  if (!isReadonly) {
    try {
      await agentTriggerRegistry.connect(callbackAdapter);
    } catch (err: any) {
      loggerRegistry.warn(`[long-tail] agent trigger registry: ${err.message}`);
    }

    try {
      await cronRegistry.connectAgentCrons();
    } catch (err: any) {
      loggerRegistry.warn(`[long-tail] agent cron schedules: ${err.message}`);
    }
  }

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
