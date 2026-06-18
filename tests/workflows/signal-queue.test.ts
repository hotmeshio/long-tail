/**
 * Signal Queue — side-by-side integration test
 *
 * Runs two station workflows concurrently:
 *
 *   sqStationOld — legacy path: lt_escalations + enrichEscalationRouting + conditionLT(signalId)
 *                  resolved via api/escalations/resolve → Path B (waitFor signal routing)
 *
 *   sqStationNew — signal-queue path: lt_escalations (signal_queue:true) + conditionLT(signalId, queueConfig)
 *                  resolved via api/escalations/resolve → Path F (hotmesh_signals)
 *
 * Both workflows receive the same resolver payload and both must signal successfully.
 * This proves signal delivery parity between Path B and Path F.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation, waitForEscalationStatus } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import * as oldStationWorkflow from '../../examples/workflows/signal-queue-station/old-station';
import * as newStationWorkflow from '../../examples/workflows/signal-queue-station/new-station';
import { resolveEscalation as apiResolveEscalation } from '../../api/escalations/resolve';
import type { LTApiAuth } from '../../types/sdk';

const { Connection, Client, Worker } = Durable;

const OLD_TASK_QUEUE = 'sq-station-old';
const NEW_TASK_QUEUE = 'sq-station-new';
const ACTIVITY_QUEUE = 'sq-lt-interceptor';

const RESOLVER_PAYLOAD = { approved: true, notes: 'Looks good' };
const TEST_AUTH: LTApiAuth = { userId: 'system-uuid' };

describe('signal queue — old vs new station side-by-side', () => {
  let durableClient: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();

    const connection = { class: Postgres, options: postgres_options };

    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({ activityTaskQueue: ACTIVITY_QUEUE });
    Durable.registerInboundInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerOutboundInterceptor(ltActivityInterceptor);

    const oldWorker = await Worker.create({
      connection,
      taskQueue: OLD_TASK_QUEUE,
      workflow: oldStationWorkflow.sqStationOld,
    });
    await oldWorker.run();

    const newWorker = await Worker.create({
      connection,
      taskQueue: NEW_TASK_QUEUE,
      workflow: newStationWorkflow.sqStationNew,
    });
    await newWorker.run();

    durableClient = new Client({ connection });
  }, 90_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearOutboundInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 15_000);

  it('old station: resolves via Path B (signal_routing) and escalation reaches resolved', async () => {
    const workflowId = `sq-old-${Durable.guid()}`;

    await durableClient.workflow.start({
      args: [{ data: { stationName: 'scan', role: 'operator', instructions: 'Scan the document' }, metadata: {} }],
      taskQueue: OLD_TASK_QUEUE,
      workflowName: 'sqStationOld',
      workflowId,
      expire: 120,
    });

    const escalations = await waitForEscalation(workflowId, 20_000);
    expect(escalations.length).toBe(1);
    expect(escalations[0].status).toBe('pending');
    expect(escalations[0].role).toBe('operator');

    const result = await apiResolveEscalation({ id: escalations[0].id, resolverPayload: RESOLVER_PAYLOAD }, TEST_AUTH);
    expect(result.status).toBe(200);

    const resolved = await waitForEscalationStatus(escalations[0].id, 'resolved', 15_000);
    expect(resolved.status).toBe('resolved');
  }, 60_000);

  it('new station: resolves via Path F (signal_queue) and escalation reaches resolved', async () => {
    const workflowId = `sq-new-${Durable.guid()}`;

    await durableClient.workflow.start({
      args: [{ data: { stationName: 'print', role: 'operator', instructions: 'Print the label' }, metadata: {} }],
      taskQueue: NEW_TASK_QUEUE,
      workflowName: 'sqStationNew',
      workflowId,
      expire: 120,
    });

    const escalations = await waitForEscalation(workflowId, 20_000);
    expect(escalations.length).toBe(1);
    expect(escalations[0].status).toBe('pending');
    expect(escalations[0].role).toBe('operator');
    expect((escalations[0].metadata as any)?.signal_queue).toBe(true);

    const result = await apiResolveEscalation({ id: escalations[0].id, resolverPayload: RESOLVER_PAYLOAD }, TEST_AUTH);
    expect(result.status).toBe(200);
    expect((result.data as any)?.signaled).toBe(true);

    const resolved = await waitForEscalationStatus(escalations[0].id, 'resolved', 15_000);
    expect(resolved.status).toBe('resolved');
  }, 60_000);
});
