/**
 * Shared activity proxies for the printer-twin workflows.
 */

import { Durable } from '@hotmeshio/hotmesh';

import * as activities from '../activities';

// The twin's poll/reconcile hot loop runs ~60s per call — give it a generous
// start-to-close ceiling above the batch window.
export const { pollReconcileBatch } = Durable.workflow.proxyActivities<typeof activities>({
  activities,
  startToCloseTimeout: '90 seconds',
  retry: { maximumAttempts: 3 },
});

// Broker/order activities are quick — default timeout.
export const { enqueueJobUnits, claimJobGroups, lockTwinsAndHandoff, releaseGroup, settleJob } =
  Durable.workflow.proxyActivities<typeof activities>({
    activities,
    retry: { maximumAttempts: 3 },
  });

/** Looping-singleton pacing defaults (broker). */
export const LOOP_DEFAULTS = { tickSeconds: 1, idleTickSeconds: 5, maxIdleRuns: 3 };
