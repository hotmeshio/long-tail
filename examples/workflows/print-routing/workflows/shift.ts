/**
 * printShift — the invocable entry target: one click runs the whole farm.
 *
 * Kicking it off opens a shift. The shift powers on the machines and the
 * dispatcher (broker) + the technician + the inspector — durable loops that work
 * the floor and self-terminate once it's idle — then feeds order *flavors* through
 * in waves, each a different dimension (priority, defect/convergence, lifecycle).
 * A small `Durable.sleep` beats between waves so the trace reads like a real shift.
 *
 * The dispatcher runs for as long as there is work and no longer; the shift
 * completes when every order has converged. It then powers down any printer the
 * work no longer needs, so nothing lingers — everything is bounded. The whole run
 * is a query over the escalation trail: what was intended, what happened, how long
 * each print took, what was retried, and when each machine retired.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { buildShiftPlan, powerDownIdlePrinters } from './proxy';
import { PRINT_ROUTING_QUEUE, PRINT_WORKFLOWS } from '../types';
import type { ShiftData, ShiftResult, ShiftWave, PrintOrderResult } from '../types';

/** Sensible defaults — an empty `{}` runs the standard full-lifecycle scenario. */
const SHIFT_DEFAULTS = {
  idleTickSeconds: 1,
  /** Idle ticks a dispatcher loop tolerates before self-terminating. */
  maxIdleRuns: 12,
  /** Illustrative beat between waves. */
  waveGapSeconds: 1,
  /** How long children may outlive completion (cleanup horizon, seconds). */
  childExpire: 600,
  /** Power-down sweeps after the floor clears (idle printers retire). */
  maxPowerDownSweeps: 6,
} as const;

export async function printShift(envelope: LTEnvelope): Promise<any> {
  const d = (envelope.data ?? {}) as ShiftData;
  const ctx = Durable.workflow.workflowInfo();
  const suffix = ctx.workflowId;
  const diabetic = d.diabetic ?? false;
  const idleTickSeconds = d.idleTickSeconds ?? SHIFT_DEFAULTS.idleTickSeconds;
  const maxIdleRuns = d.maxIdleRuns ?? SHIFT_DEFAULTS.maxIdleRuns;
  const waveGapSeconds = d.waveGapSeconds ?? SHIFT_DEFAULTS.waveGapSeconds;
  const expire = SHIFT_DEFAULTS.childExpire;

  // 1. Assemble the scenario (fleet + flavor waves) — timestamps live in the activity.
  const plan = await buildShiftPlan({ suffix, diabetic });
  const printerIds = plan.fleet.map((p) => p.printerId);

  // 2. Supply + drivers — fire the long-lived loops. The dispatcher and its crew
  //    self-terminate after `maxIdleRuns` idle ticks; the printers run until retired.
  for (const spec of plan.fleet) {
    await Durable.workflow.startChild({
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: PRINT_WORKFLOWS.PRINTER,
      workflowId: spec.printerId,
      args: [{ data: spec, metadata: {} }],
      expire,
    });
  }
  const loopData = { diabetic, idleTickSeconds, maxIdleRuns };
  for (const [name, role] of [
    [PRINT_WORKFLOWS.BROKER, 'broker'],
    [PRINT_WORKFLOWS.TECHNICIAN, 'technician'],
    [PRINT_WORKFLOWS.INSPECTOR, 'inspector'],
  ] as const) {
    await Durable.workflow.startChild({
      taskQueue: PRINT_ROUTING_QUEUE,
      workflowName: name,
      workflowId: `${role}-${suffix}`,
      args: [{ data: loopData, metadata: {} }],
      expire,
    });
  }

  // 3. Demand — push the flavor waves. Each wave fans out as child orders and fully
  //    converges before the next is released (a clean, proven fan-in), with a beat
  //    between so the lifecycle unfolds the way it would on a real floor.
  const results: PrintOrderResult[] = [];
  const waveSummary: { name: string; orders: number }[] = [];
  for (let w = 0; w < plan.waves.length; w++) {
    const wave: ShiftWave = plan.waves[w];
    if (w > 0) await Durable.workflow.sleep(`${waveGapSeconds} seconds`);
    const printed = await Promise.all(
      wave.orders.map((order) =>
        Durable.workflow.executeChild<{ data: PrintOrderResult }>({
          taskQueue: PRINT_ROUTING_QUEUE,
          workflowName: PRINT_WORKFLOWS.ORDER,
          workflowId: order.orderId!,
          args: [{ data: order, metadata: {} }],
          expire,
        }),
      ),
    );
    results.push(...printed.map((r) => r.data));
    waveSummary.push({ name: wave.name, orders: wave.orders.length });
  }

  // 4. The floor is clear — retire any printer still idling. Sweep until none remain
  //    (a printer mid-job re-advertises, then the next sweep catches it). Bounded.
  let retired = 0;
  for (let sweep = 0; sweep < SHIFT_DEFAULTS.maxPowerDownSweeps; sweep++) {
    const { poweredDown } = await powerDownIdlePrinters({ diabetic, printerIds });
    retired += poweredDown;
    if (retired >= printerIds.length) break;
    await Durable.workflow.sleep('1 second');
  }

  const summary: ShiftResult = {
    shiftId: suffix,
    diabetic,
    ordersPlaced: results.length,
    ordersPrinted: results.filter((r) => r.printed).length,
    insolesPrinted: results.reduce((sum, r) => sum + r.units, 0),
    reprints: results.reduce((sum, r) => sum + Math.max(0, r.attempts - 1), 0),
    printersPoweredDown: retired,
    waves: waveSummary,
  };
  return { type: 'return' as const, data: summary };
}
