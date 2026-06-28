/**
 * Shared activity proxies for the print-routing workflows. Proxy the whole
 * activities barrel once; each workflow imports the handles it calls.
 */

import { Durable } from '@hotmeshio/hotmesh';

import * as activities from '../activities';

export const {
  enqueueOrderUnits,
  claimOrdersForCapacity,
  lockPrintersAndHandoff,
  settleOrder,
  runPrintJob,
  technicianRefill,
  inspectorSignoff,
  buildShiftPlan,
  powerDownIdlePrinters,
} = Durable.workflow.proxyActivities<typeof activities>({
  activities,
  retry: { maximumAttempts: 3 },
});

/** Looping-singleton pacing defaults (broker, technician, inspector). */
export const LOOP_DEFAULTS = { tickSeconds: 1, idleTickSeconds: 5, maxIdleRuns: 3 };
