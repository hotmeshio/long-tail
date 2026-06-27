import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { migrate } from '../../lib/db/migrate';
import { systemEventsConfig } from '../../lib/events/system-events';
import { buildEolPrinter, buildEolOrders } from '../helpers/print-fleet';
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
  PRINTER_FACETS,
  PRINTER_STATE,
} from '../../examples/workflows/print-routing/types';
import type {
  PrintOrderResult,
  PrinterResult,
} from '../../examples/workflows/print-routing/types';

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
// Printers as durable workflows. A printer advertises itself as an escalation;
// the broker claims it and a matching order, prints, and resolves both — which
// advances the printer's lifecycle. Proves: one printer drains 10 orders,
// refilling its filament after runs 3/6/9 and retiring at run 10, and its entire
// story is recoverable from a single query over the supply pond.
// ─────────────────────────────────────────────────────────────────────────────

describe('print farm — printers as durable workflows (advert lifecycle)', () => {
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

  it('drains 10 orders through one printer that refills at 3/6/9 and retires at 10', async () => {
    const now = Date.now();
    const suffix = Durable.guid();
    const printerSpec = buildEolPrinter(suffix);
    const orders = buildEolOrders(now, suffix);

    // Supply: the printer advertises itself. Outsiders: the broker and technician.
    const printerHandle = await client.workflow.start({
      args: [{ data: printerSpec, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.PRINTER,
      workflowId: printerSpec.printerId,
      expire: 600,
    });
    // Outsiders run until afterAll shuts them down (never self-stop mid-drain).
    // Each broker tick claims an order by priority, all-or-none locks the printer,
    // hands off the job, and parks on the printer's completion callback before
    // settling the order and continueAsNew'ing.
    await client.workflow.start({
      args: [{
        data: {
          diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000,
        },
        metadata: {},
      }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.BROKER,
      workflowId: `${PRINT_WORKFLOWS.BROKER}-${suffix}`,
      expire: 600,
    });
    await client.workflow.start({
      args: [{
        data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 },
        metadata: {},
      }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.TECHNICIAN,
      workflowId: `${PRINT_WORKFLOWS.TECHNICIAN}-${suffix}`,
      expire: 600,
    });
    await client.workflow.start({
      args: [{
        data: { diabetic: true, idleTickSeconds: 1, maxIdleRuns: 1_000_000 },
        metadata: {},
      }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.INSPECTOR,
      workflowId: `${PRINT_WORKFLOWS.INSPECTOR}-${suffix}`,
      expire: 600,
    });

    // Demand: enqueue 10 orders; each parks until the farm prints it.
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

    // Every order converges — all on the one diabetic printer.
    const results = (await Promise.all(orderHandles.map((h) => h.result()))) as Array<{
      data: PrintOrderResult;
    }>;
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.data.printed).toBe(true);
      expect(r.data.printerId).toBe(printerSpec.printerId);
      expect(r.data.role).toBe(PRINT_FARM_DIABETIC);
      // Each order was woken only after the farmer inspected and signed it off.
      expect(r.data.passed).toBe(true);
      expect(r.data.inspectedBy).toBeTruthy();
    }

    // Every signoff escalation the broker raised was resolved by the farmer.
    const signoffs = await escalationService.searchByFacets({ role: PRINT_FARMER_DIABETIC, limit: 100 });
    expect(signoffs.total).toBe(10);
    expect(signoffs.escalations.every((e) => e.status === 'resolved')).toBe(true);

    // The printer reaches end-of-life: 10 runs, 3 refills, then the workflow completes.
    const printerResult = (await printerHandle.result()) as { data: PrinterResult };
    expect(printerResult.data.retired).toBe(true);
    expect(printerResult.data.totalRuns).toBe(10);
    expect(printerResult.data.refills).toBe(3);

    // The printer's entire story is one query over the supply pond.
    const { escalations } = await escalationService.searchByFacets({
      role: PRINTER_POOL_DIABETIC,
      facets: { [PRINTER_FACETS.PRINTER_ID]: printerSpec.printerId },
      limit: 100,
    });
    const ready = escalations.filter((e) => (e.metadata as any)?.state === PRINTER_STATE.READY);
    const maintenance = escalations.filter((e) => (e.metadata as any)?.state === PRINTER_STATE.MAINTENANCE);
    expect(ready).toHaveLength(10);
    expect(maintenance).toHaveLength(3);
    expect(escalations.every((e) => e.status === 'resolved')).toBe(true);

    // Nothing pending remains for a retired printer.
    const { total: pending } = await escalationService.searchByFacets({
      role: PRINTER_POOL_DIABETIC,
      status: 'pending',
      facets: { [PRINTER_FACETS.PRINTER_ID]: printerSpec.printerId },
    });
    expect(pending).toBe(0);

    // The hard wall held — no diabetic work ever touched the standard ponds.
    const standardOrders = await escalationService.searchByFacets({ role: PRINT_FARM_STANDARD });
    const standardPool = await escalationService.searchByFacets({ role: PRINTER_POOL_STANDARD });
    expect(standardOrders.total).toBe(0);
    expect(standardPool.total).toBe(0);
  }, 180_000);
});
