import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { systemEventsConfig } from '../../lib/events/system-events';
import { seedPrintOperators, type PrintOperators } from '../helpers/print-fleet';
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
import type { PrintOrderData, PrintOrderResult, Side, SizeClass } from '../../examples/workflows/print-routing/types';

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
// Soft capability with overflow. An xl printer can serve a standard order; a
// standard order overflows to it when standard capacity is full. An xl order is a
// hard fit — xl-only. Proves: standard work spreads onto the xl machine, while the
// xl order is never routed to the standard machine.
// ─────────────────────────────────────────────────────────────────────────────

describe('print farm — standard work overflows to the xl machine (soft capability)', () => {
  let client: InstanceType<typeof Client>;
  let operators: PrintOperators;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const { getPool } = await import('../../lib/db');
    await getPool().query('DELETE FROM lt_escalations WHERE role = ANY($1::text[])', [ALL_ROLES]);
    // Robots resolve through the role-gated public API → seed per-pond operators.
    operators = await seedPrintOperators(true);

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

  it('overflows standard orders to the xl printer, keeps the xl order xl-only', async () => {
    const now = Date.now();
    const suffix = Durable.guid();
    const stdPrinterId = `ovf-std-${suffix}`;
    const xlPrinterId = `ovf-xl-${suffix}`;
    const units = [{ side: 'L' as Side }, { side: 'R' as Side }];

    const stdOrders: PrintOrderData[] = [0, 1, 2, 3].map((i) => ({
      orderId: `ovf-std-order-${i}-${suffix}`,
      diabetic: true, customerId: `cust-${i}`, filament: 'pla', sizeClass: 'standard' as SizeClass,
      units, approvedAt: now, mustCompleteBy: now + (i + 1) * 60_000,
    }));
    const xlOrder: PrintOrderData = {
      orderId: `ovf-xl-order-${suffix}`,
      diabetic: true, customerId: 'cust-xl', filament: 'pla', sizeClass: 'xl', units,
      approvedAt: now, mustCompleteBy: now + 60_000,
    };
    const orders = [...stdOrders, xlOrder];

    // Fleet: one standard machine, one xl machine.
    for (const [id, sizeClass] of [[stdPrinterId, 'standard'], [xlPrinterId, 'xl']] as const) {
      await client.workflow.start({
        args: [{ data: { printerId: id, diabetic: true, filament: 'pla', sizeClass, operatorId: operators.printerOperatorId }, metadata: {} }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: PRINT_WORKFLOWS.PRINTER,
        workflowId: id,
        expire: 600,
      });
    }
    for (const wf of [PRINT_WORKFLOWS.BROKER, PRINT_WORKFLOWS.TECHNICIAN, PRINT_WORKFLOWS.INSPECTOR]) {
      await client.workflow.start({
        args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000, brokerId: operators.brokerId, technicianId: operators.technicianId, inspectorId: operators.inspectorId }, metadata: {} }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: wf,
        workflowId: `${wf}-${suffix}`,
        expire: 600,
      });
    }

    const handles = await Promise.all(
      orders.map((order) =>
        client.workflow.start({
          args: [{ data: { ...order, operatorId: operators.ordererId }, metadata: {} }],
          taskQueue: PRINT_ROUTING_QUEUE,
          workflowName: PRINT_WORKFLOWS.ORDER,
          workflowId: order.orderId!,
          expire: 600,
        }),
      ),
    );
    const results = (await Promise.all(handles.map((h) => h.result()))) as Array<{ data: PrintOrderResult }>;

    expect(results).toHaveLength(5);
    for (const r of results) expect(r.data.printed).toBe(true);

    const printerOf = (id: string) => results.find((r) => r.data.orderId === id)!.data.printerId;

    // Hard fit: the xl order ran only on the xl machine.
    expect(printerOf(xlOrder.orderId!)).toBe(xlPrinterId);

    // Overflow: at least one standard order ran on the xl machine, and every
    // standard order ran on one of the two machines (never elsewhere).
    const stdPrintersUsed = stdOrders.map((o) => printerOf(o.orderId!));
    expect(stdPrintersUsed).toContain(xlPrinterId);
    for (const p of stdPrintersUsed) expect([stdPrinterId, xlPrinterId]).toContain(p);
  }, 180_000);
});
