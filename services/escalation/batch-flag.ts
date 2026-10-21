import { escalationEventData } from '../../lib/events/escalation-wire';
import type { FlagBatchItemOutcome, LTEscalationRecord, UnflagBatchItemOutcome } from '../../types';

import { isUuid } from '../../lib/uuid';
import { escalations } from './client';
import { publishEscalationChange } from './crud';
import { toEscalationRecord } from './map';

export interface FlagBatchItemInput {
  label: string;
  payload?: Record<string, any>;
  actor?: string;
  metadata?: Record<string, any>;
  resolvedBy?: { id: string; email?: string };
}

export interface BatchFlagOutcome<O extends string> {
  outcome: O;
  /** The post-write row; null on every failure outcome. */
  escalation: LTEscalationRecord | null;
}

/**
 * Flag one pending key of a batch escalation in a single SDK statement. The
 * key stays pending. A row whose wait declared `wakeOnFlag` resolves in the
 * same statement and its workflow wakes; that publishes `escalation.resolved`,
 * any other flag `escalation.updated`. Failures publish nothing.
 */
export async function flagBatchItem(
  id: string,
  itemKey: string,
  input: FlagBatchItemInput,
): Promise<BatchFlagOutcome<FlagBatchItemOutcome>> {
  if (!isUuid(id)) return { outcome: 'not-found', escalation: null };
  const client = await escalations();
  const result = await client.flagBatchItem({ id, itemKey, ...input });
  if (!result.ok) return { outcome: result.outcome, escalation: null };
  const escalation = toEscalationRecord(result.entry as any);
  publishFlagChange(escalation, itemKey, result.outcome === 'completed');
  return { outcome: result.outcome, escalation };
}

/** Clear one key's flag while the row is pending; publishes `escalation.updated`. */
export async function unflagBatchItem(
  id: string,
  itemKey: string,
): Promise<BatchFlagOutcome<UnflagBatchItemOutcome>> {
  if (!isUuid(id)) return { outcome: 'not-found', escalation: null };
  const client = await escalations();
  const result = await client.unflagBatchItem({ id, itemKey });
  if (!result.ok) return { outcome: result.outcome, escalation: null };
  const escalation = toEscalationRecord(result.entry as any);
  publishFlagChange(escalation, itemKey, false);
  return { outcome: result.outcome, escalation };
}

function publishFlagChange(escalation: LTEscalationRecord, itemKey: string, completed: boolean): void {
  publishEscalationChange({
    type: completed ? 'escalation.resolved' : 'escalation.updated',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    role: escalation.role,
    status: completed ? 'resolved' : 'pending',
    data: escalationEventData(escalation, { item_key: itemKey }),
  });
}
