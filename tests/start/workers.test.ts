import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
// Durable.Worker.create: captures the workflow function it receives and
// immediately invokes it (simulating HotMesh dispatching a job).
// If a readonly worker leaks through, its spy will fire.
const { workerCreateMock } = vi.hoisted(() => ({
  workerCreateMock: vi.fn(async (config: any) => {
    // Simulate HotMesh calling the workflow function on stream consumption
    config.workflow();
    return { run: vi.fn() };
  }),
}));

vi.mock('@hotmeshio/hotmesh', () => ({
  Durable: {
    Worker: { create: workerCreateMock },
    Client: vi.fn().mockImplementation(() => ({})),
    guid: () => 'test-guid',
  },
}));

vi.mock('../../lib/db', () => ({
  getConnection: () => ({ class: Object, options: {} }),
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }),
}));

vi.mock('../../lib/db/migrate', () => ({
  migrate: vi.fn(),
}));

vi.mock('../../services/interceptor', () => ({
  registerLT: vi.fn(),
}));

vi.mock('../../services/workers/registry', async () => {
  const workers = new Map<string, { taskQueue: string }>();
  return {
    registerWorker: vi.fn((name: string, taskQueue: string) => {
      workers.set(name, { taskQueue });
    }),
    getRegisteredWorkers: () => workers,
  };
});

vi.mock('../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/telemetry', () => ({
  telemetryRegistry: { hasAdapter: false, connect: vi.fn() },
}));

const { eventConnectMock } = vi.hoisted(() => ({
  eventConnectMock: vi.fn(),
}));

vi.mock('../../lib/events', () => ({
  eventRegistry: { hasAdapters: true, connect: eventConnectMock, register: vi.fn(), getAdapter: vi.fn(), bridgeCallbackAdapter: vi.fn() },
}));

vi.mock('../../lib/events/callback', () => ({
  CallbackEventAdapter: vi.fn(() => ({ on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() })),
}));

vi.mock('../../services/agent/trigger-registry', () => ({
  agentTriggerRegistry: { connect: vi.fn(), disconnect: vi.fn() },
}));

vi.mock('../../services/agent', () => ({
  seedAgent: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../services/agent/subscriptions', () => ({
  seedSubscription: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../services/maintenance', () => ({
  maintenanceRegistry: { hasConfig: false, connect: vi.fn() },
}));

vi.mock('../../services/cron', () => ({
  cronRegistry: { connect: vi.fn(), connectAgentCrons: vi.fn() },
}));

vi.mock('../../services/mcp', () => ({
  mcpRegistry: { hasAdapter: false, connect: vi.fn() },
}));

vi.mock('../../services/mcp/client', () => ({
  registerBuiltinServer: vi.fn(),
}));

vi.mock('../../services/mcp/db', () => ({
  seedMcpServer: vi.fn().mockResolvedValue(true),
  cleanStaleBuiltinServers: vi.fn(),
}));

vi.mock('../../services/config/write', () => ({
  seedWorkflowConfig: vi.fn().mockResolvedValue(true),
  upsertWorkflowConfig: vi.fn(),
}));

vi.mock('../../services/yaml-workflow/workers', () => ({
  registerAllActiveWorkers: vi.fn(),
}));

vi.mock('../../system/seed', () => ({}));

vi.mock('../../examples', () => ({
  exampleWorkers: [],
  seedExamples: vi.fn(),
}));

const getSystemAgentsMock = vi.fn(() => []);

vi.mock('../../system', () => ({
  getSystemWorkers: () => [],
  getSystemAgents: getSystemAgentsMock,
  builtinMcpServerFactories: {},
}));

