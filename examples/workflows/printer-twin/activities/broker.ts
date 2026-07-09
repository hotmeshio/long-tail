/**
 * Broker activities — the market maker's side effects at the twin boundary.
 *
 *   claimJobGroups       → claim complete demand groups, sized to ready supply
 *   lockTwinsAndHandoff  → claim the printer SET all-or-nothing, hand each its job
 *   settleJob            → resolve the order's rows and wake the order workflow
 */

import { createClient } from '../../../../sdk';
import type { ClaimedGroup } from '../../../../types';

import { claimFacetsForGroup } from '../policy';
import {
  PRINT_JOBS,
  PRINTER_FLEET,
  TWIN_FACETS,
  JOB_FACETS,
  TWIN_STATE,
  DEFAULT_TWIN_CLAIM_MINUTES,
  DEFAULT_MAX_GROUPS,
  DEFAULT_MAX_ADVERTS,
} from '../types';
import type { TwinPairing, TwinJobPayload, TwinCallbackPayload, OrderSettledSignal } from '../types';
import { signalOrderSettled } from './signal';

// ── Step 1: claim complete demand groups, sized to ready supply ─────────────

/**
 * Read the ready adverts first (availability is a query, not a hash) and claim
 * at most that many demand groups — claiming demand the floor cannot place just
 * parks it behind a claim TTL for nothing.
 */
export async function claimJobGroups(input: {
  brokerId: string;
  claimMinutes?: number;
  maxGroups?: number;
  maxAdverts?: number;
}): Promise<{ groups: ClaimedGroup[] }> {
  const lt = createClient({ auth: { userId: input.brokerId } });

  const ready = await lt.escalations.searchByFacets({
    role: PRINTER_FLEET,
    status: 'pending',
    available: true,
    facets: { [TWIN_FACETS.STATE]: TWIN_STATE.READY },
    limit: input.maxAdverts ?? DEFAULT_MAX_ADVERTS,
  });
  if (ready.status !== 200) throw new Error(`searchByFacets failed: ${ready.error}`);
  const freeTwins = ready.data.escalations.length;
  if (freeTwins === 0) return { groups: [] };

  const res = await lt.escalations.claimGroups({
    query: {
      role: PRINT_JOBS,
      available: true,
      orderBy: [{ field: 'priority', direction: 'asc' }, { field: 'created_at', direction: 'asc' }],
    },
    limit: Math.min(input.maxGroups ?? DEFAULT_MAX_GROUPS, freeTwins),
    durationMinutes: input.claimMinutes ?? DEFAULT_TWIN_CLAIM_MINUTES,
    sizeFacet: JOB_FACETS.ORDER_SIZE,
  });
  if (res.status !== 200) throw new Error(`claimGroups failed: ${res.error}`);
  return { groups: res.data.groups };
}

// ── Step 2: lock the printer set all-or-nothing, hand off the jobs ───────────

/**
 * An order's units print as a set, so the printer set is claimed with
 * `allOrNone: true` — either every unit gets a machine this tick or none is
 * touched. A skipped group stays claimed until its TTL returns it to the pool,
 * where a later tick (with more free machines) re-claims it fresh.
 *
 * A locked twin gets its job by RESOLVING its ready advert — the atomic wake
 * that carries `{ gcodeUrl, callbackKey, printDoneKey }` to the parked twin.
 */
