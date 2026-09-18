import { escalationEventData } from '../../lib/events/escalation-wire';
import type { AccumulateItemOutcome, LTEscalationRecord, RemoveAccumulatedItemOutcome } from '../../types';

import { isUuid } from '../../lib/uuid';
import { escalations } from './client';
import { publishEscalationChange } from './crud';
import { toEscalationRecord } from './map';

/** Names the second row of a reciprocal add or removal. Exactly one selector. */
export interface AccumulateReciprocal {
  id?: string;
  signalKey?: string;
  key?: string;
  value?: unknown;
  roles?: string[];
  /** Stored as the reciprocal entry's payload. */
  payload?: Record<string, any>;
}

export interface AccumulateItemInput {
  itemKey: string;
  payload?: Record<string, any>;
  /** Merge patch for the container's GIN-indexed metadata, same statement. */
  metadata?: Record<string, any>;
  /** Recorded on both entries as `actor`. */
  actor?: string;
  /** Claim-lock assertion on the container row (by-id form only). */
  assertClaim?: string;
  resolvedBy?: { id: string; email?: string };
  reciprocal?: AccumulateReciprocal;
}

export interface AccumulateSideOutcome {
  outcome: 'completed' | 'accepted';
  count: number;
  /** `max - count`, or null when the accumulator is unbounded. */
  remaining: number | null;
  escalation: LTEscalationRecord;
}

export interface AccumulateItemServiceOutcome {
  outcome: AccumulateItemOutcome;
  /** Items held after the add; -1 on every failure outcome. */
  count: number;
  remaining: number | null;
  /** The post-add container row on `completed`/`accepted`; null on failure. */
  escalation: LTEscalationRecord | null;
  reciprocal?: AccumulateSideOutcome;
}

export interface RemoveItemInput {
  itemKey: string;
  actor?: string;
  reciprocal?: Omit<AccumulateReciprocal, 'payload'>;
}

export interface RemoveItemServiceOutcome {
  outcome: RemoveAccumulatedItemOutcome;
  count: number;
  escalation: LTEscalationRecord | null;
  reciprocal?: { count: number; escalation: LTEscalationRecord };
}

const NOT_FOUND: AccumulateItemServiceOutcome = { outcome: 'not-found', count: -1, remaining: null, escalation: null };
const RECIPROCAL_NOT_FOUND: AccumulateItemServiceOutcome = { ...NOT_FOUND, outcome: 'reciprocal-not-found' };

function reciprocalIdValid(reciprocal?: { id?: string }): boolean {
  return !reciprocal?.id || isUuid(reciprocal.id);
}

/**
 * Adds one item to an accumulator escalation in a single atomic SDK
 * statement (guarded append + facet recompute + resolve-and-wake at max,
 * with the reciprocal row written in the same statement or not at all).
 * Interim adds publish `escalation.updated` with the count; a completing
 * add publishes the standard `escalation.resolved`. Both rows publish.
 * Failure outcomes publish nothing because no row changed.
 */
export async function accumulateItem(
  id: string,
  input: AccumulateItemInput,
): Promise<AccumulateItemServiceOutcome> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!reciprocalIdValid(input.reciprocal)) return RECIPROCAL_NOT_FOUND;
  const client = await escalations();
  const result = await client.accumulateItem({ id, ...input });
  return settleAccumulateOutcome(result, input);
}

/** Add selecting the container by its `signal_key`, the deterministic home signal id. */
export async function accumulateItemBySignalKey(
  signalKey: string,
  input: Omit<AccumulateItemInput, 'assertClaim'>,
): Promise<AccumulateItemServiceOutcome> {
  if (!reciprocalIdValid(input.reciprocal)) return RECIPROCAL_NOT_FOUND;
  const client = await escalations();
  const result = await client.accumulateItem({ signalKey, ...input });
  return settleAccumulateOutcome(result, input);
}

/** Add selecting the container by metadata facet, scoped by `roles`. */
export async function accumulateItemByMetadata(
  key: string,
  value: unknown,
  input: Omit<AccumulateItemInput, 'assertClaim'> & { roles?: string[] },
): Promise<AccumulateItemServiceOutcome> {
  if (!reciprocalIdValid(input.reciprocal)) return RECIPROCAL_NOT_FOUND;
  const client = await escalations();
  const result = await client.accumulateItemByMetadata({ key, value, ...input });
  return settleAccumulateOutcome(result, input);
}

/**
 * Removes one held item from a pending accumulator escalation (and the
 * container's id from the reciprocal row) in one guarded statement. The
 * waiter never wakes; both rows publish `escalation.updated`.
 */