vi.mock('../../services/iam/bots', () => ({
  ensureSystemBot: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ────────────────────────────────────────────
import { startWorkers, collectWorkers } from '../../start/workers';
import { registerWorker, getRegisteredWorkers } from '../../services/workers/registry';
import { eventRegistry } from '../../lib/events';
import { seedAgent } from '../../services/agent';
import { seedSubscription } from '../../services/agent/subscriptions';

// ── Helpers ──────────────────────────────────────────────────────────
const baseConfig = { workers: [], interceptor: { defaultRole: 'reviewer' as const } };

function makeWorker(name: string, taskQueue: string, readonly: boolean) {
  const spy = vi.fn();
  // Named function so registerWorker picks up the name
  const container = {
    [name](...args: any[]) {
      spy(...args);
    },
  };
  return {
    entry: {
      taskQueue,
      workflow: container[name],
      ...(readonly ? { connection: { readonly: true } } : {}),
    },
    spy,
  };
}

// ── Tests ────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  getRegisteredWorkers().clear();
});

describe('startWorkers — readonly flag', () => {

  it('readonly worker is never invoked — Durable.Worker.create is skipped entirely', async () => {
    const readonlyWorker = makeWorker('helloWorkflow', 'order-tracking', true);

    await startWorkers(baseConfig as any, [readonlyWorker.entry], {});

    // The workflow function must never fire
    expect(readonlyWorker.spy).not.toHaveBeenCalled();
    // Durable.Worker.create must not be called for this worker
    expect(workerCreateMock).not.toHaveBeenCalled();
  });

  it('readonly worker is still registered for discovery', async () => {
    const readonlyWorker = makeWorker('helloWorkflow', 'order-tracking', true);

    await startWorkers(baseConfig as any, [readonlyWorker.entry], {});

    expect(registerWorker).toHaveBeenCalledWith('helloWorkflow', 'order-tracking');
    expect(getRegisteredWorkers().has('helloWorkflow')).toBe(true);
  });

  it('non-readonly worker is created and invoked normally', async () => {
    const normalWorker = makeWorker('processOrder', 'order-tracking', false);

    await startWorkers(baseConfig as any, [normalWorker.entry], {});

    // Our mock simulates HotMesh dispatching — the spy should fire
    expect(normalWorker.spy).toHaveBeenCalled();
    expect(workerCreateMock).toHaveBeenCalledTimes(1);
    expect(workerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskQueue: 'order-tracking',
        workflow: normalWorker.entry.workflow,
      }),
    );
  });

  it('mixed list: only non-readonly workers reach Durable.Worker.create', async () => {
    const readonlyA = makeWorker('viewOrders', 'order-tracking', true);
    const readonlyB = makeWorker('viewShipments', 'shipping', true);
    const normalC = makeWorker('processOrder', 'order-tracking', false);

    await startWorkers(
      baseConfig as any,
      [readonlyA.entry, readonlyB.entry, normalC.entry],
      {},
    );

    // Readonly spies must never fire
    expect(readonlyA.spy).not.toHaveBeenCalled();
    expect(readonlyB.spy).not.toHaveBeenCalled();

    // Normal spy fires via mock dispatch
    expect(normalC.spy).toHaveBeenCalled();

    // Durable.Worker.create called exactly once (for the non-readonly worker)
    expect(workerCreateMock).toHaveBeenCalledTimes(1);

    // All three are registered for discovery
    const registry = getRegisteredWorkers();
    expect(registry.has('viewOrders')).toBe(true);
    expect(registry.has('viewShipments')).toBe(true);
    expect(registry.has('processOrder')).toBe(true);
  });
});

describe('collectWorkers — string workflow names', () => {
  it('string workflow + readonly: true produces a named no-op function', async () => {
    const config = {
      workers: [
        { taskQueue: 'ingest', workflow: 'orderPipeline', connection: { readonly: true } },
      ],
    };

    const { workers } = await collectWorkers(config as any);
    const entry = workers.find((w) => w.taskQueue === 'ingest')!;

    // The string was replaced with a real function bearing the same name
    expect(typeof entry.workflow).toBe('function');
    expect(entry.workflow.name).toBe('orderPipeline');
    // readonly flag is preserved so startWorkers skips Durable.Worker.create
    expect(entry.connection?.readonly).toBe(true);
  });

  it('string workflow without readonly: true throws', async () => {
    const config = {
      workers: [
        { taskQueue: 'ingest', workflow: 'orderPipeline' },
      ],
    };

    await expect(collectWorkers(config as any)).rejects.toThrow(
      'string workflow names require connection.readonly = true',
    );
  });

  it('string readonly worker flows through startWorkers without invocation', async () => {
    const spy = vi.fn();
    const config = {
      workers: [
        { taskQueue: 'ingest', workflow: 'orderPipeline', connection: { readonly: true } },
      ],
    };

    const { workers } = await collectWorkers(config as any);
    // Patch the no-op to include a spy — if it fires, readonly is broken
    const original = workers.find((w) => w.taskQueue === 'ingest')!;
    const container = {
      [original.workflow.name](...args: any[]) { spy(...args); },
    };
    original.workflow = container[original.workflow.name];

    await startWorkers(baseConfig as any, workers, {});

    expect(spy).not.toHaveBeenCalled();
    expect(workerCreateMock).not.toHaveBeenCalled();
    expect(getRegisteredWorkers().has('orderPipeline')).toBe(true);
  });
});

