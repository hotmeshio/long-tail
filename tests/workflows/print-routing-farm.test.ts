import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { systemEventsConfig } from '../../lib/events/system-events';
import { buildFarm, buildFarmOrders } from '../helpers/print-fleet';
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
import type { PrintOrderResult } from '../../examples/workflows/print-routing/types';

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
// The farm, not one machine. A fleet of printers (three pla/standard, one pla/xl)
// drains a mixed order book concurrently. Proves: the broker's all-or-none batch
// claim locks multiple printers at once and fans out callbacks in parallel; work
// spreads across the standard fleet; the hard capability wall routes xl orders to
// the xl machine only; every insole prints.
// ─────────────────────────────────────────────────────────────────────────────

describe('print farm — a fleet draining concurrently (multi-printer, capability)', () => {
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

  it('spreads 12 mixed orders across a 4-printer fleet, xl-only routed to the xl machine', async () => {
    const now = Date.now();
    const suffix = Durable.guid();
    const fleet = buildFarm(suffix);
    const orders = buildFarmOrders(now, suffix);
    const xlPrinterId = fleet.find((p) => p.sizeClass === 'xl')!.printerId;
    const stdPrinterIds = fleet.filter((p) => p.sizeClass === 'standard').map((p) => p.printerId);
    const totalInsoles = orders.reduce((sum, o) => sum + o.units.length, 0); // 60

    // Supply: launch the whole fleet. Each machine advertises itself.
    for (const spec of fleet) {
      await client.workflow.start({
        args: [{ data: spec, metadata: {} }],
        taskQueue: PRINT_ROUTING_QUEUE,
        workflowName: PRINT_WORKFLOWS.PRINTER,
        workflowId: spec.printerId,
        expire: 600,
      });
    }
    // One broker + technician for the diabetic fleet. They run until afterAll.
    await client.workflow.start({
      args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.BROKER,
      workflowId: `${PRINT_WORKFLOWS.BROKER}-${suffix}`,
      expire: 600,
    });
    await client.workflow.start({
      args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.TECHNICIAN,
      workflowId: `${PRINT_WORKFLOWS.TECHNICIAN}-${suffix}`,
      expire: 600,
    });
    await client.workflow.start({
      args: [{ data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.INSPECTOR,
      workflowId: `${PRINT_WORKFLOWS.INSPECTOR}-${suffix}`,
      expire: 600,
    });

    // Demand: enqueue all 12 orders; each parks until the farm prints it.
    const orderHandles = await Promise.all(
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

    const results = (await Promise.all(orderHandles.map((h) => h.result()))) as Array<{
      data: PrintOrderResult;
    }>;

    // Every order converged, and every insole printed.
    expect(results).toHaveLength(12);
    for (const r of results) expect(r.data.printed).toBe(true);
    const insolesPrinted = results.reduce((sum, r) => sum + r.data.units, 0);
    expect(insolesPrinted).toBe(totalInsoles);

    // Capability: an xl order is a HARD fit — only the xl machine. A standard order
    // runs on a standard machine or overflows to the larger xl one (soft capability).
    const allPrinterIds = [...stdPrinterIds, xlPrinterId];
    const byOrder = new Map(results.map((r) => [r.data.orderId, r.data.printerId]));
    for (const o of orders) {
      const printerUsed = byOrder.get(o.orderId!);
      if (o.sizeClass === 'xl') expect(printerUsed).toBe(xlPrinterId);
      else expect(allPrinterIds).toContain(printerUsed);
    }

    // It is a farm, not one machine: standard work spread across the fleet.
    const stdUsed = new Set(
      results
        .filter((r) => stdPrinterIds.includes(r.data.printerId))
        .map((r) => r.data.printerId),
    );
    expect(stdUsed.size).toBeGreaterThanOrEqual(2);

    // The diabetic wall held — no diabetic work ever touched the standard ponds.
    const standardOrders = await escalationService.searchByFacets({ role: PRINT_FARM_STANDARD });
    const standardPool = await escalationService.searchByFacets({ role: PRINTER_POOL_STANDARD });
    expect(standardOrders.total).toBe(0);
    expect(standardPool.total).toBe(0);
  }, 180_000);
});
