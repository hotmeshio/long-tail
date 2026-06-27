/**
 * printer — the supply actor. One durable workflow per machine. Its life is bounded
 * (`EOL_RUNS`), so it loops its advert/suspend cycle inside a single execution — the
 * assembly-line idiom of repeated `condition` calls, not a continueAsNew loop. Each
 * iteration writes one advert (ready or needs-filament) and waits to be resolved; on
 * a ready advert the broker hands off a job, the printer runs it and signals back.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { conditionLT } from '../../../../services/orchestrator/condition';
import type { LTEnvelope } from '../../../../types';

import { runPrintJob } from './proxy';
import {
  fleetKind,
  PRINTER_POND,
  PRINT_WORKFLOWS,
  PRINTER_FACETS,
  PRINTER_STATE,
  REFILL_INTERVAL,
  EOL_RUNS,
} from '../types';
import type { PrinterData, PrinterResult, PrinterJobPayload, RefillPayload } from '../types';

export async function printer(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as PrinterData;
  const ctx = Durable.workflow.workflowInfo();
  const printerPond = PRINTER_POND[fleetKind(d.diabetic)];

  let totalRuns = d.totalRuns ?? 0;
  let runsUntilRefill = d.runsUntilRefill ?? REFILL_INTERVAL;
  let refills = d.refills ?? 0;

  while (totalRuns < EOL_RUNS) {
    const baseFacets = {
      [PRINTER_FACETS.PRINTER_ID]: d.printerId,
      [PRINTER_FACETS.FILAMENT]: d.filament,
      [PRINTER_FACETS.SIZE_CLASS]: d.sizeClass,
      [PRINTER_FACETS.TOTAL_RUNS]: totalRuns,
    };

    // Needs filament — advertise maintenance; a technician resolves "added filament".
    if (runsUntilRefill <= 0) {
      const refillSignal = `refill-${ctx.workflowId}-r${totalRuns}`;
      await conditionLT<RefillPayload>(refillSignal, {
        role: printerPond,
        type: PRINT_WORKFLOWS.PRINTER,
        subtype: PRINTER_STATE.MAINTENANCE,
        priority: 1,
        description: `Printer ${d.printerId} needs filament (after run ${totalRuns})`,
        workflowType: PRINT_WORKFLOWS.PRINTER,
        metadata: { ...baseFacets, [PRINTER_FACETS.STATE]: PRINTER_STATE.MAINTENANCE, [PRINTER_FACETS.RUNS_UNTIL_REFILL]: 0 },
        envelope: { printerId: d.printerId, state: PRINTER_STATE.MAINTENANCE },
      });
      runsUntilRefill = REFILL_INTERVAL;
      refills += 1;
      continue;
    }

    // Ready — advertise availability. The broker resolves this advert with a job
    // (orderId + a callback key); the printer runs it and signals the broker back.
    const readySignal = `ready-${ctx.workflowId}-r${totalRuns}`;
    const job = await conditionLT<PrinterJobPayload>(readySignal, {
      role: printerPond,
      type: PRINT_WORKFLOWS.PRINTER,
      subtype: PRINTER_STATE.READY,
      priority: 2,
      description: `Printer ${d.printerId} ready (run ${totalRuns + 1})`,
      workflowType: PRINT_WORKFLOWS.PRINTER,
      metadata: { ...baseFacets, [PRINTER_FACETS.STATE]: PRINTER_STATE.READY, [PRINTER_FACETS.RUNS_UNTIL_REFILL]: runsUntilRefill },
      envelope: { printerId: d.printerId, state: PRINTER_STATE.READY },
    });

    // A real handoff carries a callback key. Run it, report completion, consume the
    // run. A cancel/timeout (no job) re-advertises without consuming a run.
    if (job && job.callbackKey) {
      await runPrintJob({ job, printerId: d.printerId });
      totalRuns += 1;
      runsUntilRefill -= 1;
    }
  }

  // End of life — the asset retires; its whole story is its escalation trail.
  const result: PrinterResult = { printerId: d.printerId, retired: true, totalRuns, refills };
  return { type: 'return' as const, data: result };
}
