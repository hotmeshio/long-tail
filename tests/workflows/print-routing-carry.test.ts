import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { systemEventsConfig } from '../../lib/events/system-events';
import { buildFarmOrders, seedPrintOperators, type PrintOperators } from '../helpers/print-fleet';
import {
  printOrder,
  printer,
  printBroker,
  farmTechnician,
  farmInspector,
} from '../../examples/workflows/print-routing';
import * as escalationService from '../../services/escalation';
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
import type { PrinterData, PrintOrderResult } from '../../examples/workflows/print-routing/types';

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
// Carry-forward under broker contention. Two brokers compete for two printers and
// a book of nine standard orders. In a tick a broker can claim orders by priority
// but lose the printer race; rather than release them it CARRIES the claim across
// continueAsNew and places it on a later tick. Proves: every order converges
// exactly once, no order is orphaned or double-printed, and two brokers sharing a
// scarce fleet make forward progress (no all-or-none livelock).
// ─────────────────────────────────────────────────────────────────────────────

describe('print farm — carry-forward under two contending brokers', () => {
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

  it('two brokers + two printers drain nine orders, carrying claims they cannot place', async () => {
    const now = Date.now();
    const suffix = Durable.guid();
    const fleet: PrinterData[] = [
      { printerId: `carry-p1-${suffix}`, diabetic: true, filament: 'pla', sizeClass: 'standard' },
      { printerId: `carry-p2-${suffix}`, diabetic: true, filament: 'pla', sizeClass: 'standard' },
    ];
    // Reuse the standard order book (nine pla/standard orders); drop the xl ones.
    const orders = buildFarmOrders(now, suffix).filter((o) => o.sizeClass === 'standard');
    const totalInsoles = orders.reduce((sum, o) => sum + o.units.length, 0);
    const printerIds = fleet.map((p) => p.printerId);

    // Supply: two printers. Both advertise into the diabetic pool.
    for (const spec of fleet) {
      await client.workflow.start({
        args: [{ data: { ...spec, operatorId: operators.printerOperatorId }, metadata: {} }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: PRINT_WORKFLOWS.PRINTER,
        workflowId: spec.printerId,
        expire: 600,
      });
    }
    // Two brokers contend for the same fleet and order book.
    for (const n of [1, 2]) {
      await client.workflow.start({
        args: [{
          data: { diabetic: true, brokerId: operators.brokerId, idleTickSeconds: 1, maxIdleRuns: 1_000_000 },
          metadata: {},
        }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: PRINT_WORKFLOWS.BROKER,
        workflowId: `${PRINT_WORKFLOWS.BROKER}-${n}-${suffix}`,
        expire: 600,
      });
    }
    await client.workflow.start({
      args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000, technicianId: operators.technicianId }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.TECHNICIAN,
      workflowId: `${PRINT_WORKFLOWS.TECHNICIAN}-${suffix}`,
      expire: 600,
    });
    await client.workflow.start({
      args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000, inspectorId: operators.inspectorId }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.INSPECTOR,
      workflowId: `${PRINT_WORKFLOWS.INSPECTOR}-${suffix}`,
      expire: 600,
    });

    // Demand: enqueue all nine orders.
    const orderHandles = await Promise.all(
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

    const results = (await Promise.all(orderHandles.map((h) => h.result()))) as Array<{
      data: PrintOrderResult;
    }>;

    // Every order converged exactly once, every insole printed, on the real fleet.
    expect(results).toHaveLength(orders.length);
    for (const r of results) {
      expect(r.data.printed).toBe(true);
      expect(printerIds).toContain(r.data.printerId);
    }
    const insolesPrinted = results.reduce((sum, r) => sum + r.data.units, 0);
    expect(insolesPrinted).toBe(totalInsoles);

    // No origin printed twice — each order id appears once across the converged set.
    const orderIds = results.map((r) => r.data.orderId);
    expect(new Set(orderIds).size).toBe(orders.length);

    // Both printers carried the load (the fleet stayed busy through contention).
    const used = new Set(results.map((r) => r.data.printerId));
    expect(used.size).toBe(2);

    // The diabetic wall held.
    const standardOrders = await escalationService.searchByFacets({ role: PRINT_FARM_STANDARD });
    const standardPool = await escalationService.searchByFacets({ role: PRINTER_POOL_STANDARD });
    expect(standardOrders.total).toBe(0);
    expect(standardPool.total).toBe(0);
  }, 180_000);
});
