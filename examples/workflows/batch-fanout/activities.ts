/**
 * Batch Fanout activities — the child's call-home leg.
 *
 * `callHome` submits one batch item against the parent's accumulator row
 * through the public api/ surface, keyed by the accumulator's signal_key —
 * the deterministic home signal id the child already owns, so no UUID
 * lookup and no facet duplication. It runs under a proxyActivities retry
 * policy: a 404 (the parent has not parked the accumulator yet — the
 * distributed race) throws so the framework retries with backoff until the
 * row exists. A duplicate-item conflict is a successful replay (the item
 * already landed on a prior attempt), never an error.
 */

import { resolveBatchItemBySignalKey } from '../../../api/escalations';

/** GIN facet on the accumulator row — discoverability for searches/dashboards. */
export const FANOUT_HOME_FACET = 'fanout_home';

/** Fallback principal when a child ends without a human resolver (SLA/cancel). */
const SYSTEM_ACTOR = 'lt-system';

export interface FanoutChildReport {
  ok: boolean;
  notes?: string;
  reason?: string;
}

export interface CallHomeInput {
  homeSignalId: string;
  itemKey: string;
  report: FanoutChildReport;
  /** The child's resolver ($resolution.resolvedBy) — provenance carries through. */
  actorId?: string;
}

export interface CallHomeOutcome {
  outcome: string;
  remaining: number | null;
}

export async function callHome(input: CallHomeInput): Promise<CallHomeOutcome> {
  const result = await resolveBatchItemBySignalKey(
    {
      signalKey: input.homeSignalId,
      itemKey: input.itemKey,
      resolverPayload: { ...input.report },
    },
    { userId: input.actorId ?? SYSTEM_ACTOR },
  );

  if (result.status === 200) {
    const data = result.data as { outcome: string; remaining?: number };
    return { outcome: data.outcome, remaining: data.remaining ?? 0 };
  }

  // Replay after a landed fill — the item is home; report it as such.
  if (result.status === 409 && /already submitted/i.test(result.error ?? '')) {
    return { outcome: 'duplicate-item', remaining: null };
  }

  // The parent's accumulator does not exist yet (or was resolved away by an
  // admin override). Fail loud; the activity retry policy owns the backoff.
  throw new Error(
    `callHome(${input.itemKey}) → ${result.status}: ${result.error ?? 'unknown'}`,
  );
}
