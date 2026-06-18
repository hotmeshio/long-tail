export type LTEscalationStatus =
  | 'pending'
  | 'resolved'
  | 'cancelled';

export type LTEscalationPriority = 1 | 2 | 3 | 4;

export interface LTEscalationRecord {
  id: string;

  // classification
  type: string;
  subtype: string;
  description: string | null;

  // state
  status: LTEscalationStatus;
  priority: LTEscalationPriority;

  // references
  task_id: string | null;
  origin_id: string | null;
  parent_id: string | null;

  // workflow routing (for signaling the paused workflow)
  workflow_id: string | null;
  task_queue: string | null;
  workflow_type: string | null;

  // routing / ownership
  role: string;
  assigned_to: string | null;
  assigned_until: Date | null;

  // timeline
  resolved_at: Date | null;
  claimed_at: Date | null;

  // payload
  envelope: string;
  metadata: Record<string, any> | null;
  escalation_payload: string | null;
  resolver_payload: string | null;

  // telemetry
  trace_id: string | null;
  span_id: string | null;

  created_at: Date;
  updated_at: Date;
}

/**
 * Result of a try-resolve-by-metadata call.
 *
 * - matched: true  → escalation found and signal delivered (or atomically resolved)
 * - matched: false, reason: 'not-found'      → no pending escalation for this metadata; safe to fall through
 * - matched: false, reason: 'resolve-failed' → escalation exists but signal was not delivered; do NOT fall through
 */
export type EscalationSignalResult =
  | { matched: true }
  | { matched: false; reason: 'not-found' | 'resolve-failed' };

/**
 * An escalation is "effectively claimed" when assigned_to is set
 * and assigned_until is in the future. Status remains 'pending'.
 */
export function isEffectivelyClaimed(esc: LTEscalationRecord): boolean {
  return !!(
    esc.assigned_to &&
    esc.assigned_until &&
    esc.assigned_until > new Date()
  );
}

/**
 * An escalation is "available" when status is pending and
 * either unassigned or the assignment has expired.
 */
export function isAvailable(esc: LTEscalationRecord): boolean {
  return (
    esc.status === 'pending' &&
    (!esc.assigned_to || !esc.assigned_until || esc.assigned_until <= new Date())
  );
}
