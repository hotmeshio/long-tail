import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../lib/db';
import { registerLT } from '../services/interceptor';
import { ensureEscalationCompatView } from '../services/escalation';
import { systemEventsConfig } from '../lib/events/system-events';
import { registerWorker } from '../services/workers/registry';
import { loggerRegistry } from '../lib/logger';
import { telemetryRegistry } from '../lib/telemetry';
import { eventRegistry } from '../lib/events';
import { maintenanceRegistry } from '../services/maintenance';
import { cronRegistry } from '../services/cron';
import { mcpRegistry } from '../services/mcp';
import * as yamlWorkflowWorkers from '../services/yaml-workflow/workers';
import { migrate } from '../lib/db/migrate';
import {
  ownedByCode,
  newSurfaceReport,
  recordOutcome,
  logSurfaceReport,
  withConfigLock,
} from './apply-report';

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
): Promise<{ adminUserId?: string }> {
  // Run migrations
  loggerRegistry.info('[long-tail] running migrations...');
  await migrate();

  // Seed admin user from config (idempotent, runs before workers)
  let adminUserId: string | undefined;
  if (startConfig.seed?.admin) {
    const { seedAdmin } = await import('../services/user/seed-admin');
    adminUserId = await seedAdmin(startConfig.seed.admin).catch((err: any) => {
      loggerRegistry.warn(`[long-tail] seed admin error: ${err.message}`);
      return undefined;
    });
  }

  // Seed MCP service account (idempotent)
  const { seedMcpServiceAccount } = await import('../services/mcp/seed-service-account');
  await seedMcpServiceAccount();

  // Who owns declared configuration after first boot ('db' = insert-if-absent).
  const configSource = startConfig.configSource ?? 'db';
  const codeOwnedBoot = configSource === 'code';

  // Register declared roles (every container — roles are independent of workers).
  if (startConfig.roles?.length) {
    const { applyRoleConfig, listConfiguredRoles } = await import('../services/role/seed');
    const roleReport = newSurfaceReport();
    await withConfigLock(async () => {
      for (const roleCfg of startConfig.roles!) {
        try {
          const outcome = await applyRoleConfig(roleCfg, ownedByCode(roleCfg.reset, configSource));
          recordOutcome(roleReport, roleCfg.role, outcome);
          if (outcome === 'applied') loggerRegistry.info(`[long-tail] role applied: ${roleCfg.role}`);
        } catch (err: any) {
          loggerRegistry.warn(`[long-tail] role apply failed for ${roleCfg.role}: ${err.message}`);
        }
      }
    });
    if (codeOwnedBoot && !startConfig.examples) {
      // Orphans = configured roles (title or form schema set) neither declared
      // here nor referenced by a declared workflow profile. Bare FK rows and
      // membership-only roles never count. Skipped under examples — the demo
      // seeders own their roles.
      const declared = new Set<string>(['reviewer', 'superadmin', 'system']);
      for (const r of startConfig.roles) {
        declared.add(r.role);
        if (r.parent_role) declared.add(r.parent_role);
        for (const t of r.escalation_targets ?? []) declared.add(t);
        for (const u of r.upstream_roles ?? []) declared.add(u);
      }
      for (const w of workers) {
        if (!w.config) continue;
        declared.add(w.config.defaultRole ?? 'reviewer');
        for (const role of [...(w.config.roles ?? []), ...(w.config.invocationRoles ?? [])]) {
          declared.add(role);
        }
      }
      roleReport.orphans = (await listConfiguredRoles()).filter((r) => !declared.has(r));
    }
    if (codeOwnedBoot) logSurfaceReport('roles', roleReport);
  }

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
      events: systemEventsConfig,
    });

    // Replace the legacy lt_escalations table with a view over the SDK's
    // hmsh_escalations (migrating any rows). Read-path consumers (overview,
    // mcp health, role/agent) and test cleanup depend on the view. Idempotent.
    await ensureEscalationCompatView();

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
        // Efficient path: a workflow that suspends via condition(signalId, config)
        // writes its escalation row in this worker engine's Leg1 — this hook
        // emits the lifecycle event, mapped into the eventManager. (Disjoint from
        // the service-mediated path, so no duplicate events.)
        events: systemEventsConfig,
      });
      await worker.run();
      registerWorker(w.workflow.name, w.taskQueue);
    }

    loggerRegistry.info(
      `[long-tail] workers started on queues: ${workers.map((w) => w.taskQueue).join(', ')}`,
    );

    // Register workflow configs — ownership per configSource / per-entry reset.
    // Code-owned profiles are diffed and applied; db-owned profiles keep the
    // insert-if-absent contract (DB is source of truth after first boot).
    const workersWithConfig = workers.filter((w) => w.config);
    if (workersWithConfig.length) {
      const { seedWorkflowConfig, applyWorkflowConfig } = await import('../services/config/write');
      const { ltConfig } = await import('../modules/ltconfig');
      const wfReport = newSurfaceReport();
      await withConfigLock(async () => {
        for (const w of workersWithConfig) {
          const workflowType = w.workflow.name;
          const c = w.config!;
          const declaration = {
            workflow_type: workflowType,
            task_queue: w.taskQueue,
            invocable: c.invocable ?? false,
            certified: c.certified,
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
          };
          try {
            if (ownedByCode(c.reset, configSource)) {
              const outcome = await applyWorkflowConfig(declaration);
              recordOutcome(wfReport, workflowType, outcome);
              if (outcome === 'applied') loggerRegistry.info(`[long-tail] config applied: ${workflowType}`);
            } else {
              const inserted = await seedWorkflowConfig(declaration);
              recordOutcome(wfReport, workflowType, 'db-owned');
              if (inserted) loggerRegistry.info(`[long-tail] config seeded: ${workflowType}`);
            }
          } catch (err: any) {
            loggerRegistry.warn(`[long-tail] config seed failed for ${workflowType}: ${err.message}`);
          }
        }
      });
      if (codeOwnedBoot) {
        const { listWorkflowConfigs } = await import('../services/config/read');
        const registered = new Set(workers.map((w) => w.workflow.name));
        wfReport.orphans = (await listWorkflowConfigs())
          .map((cfg) => cfg.workflow_type)
          .filter((t) => !registered.has(t));
        logSurfaceReport('workflows', wfReport);
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
    const { seedMcpServer, applyMcpServer, cleanStaleBuiltinServers } = await import('../services/mcp/db');
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

    // Set exposure config for the /mcp endpoint
    const { setExposureConfig } = await import('../services/mcp/exposure');
    setExposureConfig(startConfig.mcp?.exposure);

    // 2. Register MCP server configs — ownership per configSource / per-entry
    // reset. Code-owned entries apply the config fields (runtime state stays
    // untouched); db-owned entries keep insert-if-absent + drift log.
    const mcpReport = newSurfaceReport();
    for (const [name, entry] of Object.entries(allFactories)) {
      if (entry.config) {
        try {
          if (ownedByCode(entry.config.reset, configSource)) {
            const outcome = await applyMcpServer({ name, ...entry.config });
            recordOutcome(mcpReport, name, outcome);
            if (outcome === 'applied') loggerRegistry.info(`[long-tail] MCP server applied: ${name}`);
          } else {
            const inserted = await seedMcpServer({ name, ...entry.config });
            recordOutcome(mcpReport, name, 'db-owned');
            if (inserted) loggerRegistry.info(`[long-tail] MCP server seeded: ${name}`);
          }
        } catch (err: any) {
          loggerRegistry.warn(`[long-tail] MCP server seed failed for ${name}: ${err.message}`);
        }
      }
    }
    if (codeOwnedBoot) logSurfaceReport('mcp-servers', mcpReport);

    // 3. Clean stale builtin servers no longer in factory list
    await cleanStaleBuiltinServers(Object.keys(allFactories));

    // Seed static graph (YAML/DAG) workflows — the graph-form peer of `workers`.
    // Hand-authored flows from config, plus the hello-world example when enabled.
    // Runs before worker registration so newly-deployed flows are picked up.
    if (!isReadonly) {
      const graphFlows = [...(startConfig.graphWorkflows ?? [])];
      if (startConfig.examples) {
        const { EXAMPLE_GRAPH_WORKFLOWS } = await import('../examples');
        graphFlows.push(...EXAMPLE_GRAPH_WORKFLOWS);
      }
      if (graphFlows.length) {
        const { seedGraphWorkflows } = await import('./graph-workflows');
        await seedGraphWorkflows(graphFlows);
      }
    }

    // Register workers for active YAML (deterministic) workflows
    await yamlWorkflowWorkers.registerAllActiveWorkers();
  }

  // Seed topic catalog (system topics + user-declared topics). Declared
  // topics follow configSource; per-entry `reset` overrides in either direction.
  const { seedSystemTopics, seedConfigTopics } = await import('../services/topics/system-topics');
  await seedSystemTopics();
  if (startConfig.topics?.length) await seedConfigTopics(startConfig.topics, codeOwnedBoot);
  if (codeOwnedBoot) {
    const { listConfigTopicNames } = await import('../services/topics');
    const declaredTopics = new Set((startConfig.topics ?? []).map((t) => t.topic));
    if (startConfig.examples) {
      try {
        const { EXAMPLE_TOPICS } = await import('../examples');
        for (const t of EXAMPLE_TOPICS ?? []) declaredTopics.add(t.topic);
      } catch { /* examples not available */ }
    }
    const orphanTopics = (await listConfigTopicNames()).filter((t) => !declaredTopics.has(t));
    if (orphanTopics.length) {
      loggerRegistry.warn(`[long-tail] config apply (topics): orphans: [${orphanTopics.join(', ')}]`);
    }
  }

  // Seed the domain dictionary (every container, workers or not). Db-owned:
  // insert-if-absent, the DB row is runtime truth. Code-owned: the file is
  // compared and applied, bumping the version once per changed document.
  if (startConfig.mcp?.domainDictionaryPath) {
    const { seedDomainDictionary } = await import('../services/domain');
    await seedDomainDictionary(
      startConfig.mcp.domainDictionaryPath,
      startConfig.mcp.domainDictionaryReset ?? codeOwnedBoot,
    );
  }

  // Seed example topics when examples are enabled
  if (startConfig.examples) {
    try {
      const { EXAMPLE_TOPICS } = await import('../examples');
      if (EXAMPLE_TOPICS?.length) await seedConfigTopics(EXAMPLE_TOPICS);
    } catch { /* examples not available */ }
  }

  // Seed agents (from startConfig + example system agents when enabled)
  const systemAgents = startConfig.examples
    ? (await import('../system')).getSystemAgents()
    : [];
  const allAgentConfigs = [...(startConfig.agents ?? []), ...systemAgents];
  if (allAgentConfigs.length > 0) {
    const { seedAgent, applyAgent, listAgentIds } = await import('../services/agent');
    const { seedSubscription, applySubscription, listSubscriptions } = await import('../services/agent/subscriptions');
    const agentReport = newSurfaceReport();
    for (const agentConfig of allAgentConfigs) {
      const codeOwned = ownedByCode(agentConfig.reset, configSource);
      try {
        // Map flat schedules into behaviors.schedules for DB storage
        const behaviors: Record<string, any> = {};
        if (agentConfig.schedules?.length) {
          behaviors.schedules = agentConfig.schedules;
          behaviors.cron = agentConfig.schedules[0].cron;
        }
        const declaration = {
          id: agentConfig.name,
          description: agentConfig.description,
          goals: agentConfig.goals,
          rules: agentConfig.rules,
          status: (agentConfig.status ?? 'active') as any,
          knowledge_domain: agentConfig.knowledge_domain,
          behaviors,
          workflow_type: agentConfig.schedules?.[0]?.workflow_type,
        };
        if (codeOwned) {
          const outcome = await applyAgent(declaration);
          recordOutcome(agentReport, agentConfig.name, outcome);
          if (outcome === 'applied') loggerRegistry.info(`[long-tail] agent applied: ${agentConfig.name}`);
        } else {
          const inserted = await seedAgent(declaration);
          recordOutcome(agentReport, agentConfig.name, 'db-owned');
          if (inserted) loggerRegistry.info(`[long-tail] agent seeded: ${agentConfig.name}`);
        }

        // Subscriptions for this agent — id IS the name
        if (agentConfig.subscriptions?.length) {
          for (const sub of agentConfig.subscriptions) {
            try {
              if (codeOwned) {
                const outcome = await applySubscription(agentConfig.name, sub);
                if (outcome === 'applied') loggerRegistry.info(`[long-tail] subscription applied: ${agentConfig.name}/${sub.topic}`);
              } else {
                const subInserted = await seedSubscription(agentConfig.name, sub);
                if (subInserted) loggerRegistry.info(`[long-tail] subscription seeded: ${agentConfig.name}/${sub.topic}`);
              }
            } catch (subErr: any) {
              loggerRegistry.warn(`[long-tail] subscription seed failed: ${agentConfig.name}/${sub.topic}: ${subErr.message}`);
            }
          }
        }

        // Undeclared subscriptions on a code-owned agent are reported, never
        // deleted — disabling or removing one stays a deliberate act.
        if (codeOwned) {
          const declaredSubs = new Set((agentConfig.subscriptions ?? []).map((s) => s.topic));
          const existingSubs = await listSubscriptions(agentConfig.name);
          agentReport.orphans.push(
            ...existingSubs
              .filter((s) => !declaredSubs.has(s.topic))
              .map((s) => `${agentConfig.name}/${s.topic}`),
          );
        }
      } catch (err: any) {
        loggerRegistry.warn(`[long-tail] agent seed failed for ${agentConfig.name}: ${err.message}`);
      }
    }
    if (codeOwnedBoot) {
      const declaredAgents = new Set(allAgentConfigs.map((a) => a.name));
      agentReport.orphans.push(
        ...(await listAgentIds()).filter((id) => !declaredAgents.has(id)),
      );
      logSurfaceReport('agents', agentReport);
    }
  }

  // Register the in-process callback adapter for agent event triggers.
  // Reuse existing instance if already registered (e.g., from SDK createClient).
  const { CallbackEventAdapter } = await import('../lib/events/callback');
  const { agentTriggerRegistry } = await import('../services/agent/trigger-registry');

  let callbackAdapter = eventRegistry.getAdapter(CallbackEventAdapter);
  if (!callbackAdapter) {
    callbackAdapter = new CallbackEventAdapter();
    eventRegistry.register(callbackAdapter);
  }

  // Bridge cross-container events to the local callback adapter.
  // Any transport adapter (NATS, SNS, GCP Pub/Sub, etc.) that implements
  // setCallbackBridge() will subscribe to the bus and forward events
  // from other containers so agent triggers fire locally.
  eventRegistry.bridgeCallbackAdapter(callbackAdapter);

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
  } else {
    loggerRegistry.info('[long-tail] readonly mode — agent triggers and crons skipped');
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

  return { adminUserId };
}
