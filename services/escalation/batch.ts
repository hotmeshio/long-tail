import { escalationEventData } from '../../lib/events/escalation-wire';
import type { BatchItemOutcome, LTEscalationRecord } from '../../types';
import { BATCH_ITEM_OUTCOMES } from '../../types/escalation';

import { isUuid } from '../../lib/uuid';
import { escalations } from './client';
import { publishEscalationChange } from './crud';
import { toEscalationRecord } from './map';
import { providerEscalationIdFor } from './provider-waits';

export interface ResolveBatchItemOutcome {
  outcome: BatchItemOutcome;
  /** Items still awaiting submission after this call (0 exactly when completed). */
  remaining: number;
  /** The post-fill row on `completed`/`accepted`/`woke`; null on every failure outcome. */
  escalation: LTEscalationRecord | null;
}

/**
 * Fills one declared item of a batch escalation in a single atomic SDK
 * statement (guarded fill + facet recompute + resolve-and-wake on the last
 * item). `actor` is recorded under `envelope.batch_filled_by[itemKey]`. Interim fills publish `escalation.updated` with progress; the
 * completing fill, and a fill that woke a `wakeOnFill` wait (`woke`), publish
 * the standard `escalation.resolved`. Failure outcomes publish nothing — the
 * row was untouched.
 */
export async function resolveBatchItem(
  id: string,
  itemKey: string,
  payload: Record<string, any>,
  metadata?: Record<string, any>,
  assertClaim?: string,
  resolvedBy?: { id: string; email?: string },
  actor?: string,
): Promise<ResolveBatchItemOutcome> {
  if (!isUuid(id)) return { outcome: 'not-found', remaining: -1, escalation: null };
  const client = await escalations();
  const result = await client.resolveBatchItem({
    id,
    itemKey,
    payload,
    metadata,
    assertClaim,
    resolvedBy,
    actor,
  });
  return settleBatchOutcome(result, itemKey);
}

/**
 * Batch-item fill selecting the row by its `signal_key` — the deterministic
 * home signal id the parent parked on. For callers that already own that
 * identity (a child calling home, a webhook), skipping both the UUID lookup
 * and any facet duplication. Same event contract as {@link resolveBatchItem}.
 */
export async function resolveBatchItemBySignalKey(
  signalKey: string,
  itemKey: string,
  payload: Record<string, any>,
  metadata?: Record<string, any>,
  resolvedBy?: { id: string; email?: string },
  actor?: string,
): Promise<ResolveBatchItemOutcome> {
  const providerId = await providerEscalationIdFor(signalKey);
  if (providerId) return resolveBatchItem(providerId, itemKey, payload, metadata, undefined, resolvedBy, actor);
  const client = await escalations();
  const result = await client.resolveBatchItem({
    signalKey,
    itemKey,
    payload,
    metadata,
    resolvedBy,
    actor,
  });
  return settleBatchOutcome(result, itemKey);
}

/**
 * Batch-item fill selecting the row by metadata facet — the highest-priority
 * pending row whose metadata contains the key/value, scoped by `roles`.
 * Same event contract as {@link resolveBatchItem}.
 */
export async function resolveBatchItemByMetadata(
  key: string,
  value: unknown,
  itemKey: string,
  payload: Record<string, any>,
  roles?: string[],
  metadata?: Record<string, any>,
  resolvedBy?: { id: string; email?: string },
  actor?: string,
): Promise<ResolveBatchItemOutcome> {
  const client = await escalations();
  const result = await client.resolveBatchItemByMetadata({
    key,
    value,
    roles,
    itemKey,
    payload,
    metadata,
    resolvedBy,
    actor,
  });
  return settleBatchOutcome(result, itemKey);
}

function settleBatchOutcome(
  result:
    | { ok: true; outcome: 'completed' | 'accepted' | 'woke'; remaining: number; entry: Record<string, any> }
    | { ok: false; outcome: BatchItemOutcome },
  itemKey: string,
): ResolveBatchItemOutcome {
  if (!result.ok) {
    return { outcome: result.outcome, remaining: -1, escalation: null };
  }
  const escalation = toEscalationRecord(result.entry as any);
  const completed = result.outcome === BATCH_ITEM_OUTCOMES.COMPLETED || result.outcome === BATCH_ITEM_OUTCOMES.WOKE;
  publishEscalationChange({
    type: completed ? 'escalation.resolved' : 'escalation.updated',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    role: escalation.role,
    status: completed ? 'resolved' : 'pending',
    data: escalationEventData(escalation, {
      item_key: itemKey,
      remaining: result.remaining,
    }),
  });
  return { outcome: result.outcome, remaining: result.remaining, escalation };
}
