/**
 * twinBroker — the market maker at the physical boundary. Each tick: claim
 * complete demand groups sized to ready supply, lock each order's printer SET
 * all-or-nothing, hand off, tell the farm manager to print (the placeholder
 * proxyActivity that becomes the real farm-manager API call), harvest every
 * twin's report, settle. continueAsNew bounds the history; it runs durably
 * until the floor stays idle.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';
import type { ClaimedGroup } from '../../../../types';

import { claimJobGroups, lockTwinsAndHandoff, releaseGroup, settleJob, LOOP_DEFAULTS } from './proxy';
import { PRINTER_FLEET, TWIN_WORKFLOWS, TWIN_STATE, TWIN_FACETS } from '../types';
import type { TwinBrokerData, TwinBrokerTotals, TwinPairing, TwinCallbackPayload } from '../types';

export async function twinBroker(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as TwinBrokerData;
  if (!d.brokerId) throw new Error('twinBroker requires data.brokerId (a fleet + jobs pond operator)');
  const ctx = Durable.workflow.workflowInfo();
  const cumulative: TwinBrokerTotals = d.cumulative ?? { jobsDispatched: 0, ordersSettled: 0, runs: 0 };
  const tick = cumulative.runs; // deterministic per-tick counter — key uniqueness

  // 1. Claim demand sized to ready supply — complete groups only.
  const { groups } = await claimJobGroups({
    brokerId: d.brokerId,
    claimMinutes: d.claimMinutes,
    maxGroups: d.maxGroups,
    maxAdverts: d.maxAdverts,
  });

  // 2. Per group: lock the printer set all-or-nothing and hand each twin its
  //    job. A skipped group's claim TTL-expires back to the pool on its own.
  const placed: { group: ClaimedGroup; pairings: TwinPairing[] }[] = [];
  for (const group of groups) {
    const r = await lockTwinsAndHandoff({
      group,
      brokerId: d.brokerId,
      brokerWorkflowId: ctx.workflowId,
      tick,
      claimMinutes: d.claimMinutes,
    });
    if (r.skipped) {
      // No complete printer set for this order this tick — hand the claim back
      // so the next tick can re-match it, instead of holding it locked for the TTL.
      await releaseGroup({ group, brokerId: d.brokerId });
    } else {
      placed.push({ group, pairings: r.pairings });
    }
  }
  const pairings = placed.flatMap((p) => p.pairings);

  // The physical print is driven by the TWIN itself: it polls its advert, sees
  // the job we handed off, uploads + prints on the real machine, and reconciles
  // the print to a poll-confirmed terminal. The broker just hands off and waits.

  // 3. Harvest — one `dispatched` row per pairing (the broker's side of the
  //    in-flight job). The twin resolves it with the print outcome, which
  //    resumes this collated wait. Keep concurrent waits ≤ 20 (the platform's
  //    condition-collation cap); an office fleet is well under it.
  if (pairings.length) {
    const dones = await Promise.all(
      pairings.map((p) =>
        Durable.workflow.condition<TwinCallbackPayload>(p.callbackKey, {
          role: PRINTER_FLEET,
          type: TWIN_WORKFLOWS.BROKER,
          subtype: TWIN_STATE.DISPATCHED,
          priority: 2,
          description: `Job ${p.jobId} dispatched to printer ${p.printerId}`,
          workflowType: TWIN_WORKFLOWS.BROKER,
          metadata: {
            [TWIN_FACETS.PRINTER_ID]: p.printerId,
            [TWIN_FACETS.STATE]: TWIN_STATE.DISPATCHED,
            jobId: p.jobId,
            orderId: p.orderId,
          },
        }),
      ),
    );

    // 4. Settle each order with its units' outcomes and wake the order workflow.
    for (const { group, pairings: groupPairings } of placed) {
      const outcomes = groupPairings
        .map((p) => dones[pairings.indexOf(p)])
        .filter((o): o is TwinCallbackPayload => Boolean(o));
      await settleJob({ group, outcomes, brokerId: d.brokerId });
      cumulative.ordersSettled += 1;
    }
  }

  cumulative.jobsDispatched += pairings.length;
  cumulative.runs += 1;

  const working = pairings.length > 0;
  const maxIdleRuns = d.maxIdleRuns ?? LOOP_DEFAULTS.maxIdleRuns;
  const idleRuns = working ? 0 : (d.idleRuns ?? 0) + 1;
  if (idleRuns >= maxIdleRuns) {
    return { type: 'return' as const, data: { ...cumulative, stopped: 'idle' } };
  }

  const tickSecs = working
    ? (d.tickSeconds ?? LOOP_DEFAULTS.tickSeconds)
    : (d.idleTickSeconds ?? LOOP_DEFAULTS.idleTickSeconds);
  await Durable.workflow.sleep(`${tickSecs} seconds`);

  const nextEnvelope: LTEnvelope = {
    data: { ...d, cumulative, idleRuns },
    metadata: envelope.metadata ?? {},
  };
  await Durable.workflow.continueAsNew(nextEnvelope);
}