describe('startWorkers — agent schedule seeding', () => {
  it('seeds agents from startConfig.agents with schedules mapped into behaviors', async () => {
    const config = {
      ...baseConfig,
      agents: [
        {
          name: 'health-bot',
          description: 'Monitors health',
          status: 'active',
          schedules: [
            { cron: '0 * * * *', workflow_type: 'basicEcho', envelope: { data: { src: 'cron' } }, execute_as: 'bot-1' },
            { cron: '*/15 * * * *', workflow_type: 'reviewContent' },
          ],
          subscriptions: [],
        },
      ],
    };

    await startWorkers(config as any, [], {});

    expect(seedAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'health-bot',
        description: 'Monitors health',
        status: 'active',
        behaviors: expect.objectContaining({
          schedules: [
            { cron: '0 * * * *', workflow_type: 'basicEcho', envelope: { data: { src: 'cron' } }, execute_as: 'bot-1' },
            { cron: '*/15 * * * *', workflow_type: 'reviewContent' },
          ],
          cron: '0 * * * *', // legacy compat from first schedule
        }),
        workflow_type: 'basicEcho',
      }),
    );
  });

  it('seeds agent subscriptions using agent name as id', async () => {
    (seedAgent as any).mockResolvedValueOnce(true);

    const config = {
      ...baseConfig,
      agents: [
        {
          name: 'event-bot',
          subscriptions: [
            { topic: 'workflow.failed', reaction_type: 'durable', workflow_type: 'basicEcho', execute_as: 'bot-1' },
          ],
        },
      ],
    };

    await startWorkers(config as any, [], {});

    expect(seedSubscription).toHaveBeenCalledWith('event-bot', expect.objectContaining({
      topic: 'workflow.failed',
      reaction_type: 'durable',
      workflow_type: 'basicEcho',
      execute_as: 'bot-1',
    }));
  });

  it('skips subscription seeding when agent has no subscriptions', async () => {
    (seedAgent as any).mockResolvedValueOnce(true);

    const config = {
      ...baseConfig,
      agents: [{ name: 'cron-only', schedules: [{ cron: '0 * * * *', workflow_type: 'basicEcho' }] }],
    };

    await startWorkers(config as any, [], {});

    expect(seedAgent).toHaveBeenCalled();
    expect(seedSubscription).not.toHaveBeenCalled();
  });
});

describe('startWorkers — system agents gated behind examples', () => {
  it('does not load system agents when examples is falsy', async () => {
    await startWorkers(baseConfig as any, [], {});

    expect(getSystemAgentsMock).not.toHaveBeenCalled();
  });

  it('loads system agents when examples is true', async () => {
    const config = { ...baseConfig, examples: true };

    await startWorkers(config as any, [], {});

    expect(getSystemAgentsMock).toHaveBeenCalled();
  });
});

describe('startWorkers — event adapters connect unconditionally', () => {
  it('connects event adapters even when workers list is empty', async () => {
    await startWorkers(baseConfig as any, [], {});

    expect(eventConnectMock).toHaveBeenCalledTimes(1);
  });

  it('connects event adapters when workers are present', async () => {
    const worker = makeWorker('processOrder', 'order-tracking', false);

    await startWorkers(baseConfig as any, [worker.entry], {});

    expect(eventConnectMock).toHaveBeenCalledTimes(1);
  });
});
