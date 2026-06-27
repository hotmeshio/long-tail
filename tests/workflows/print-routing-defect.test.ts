import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { systemEventsConfig } from '../../lib/events/system-events';
import {
  printOrder,
  printer,
  printBroker,
  farmTechnician,
  farmInspector,
} from '../../examples/workflows/print-routing';
import {
  PRINT_FARM_DIABETIC,
  PRINT_FARM_STANDARD,
  PRINTER_POOL_DIABETIC,
  PRINTER_POOL_STANDARD,
  PRINT_FARMER_DIABETIC,
  PRINT_FARMER_STANDARD,
  PRINT_ROUTING_QUEUE,
  PRINT_WORKFLOWS,
} from '../../examples/workflows/print-routing/types';
import type { PrintOrderData, PrintOrderResult, Side } from '../../examples/workflows/print-routing/types';

const { Connection, Client, Worker } = Durable;
const ALL_ROLES = [
  PRINT_FARM_DIABETIC,
  PRINT_FARM_STANDARD,
  PRINTER_POOL_DIABETIC,
  PRINTER_POOL_STANDARD,
  PRINT_FARMER_DIABETIC,
  PRINT_FARMER_STANDARD,
];

// ─────────────────────────────────────────────────────────────────────────────
// The convergence loop. The farmer rejects a defective insole at inspection, and the
// order re-enqueues just that unit as a fresh deficit group through the SAME funnel —
// a route is a hypothesis — until intent ≡ actual. Proves: clean orders converge in
// one pass; a flawed order reprints exactly its rejected unit and converges on the next.
// ─────────────────────────────────────────────────────────────────────────────

describe('print farm — orders reconcile defects by reprinting', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const { getPool } = await import('../../lib/db');
    await getPool().query('DELETE FROM lt_escalations WHERE role = ANY($1::text[])', [ALL_ROLES]);

    const connection = { class: Postgres, options: postgres_options };
    for (const workflow of [printOrder, printer, printBroker, farmTechnician, farmInspector]) {
      const worker = await Worker.create({
        connection,
        taskQueue: PRINT_ROUTING_QUEUE,
        workflow,
        events: systemEventsConfig,
      });
      await worker.run();
    }
    client = new Client({ connection });
  }, 45_000);

  afterAll(async () => {
    const { getPool } = await import('../../lib/db');
    await getPool().query('DELETE FROM lt_escalations WHERE role = ANY($1::text[])', [ALL_ROLES]);
    await sleepFor(500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 20_000);

  it('reprints a rejected unit through the same funnel until the order converges', async () => {
    const now = Date.now();
    const suffix = Durable.guid();
    const printerId = `defect-printer-${suffix}`;
    const units = [{ side: 'L' as Side }, { side: 'R' as Side }, { side: 'L' as Side }, { side: 'R' as Side }];
    const orders: PrintOrderData[] = [0, 1, 2].map((i) => ({
      orderId: `defect-order-${i}-${suffix}`,
      diabetic: true,
      customerId: `cust-${i}`,
      filament: 'pla',
      sizeClass: 'standard',
      units,
      approvedAt: now,
      mustCompleteBy: now + (i + 1) * 60_000,
      ...(i === 1 ? { failUnits: [2] } : {}),
    }));

    await client.workflow.start({
      args: [{ data: { printerId, diabetic: true, filament: 'pla', sizeClass: 'standard' }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.PRINTER,
      workflowId: printerId,
      expire: 600,
    });
    for (const wf of [PRINT_WORKFLOWS.BROKER, PRINT_WORKFLOWS.TECHNICIAN, PRINT_WORKFLOWS.INSPECTOR]) {
      await client.workflow.start({
        args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 }, metadata: {} }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: wf,
        workflowId: `${wf}-${suffix}`,
        expire: 600,
      });
    }

    const handles = await Promise.all(
      orders.map((order) =>
        client.workflow.start({
          args: [{ data: order, metadata: {} }],
          taskQueue: PRINT_ROUTING_QUEUE,
          workflowName: PRINT_WORKFLOWS.ORDER,
          workflowId: order.orderId!,
          expire: 600,
        }),
      ),
    );
    const results = (await Promise.all(handles.map((h) => h.result()))) as Array<{ data: PrintOrderResult }>;

    // Every order converges: intent ≡ actual, nothing left outstanding.
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.data.printed).toBe(true);
      expect(r.data.passed).toBe(true);
      expect(r.data.failedUnits).toEqual([]);
    }

    const byId = new Map(results.map((r) => [r.data.orderId, r.data]));
    const clean0 = byId.get(`defect-order-0-${suffix}`)!;
    const flawed = byId.get(`defect-order-1-${suffix}`)!;
    const clean2 = byId.get(`defect-order-2-${suffix}`)!;

    // Clean orders converge on the first pass; the flawed order takes a second pass —
    // it reprinted exactly its rejected unit and the reprint passed.
    expect(clean0.attempts).toBe(1);
    expect(clean2.attempts).toBe(1);
    expect(flawed.attempts).toBe(2);
    expect(flawed.inspectedBy).toBeTruthy();
  }, 120_000);
});
