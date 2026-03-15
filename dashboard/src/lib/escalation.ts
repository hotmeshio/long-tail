import type { LTEscalationRecord } from '../api/types';

export function isEffectivelyClaimed(esc: LTEscalationRecord): boolean {
  return !!(
    esc.assigned_to &&
    esc.assigned_until &&
    new Date(esc.assigned_until) > new Date()
  );
}

/** An ACK escalation has no associated workflow — it's a notification, not a task. */
export function isAckEscalation(esc: LTEscalationRecord): boolean {
  return !esc.workflow_type;
}

export function isAvailable(esc: LTEscalationRecord): boolean {
  return (
    esc.status === 'pending' &&
    (!esc.assigned_to ||
      !esc.assigned_until ||
      new Date(esc.assigned_until) <= new Date())
  );
}
