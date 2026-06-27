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
// Priority is a business decision. With one printer and equal deadlines, the
// standing policy ([pastDue, keyAccount, reprint, fifo]) decides the queue: a key
// account jumps ahead of orders that arrived before it. Proves the pluggable rule
// layer changes *which runs first* without touching the broker.
// ─────────────────────────────────────────────────────────────────────────────

describe('print farm — a key account jumps the queue (pluggable priority)', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const { getPool } = await import('../../lib/db');
    await getPool().query('DELETE FROM lt_escalations WHERE role = ANY($1::text[])', [ALL_ROLES]);

    const connection = { class: Postgres, options: postgres_options };
    for (const workflow of [printOrder, printer, printBroker, farmTechnician, farmInspector]) {
      const worker = await Worker.create({ connection, taskQueue: PRINT_ROUTING_QUEUE, workflow, events: systemEventsConfig });
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

  it('prints the key-account order first though it arrived third', async () => {
    const now = Date.now();
    const suffix = Durable.guid();
    const printerId = `prio-printer-${suffix}`;
    const units = [{ side: 'L' as Side }, { side: 'R' as Side }];
    // Five orders, equal deadlines so jeopardy ties. The key account (kacct-1) is
    // third in arrival — FIFO would not favor it; the keyAccount rule does.
    const customers = ['walk-1', 'walk-2', 'kacct-1', 'walk-3', 'walk-4'];
    const orders: PrintOrderData[] = customers.map((customerId, i) => ({
      orderId: `prio-order-${i}-${customerId}-${suffix}`,
      diabetic: true,
      customerId,
      filament: 'pla',
      sizeClass: 'standard',
      units,
      approvedAt: now,
      mustCompleteBy: now + 3_600_000, // all equal
    }));
    const keyOrderId = orders[2].orderId!;

    // Supply first, so a ready advert exists.
    await client.workflow.start({
      args: [{ data: { printerId, diabetic: true, filament: 'pla', sizeClass: 'standard' }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.PRINTER,
      workflowId: printerId,
      expire: 600,
    });

    // Enqueue all demand BEFORE any broker runs, so the first claim sees the whole
    // book and the policy — not arrival timing — decides what goes first.
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
    await sleepFor(2_000); // let every order's escalations land

    // Now start the broker (and farmer/technician) — one printer, so it claims one
    // order per tick in priority order.
    for (const wf of [PRINT_WORKFLOWS.BROKER, PRINT_WORKFLOWS.TECHNICIAN, PRINT_WORKFLOWS.INSPECTOR]) {
      await client.workflow.start({
        args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 }, metadata: {} }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: wf,
        workflowId: `${wf}-${suffix}`,
        expire: 600,
      });
    }

    const results = (await Promise.all(handles.map((h) => h.result()))) as Array<{ data: PrintOrderResult }>;
    expect(results).toHaveLength(5);
    for (const r of results) expect(r.data.printed).toBe(true);

    // Serial printer ⇒ completion order = claim order = priority order. The key
    // account, though it arrived third, was printed first.
    const completedAt = (id: string) => results.find((r) => r.data.orderId === id)!.data.completedAt;
    const earliest = results.map((r) => r.data.completedAt).sort()[0];
    expect(completedAt(keyOrderId)).toBe(earliest);
  }, 180_000);
});
