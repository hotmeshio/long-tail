import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import { createLTActivityInterceptor } from '../../interceptor/activity-interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as configService from '../../services/config';
import * as taskService from '../../services/task';
import { ltConfig } from '../../modules/ltconfig';
import { executeLT } from '../../orchestrator';
import type { LTEnvelope, LTReturn } from '../../types';

const { Connection, Client, Worker } = Durable;

const LEAF_QUEUE = 'test-cp-leaf';
const ORCH_QUEUE = 'test-cp-orch';
const ACTIVITY_QUEUE = 'lt-interceptor';

// ── Test workflows ──────────────────────────────────────────────────────────

/**
 * "Producer" workflow — enriches an order with pricing data.
 * Returns the enrichment result as LTReturn so the interceptor
 * persists it to lt_tasks.data.
 */
async function enrichOrder(envelope: LTEnvelope): Promise<LTReturn> {
  const { orderId, itemCount } = envelope.data;
  return {
    type: 'return',
    data: {
      orderId,
      totalPrice: itemCount * 29.99,
      currency: 'USD',
    },
    milestones: [{ name: 'pricing', value: 'calculated' }],
  };
}

/**
 * "Consumer" workflow — processes an order. If the orchestrator has
 * injected provider data (from a completed enrichOrder task sharing
 * the same originId), it uses that data directly. No property passing.
 */
async function processOrder(envelope: LTEnvelope): Promise<LTReturn> {
  const providers = envelope.lt?.providers;
  const pricing = providers?.orderPricing;

  return {
    type: 'return',
    data: {
      orderId: envelope.data.orderId,
      hasPricingFromProvider: !!pricing,
      totalPrice: pricing?.data?.totalPrice ?? null,
      currency: pricing?.data?.currency ?? null,
    },
    milestones: [{ name: 'order_processed', value: true }],
  };
}

/**
 * Orchestrator that runs enrichOrder → processOrder in sequence.
 * Both share the same originId so the consumer/provider linkage works.
 */
async function orderPipeline(envelope: LTEnvelope) {
  const originId = envelope.data.orderId;

  // Step 1: Enrich (producer) — result stored to lt_tasks
  await executeLT({
    workflowName: 'enrichOrder',
    args: [envelope],
    taskQueue: LEAF_QUEUE,
    originId,
  });

  // Step 2: Process (consumer) — config declares enrichOrder as provider
  // executeLT auto-injects provider data into envelope.lt.providers
  const result = await executeLT({
    workflowName: 'processOrder',
    args: [envelope],
    taskQueue: LEAF_QUEUE,
    originId,
  });

  return result;
}

describe('consumer/provider data injection', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // ── Config: enrichOrder is a plain LT workflow (producer) ──────────
    await configService.upsertWorkflowConfig({
      workflow_type: 'enrichOrder',
      is_lt: true,
      is_container: false,
      task_queue: LEAF_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'Enriches order with pricing data',
      roles: ['reviewer'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    // ── Config: processOrder declares enrichOrder as a provider ────────
    await configService.upsertWorkflowConfig({
      workflow_type: 'processOrder',
      is_lt: true,
      is_container: false,
      task_queue: LEAF_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'Processes order using provider data from enrichOrder',
      roles: ['reviewer'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [
        {
          provider_name: 'orderPricing',
          provider_workflow_type: 'enrichOrder',
          ordinal: 0,
        },
      ],
    });

    // ── Config: orchestrator (container) ──────────────────────────────
    await configService.upsertWorkflowConfig({
      workflow_type: 'orderPipeline',
      is_lt: false,
      is_container: true,
      task_queue: ORCH_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    ltConfig.invalidate();

    const connection = { class: Postgres, options: postgres_options };

    // Register shared activity worker
    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    // Register interceptors
    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInterceptor(ltInterceptor);
    Durable.registerActivityInterceptor(createLTActivityInterceptor());

    // Register leaf workers (both workflows on the same queue)
    const enrichWorker = await Worker.create({
      connection,
      taskQueue: LEAF_QUEUE,
      workflow: enrichOrder,
    });
    await enrichWorker.run();

    const processWorker = await Worker.create({
      connection,
      taskQueue: LEAF_QUEUE,
      workflow: processOrder,
    });
    await processWorker.run();

    // Register orchestrator worker
    const orchWorker = await Worker.create({
      connection,
      taskQueue: ORCH_QUEUE,
      workflow: orderPipeline,
    });
    await orchWorker.run();

    client = new Client({ connection });
  }, 60_000);

  afterAll(async () => {
    await configService.deleteWorkflowConfig('enrichOrder');
    await configService.deleteWorkflowConfig('processOrder');
    await configService.deleteWorkflowConfig('orderPipeline');
    ltConfig.invalidate();
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Core test: downstream consumer receives upstream provider data ───────

  it('should inject provider data from completed upstream task into downstream envelope', async () => {
    const orderId = `order-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: { orderId, itemCount: 3 },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'orderPipeline',
      workflowId: `test-cp-${orderId}`,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');

    // The processOrder workflow received provider data from enrichOrder
    expect(result.data.hasPricingFromProvider).toBe(true);
    expect(result.data.totalPrice).toBeCloseTo(89.97); // 3 * 29.99
    expect(result.data.currency).toBe('USD');
  }, 45_000);

  // ── Verify task records store the data that providers expose ────────────

  it('should persist producer result data to lt_tasks for provider lookups', async () => {
    const orderId = `order-persist-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: { orderId, itemCount: 5 },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'orderPipeline',
      workflowId: `test-cp-persist-${orderId}`,
      expire: 120,
    });

    await handle.result();
    await sleepFor(500);

    // Find the enrichOrder task by origin_id
    const { tasks } = await taskService.listTasks({
      workflow_type: 'enrichOrder',
    });
    const enrichTask = tasks.find((t) => {
      if (t.status !== 'completed' || !t.data) return false;
      try {
        const parsed = JSON.parse(t.data);
        return parsed.orderId === orderId;
      } catch {
        return false;
      }
    });

    expect(enrichTask).toBeTruthy();
    expect(enrichTask!.origin_id).toBe(orderId);

    const enrichData = JSON.parse(enrichTask!.data!);
    expect(enrichData.totalPrice).toBeCloseTo(149.95); // 5 * 29.99
    expect(enrichData.currency).toBe('USD');
  }, 45_000);

  // ── No provider data when no upstream task exists ──────────────────────

  it('should gracefully handle missing provider data (no completed upstream)', async () => {
    // Run processOrder directly (standalone, no orchestrator, no enrichOrder)
    // The consumer config exists but there's no completed enrichOrder
    // with a matching origin_id, so providers should be empty/absent.
    const orderId = `order-no-provider-${Durable.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: { orderId, itemCount: 1 },
        metadata: {},
      }],
      taskQueue: LEAF_QUEUE,
      workflowName: 'processOrder',
      workflowId: `test-cp-noprov-${orderId}`,
      expire: 60,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');

    // No provider data available — standalone mode, no orchestrator injection
    expect(result.data.hasPricingFromProvider).toBe(false);
    expect(result.data.totalPrice).toBeNull();
  }, 30_000);
});
