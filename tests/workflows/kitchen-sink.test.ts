import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation, waitForEscalationStatus } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import * as kitchenSinkWorkflow from '../../examples/workflows/kitchen-sink';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = Durable;

const TASK_QUEUE = 'test-kitchen-sink';
const ACTIVITY_QUEUE = 'test-lt-ks-interceptor';

describe('kitchenSink workflow', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    await configService.upsertWorkflowConfig({
      workflow_type: 'kitchenSink',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
      consumes: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerActivityInterceptor(ltActivityInterceptor);

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: kitchenSinkWorkflow.kitchenSink,
    });
    await worker.run();

    client = new Client({ connection });
  }, 60_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Quick mode: auto-completes without escalation ─────────────────────────

  it('should auto-complete in quick mode', async () => {
    const handle = await client.workflow.start({
      args: [{
        data: { name: 'Test', mode: 'quick' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'kitchenSink',
      workflowId: `test-ks-quick-${Durable.guid()}`,
      expire: 120,
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.greeting).toBe('Hello, Test!');
    expect(result.data.mode).toBe('quick');
    expect(result.data.result).toBeTruthy();
    expect(result.data.result.merged).toHaveProperty('source-a');
    expect(result.data.result.merged).toHaveProperty('source-b');
  }, 30_000);

  // ── Full mode: escalates then resolves ────────────────────────────────────

  it('should escalate in full mode and resolve with approval', async () => {
    const workflowId = `test-ks-full-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: { name: 'Reviewer', mode: 'full' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'kitchenSink',
      workflowId,
      expire: 120,
    });

    const escalations = await waitForEscalation(workflowId, 15_000);
    expect(escalations.length).toBe(1);
    expect(escalations[0].status).toBe('pending');
    expect(escalations[0].role).toBe('reviewer');
    expect(escalations[0].description).toContain('Kitchen sink');

    await resolveEscalation(escalations[0].id, { approved: true });

    const resolvedEsc = await waitForEscalationStatus(escalations[0].id, 'resolved', 15_000);
    expect(resolvedEsc.status).toBe('resolved');
  }, 30_000);
});