export async function removeAccumulatedItem(
  id: string,
  input: RemoveItemInput,
): Promise<RemoveItemServiceOutcome> {
  if (!isUuid(id)) return { outcome: 'not-found', count: -1, escalation: null };
  if (!reciprocalIdValid(input.reciprocal)) return { outcome: 'reciprocal-not-found', count: -1, escalation: null };
  const client = await escalations();
  const result = await client.removeAccumulatedItem({ id, ...input });
  return settleRemoveOutcome(result, input);
}

export async function removeAccumulatedItemBySignalKey(
  signalKey: string,
  input: RemoveItemInput,
): Promise<RemoveItemServiceOutcome> {
  if (!reciprocalIdValid(input.reciprocal)) return { outcome: 'reciprocal-not-found', count: -1, escalation: null };
  const client = await escalations();
  const result = await client.removeAccumulatedItem({ signalKey, ...input });
  return settleRemoveOutcome(result, input);
}

export async function removeAccumulatedItemByMetadata(
  key: string,
  value: unknown,
  input: RemoveItemInput & { roles?: string[] },
): Promise<RemoveItemServiceOutcome> {
  if (!reciprocalIdValid(input.reciprocal)) return { outcome: 'reciprocal-not-found', count: -1, escalation: null };
  const client = await escalations();
  const result = await client.removeAccumulatedItemByMetadata({ key, value, ...input });
  return settleRemoveOutcome(result, input);
}

type SdkSide = { outcome: 'completed' | 'accepted'; count: number; remaining: number | null; entry: Record<string, any> };
type SdkAccumulateResult =
  | ({ ok: true; entry: Record<string, any>; reciprocal?: SdkSide } & Omit<SdkSide, 'entry'>)
  | { ok: false; outcome: AccumulateItemOutcome };

function publishSide(
  escalation: LTEscalationRecord,
  completed: boolean,
  data: Record<string, unknown>,
): void {
  publishEscalationChange({
    type: completed ? 'escalation.resolved' : 'escalation.updated',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    role: escalation.role,
    status: completed ? 'resolved' : 'pending',
    data: escalationEventData(escalation, data),
  });
}

function settleAccumulateOutcome(
  result: SdkAccumulateResult,
  input: { itemKey: string; actor?: string },
): AccumulateItemServiceOutcome {
  if (!result.ok) {
    return { outcome: result.outcome, count: -1, remaining: null, escalation: null };
  }
  const escalation = toEscalationRecord(result.entry as any);
  const reciprocal = result.reciprocal
    ? {
        outcome: result.reciprocal.outcome,
        count: result.reciprocal.count,
        remaining: result.reciprocal.remaining,
        escalation: toEscalationRecord(result.reciprocal.entry as any),
      }
    : undefined;
  publishSide(escalation, result.outcome === 'completed', {
    item_key: input.itemKey,
    count: result.count,
    remaining: result.remaining,
    actor: input.actor ?? null,
    reciprocal_id: reciprocal?.escalation.id ?? null,
  });
  if (reciprocal) {
    publishSide(reciprocal.escalation, reciprocal.outcome === 'completed', {
      item_key: escalation.id,
      count: reciprocal.count,
      remaining: reciprocal.remaining,
      actor: input.actor ?? null,
      reciprocal_id: escalation.id,
    });
  }
  return {
    outcome: result.outcome,
    count: result.count,
    remaining: result.remaining,
    escalation,
    ...(reciprocal ? { reciprocal } : {}),
  };
}

type SdkRemoveResult =
  | { ok: true; outcome: 'removed'; count: number; entry: Record<string, any>; reciprocal?: { count: number; entry: Record<string, any> } }
  | { ok: false; outcome: RemoveAccumulatedItemOutcome };

function settleRemoveOutcome(
  result: SdkRemoveResult,
  input: { itemKey: string; actor?: string },
): RemoveItemServiceOutcome {
  if (!result.ok) return { outcome: result.outcome, count: -1, escalation: null };
  const escalation = toEscalationRecord(result.entry as any);
  const reciprocal = result.reciprocal
    ? { count: result.reciprocal.count, escalation: toEscalationRecord(result.reciprocal.entry as any) }
    : undefined;
  publishSide(escalation, false, {
    item_key: input.itemKey,
    count: result.count,
    removed: true,
    actor: input.actor ?? null,
    reciprocal_id: reciprocal?.escalation.id ?? null,
  });
  if (reciprocal) {
    publishSide(reciprocal.escalation, false, {
      item_key: escalation.id,
      count: reciprocal.count,
      removed: true,
      actor: input.actor ?? null,
      reciprocal_id: escalation.id,
    });
  }
  return { outcome: 'removed', count: result.count, escalation, ...(reciprocal ? { reciprocal } : {}) };
}