export async function lockTwinsAndHandoff(input: {
  group: ClaimedGroup;
  brokerId: string;
  brokerWorkflowId: string;
  tick: number;
  claimMinutes?: number;
}): Promise<{ pairings: TwinPairing[]; skipped: boolean }> {
  const { group } = input;
  const head = group.members[0];
  const orderId = group.originId ?? head.workflow_id ?? '';
  const headMeta = (head.metadata ?? {}) as Record<string, unknown>;

  const lt = createClient({ auth: { userId: input.brokerId } });

  const locked = await lt.escalations.claimByFacets({
    query: { role: PRINTER_FLEET, facets: claimFacetsForGroup(headMeta) },
    limit: group.members.length,
    durationMinutes: input.claimMinutes ?? DEFAULT_TWIN_CLAIM_MINUTES,
    allOrNone: true,
  });
  if (locked.status !== 200) throw new Error(`claimByFacets failed: ${locked.error}`);
  const adverts = locked.data.claimed;
  if (adverts.length < group.members.length) return { pairings: [], skipped: true };

  const pairings: TwinPairing[] = [];
  for (let i = 0; i < group.members.length; i++) {
    const member = group.members[i];
    const memberMeta = (member.metadata ?? {}) as Record<string, unknown>;
    const advert = adverts[i];
    const advertMeta = (advert.metadata ?? {}) as Record<string, unknown>;
    const unitIndex = Number(memberMeta[JOB_FACETS.UNIT_INDEX] ?? i);

    const jobId = `${orderId}-u${unitIndex}-t${input.tick}`;
    const pairing: TwinPairing = {
      printerId: String(advertMeta[TWIN_FACETS.PRINTER_ID] ?? ''),
      serialNumber: String(advertMeta[TWIN_FACETS.SERIAL_NUMBER] ?? ''),
      model: String(advertMeta[TWIN_FACETS.MODEL] ?? ''),
      jobId,
      orderId,
      unitIndex,
      gcodeUrl: String(memberMeta[JOB_FACETS.GCODE_URL] ?? ''),
      callbackKey: `cb-${input.brokerWorkflowId}-${jobId}`,
      printDoneKey: `print-done-${jobId}`,
    };
    const job: TwinJobPayload = {
      jobId,
      orderId,
      unitIndex,
      gcodeUrl: pairing.gcodeUrl,
      callbackKey: pairing.callbackKey,
      printDoneKey: pairing.printDoneKey,
      brokerWorkflowId: input.brokerWorkflowId,
      simOutcome: memberMeta[JOB_FACETS.SIM_OUTCOME] as TwinJobPayload['simOutcome'],
    };
    // Resolve as the broker operator — an efficient (signal_key) row, so this
    // marks the advert resolved AND delivers the job to the parked twin atomically.
    await lt.escalations.resolve({ id: advert.id, resolverPayload: job });
    pairings.push(pairing);
  }
  return { pairings, skipped: false };
}

/**
 * Release a claimed group's rows back to the pool. Called when a group's full
 * printer set could not be locked this tick: rather than let the claim sit
 * locked until its TTL expires (minutes), hand the demand straight back so the
 * next tick — with more machines free — can re-match it. Keeps the floor liquid.
 */
export async function releaseGroup(input: {
  group: ClaimedGroup;
  brokerId: string;
}): Promise<void> {
  const lt = createClient({ auth: { userId: input.brokerId } });
  for (const member of input.group.members) {
    // Best-effort — a row whose claim already expired is fine to skip.
    await lt.escalations.release({ id: member.id }).catch(() => { /* already free */ });
  }
}

// ── Step 3: settle an order once every unit reported ────────────────────────

export async function settleJob(input: {
  group: ClaimedGroup;
  outcomes: TwinCallbackPayload[];
  brokerId: string;
}): Promise<void> {
  const { group, outcomes, brokerId } = input;
  // One set-based resolve over the whole origin group. Members are bookkeeping
  // demand rows (no signal_key); the order is woken collectively by the signal
  // below, so no per-row delivery is needed.
  const lt = createClient({ auth: { userId: brokerId } });
  const res = await lt.escalations.resolveByIds({
    ids: group.members.map((m) => m.id),
    resolverPayload: { outcomes },
  });
  if (res.status !== 200) throw new Error(`resolveByIds failed: ${res.error}`);

  const head = group.members[0];
  const meta = (head.metadata ?? {}) as Record<string, unknown>;
  const settled: OrderSettledSignal = {
    orderId: group.originId ?? head.workflow_id ?? '',
    outcomes,
    completedAt: new Date().toISOString(),
  };
  await signalOrderSettled({
    taskQueue: head.task_queue ?? '',
    workflowType: head.workflow_type ?? '',
    workflowId: head.workflow_id ?? '',
    signalId: String(meta[JOB_FACETS.ORDER_SIGNAL]),
    data: settled,
  });
}
