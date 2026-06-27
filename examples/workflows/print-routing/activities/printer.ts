/**
 * Printer-side activity — the printer's "print": run the job, then signal the
 * broker's deterministic callback key. An early signal (the broker has not parked
 * yet) is stored and applied when the broker's condition registers — order-safe.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../../../lib/db';

import { PRINT_ROUTING_QUEUE, PRINT_WORKFLOWS } from '../types';
import type { PrinterJobPayload, PrintCallbackPayload } from '../types';

export async function runPrintJob(input: {
  job: PrinterJobPayload;
  printerId: string;
}): Promise<void> {
  const { job, printerId } = input;
  const payload: PrintCallbackPayload = {
    result: 'success',
    printerId,
    orderId: job.orderId,
    units: job.units,
    completedAt: new Date().toISOString(),
  };
  const client = new Durable.Client({ connection: getConnection() });
  const handle = await client.workflow.getHandle(
    PRINT_ROUTING_QUEUE,
    PRINT_WORKFLOWS.BROKER,
    job.brokerWorkflowId,
  );
  await handle.signal(job.callbackKey, payload);
}
