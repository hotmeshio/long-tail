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
  printShift,
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
import type { ShiftResult } from '../../examples/workflows/print-routing/types';

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
// The entry target. One invocation of `printShift` runs the whole farm: it powers
// on the fleet + dispatcher, feeds 12 orders through three flavor waves (priority,
// defect/convergence, lifecycle), drains, and powers down idle machines. Proves the
// shift is self-contained and bounded — AND that each finished print recorded its
// OUTCOME (result + boundary duration) onto its `printing` escalation, so the trail
// alone says what was intended and what actually happened.
// ─────────────────────────────────────────────────────────────────────────────

describe('print shift — the invocable entry target runs the farm end to end', () => {
  let client: InstanceType<typeof Client>;
  let operators: PrintOperators;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const { getPool } = await import('../../lib/db');
    await getPool().query('DELETE FROM lt_escalations WHERE role = ANY($1::text[])', [ALL_ROLES]);
    // Robots resolve through the role-gated public API → seed per-pond operators (standard fleet).
    operators = await seedPrintOperators(false);

    const connection = { class: Postgres, options: postgres_options };
    for (const workflow of [printOrder, printer, printBroker, farmTechnician, farmInspector, printShift]) {
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

  it('drains all 12 orders, reprints the defect, powers down, and records each outcome', async () => {
    const suffix = Durable.guid();
    const handle = await client.workflow.start({
      args: [{ data: { diabetic: false, idleTickSeconds: 1, maxIdleRuns: 12, waveGapSeconds: 1, brokerId: operators.brokerId, technicianId: operators.technicianId, inspectorId: operators.inspectorId, ordererId: operators.ordererId, printerOperatorId: operators.printerOperatorId }, metadata: {} }],
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.SHIFT,
      workflowId: `shift-${suffix}`,
      expire: 600,
    });

    const { data: summary } = (await handle.result()) as { data: ShiftResult };

    // The whole order book converged.
    expect(summary.ordersPlaced).toBe(12);
    expect(summary.ordersPrinted).toBe(12);
    expect(summary.insolesPrinted).toBeGreaterThanOrEqual(48); // 12 orders × 4–6 insoles
    expect(summary.insolesPrinted).toBeLessThanOrEqual(72);
    // The defect wave forced at least one reprint (the fixpoint loop converged it).
    expect(summary.reprints).toBeGreaterThanOrEqual(1);
    // The floor cleared — one machine reached end-of-life on its own, the other
    // still had life left and was powered down. Nothing lingers.
    expect(summary.printersPoweredDown).toBeGreaterThanOrEqual(1);
    expect(summary.waves.map((w) => w.name)).toEqual(['rush', 'defect', 'closing']);

    // No printer is left advertising — every machine retired, one way or the other.
    const stillReady = await escalationService.searchByFacets({
      role: PRINTER_POOL_STANDARD,
      facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.READY },
      status: 'pending',
      limit: 200,
    });
    expect(stillReady.total).toBe(0);

    // The headline: every finished print recorded its OUTCOME onto the `printing`
    // escalation it resolved — "what happened" merged onto the row that held the
    // intent. Query the resolved printing rows and assert the outcome facets exist.
    const { escalations } = await escalationService.searchByFacets({
      role: PRINTER_POOL_STANDARD,
      facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.PRINTING },
      status: 'resolved',
      limit: 200,
    });
    expect(escalations.length).toBeGreaterThanOrEqual(12); // ≥1 per printed order + reprints
    for (const row of escalations) {
      expect(row.metadata?.outcome).toBe('success');
      expect(typeof row.metadata?.unitsPrinted).toBe('number');
      // Intent preserved alongside the outcome — one row, the whole story.
      expect(row.metadata?.printerId).toBeTruthy();
      // Boundary duration is inherent in the row, not a stored field: created_at
      // (handoff) → resolved_at (done). No read, no stored copy.
      expect(row.created_at).toBeTruthy();
      expect(row.resolved_at).toBeTruthy();
      expect(new Date(row.resolved_at!).getTime()).toBeGreaterThanOrEqual(new Date(row.created_at).getTime());
    }
  }, 180_000);
});
