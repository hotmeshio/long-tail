import type { LTEscalationRecord } from '../api/types';

export function isEffectivelyClaimed(esc: LTEscalationRecord): boolean {
  return !!(
    esc.assigned_to &&
    esc.assigned_until &&
    new Date(esc.assigned_until) > new Date()
  );
}

export function isAvailable(esc: LTEscalationRecord): boolean {
  return (
    esc.status === 'pending' &&
    (!esc.assigned_to ||
      !esc.assigned_until ||
      new Date(esc.assigned_until) <= new Date())
  );
}
