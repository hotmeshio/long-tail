/**
 * Reserved keys inside `lt_escalations.metadata`. Everything else in the bag
 * is caller-owned. These ride the GIN-indexed surface so they survive the
 * engine's atomic Leg1 write untouched and are queryable like any facet.
 */
export const ESCALATION_METADATA_KEYS = {
  /**
   * Pins the lt_role_schemas version this escalation was created against.
   * The resolver UI renders that exact snapshot even after the role's schema
   * moves on; absent, the latest role schema applies. Set ergonomically via
   * `conditionLT`'s `schemaVersion` config field.
   */
  SCHEMA_VERSION: 'schema_version',
  /** Per-escalation resolver form override — a full JSON Schema embedded on the row. */
  FORM_SCHEMA: 'form_schema',
} as const;

export type LTEscalationStatus =
  | 'pending'
  | 'resolved'
  | 'cancelled'
  /** SLA timer on a `conditionLT`/`condition` wait fired first — the workflow resumed with `false`; the row is terminal */
  | 'expired';

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

  // efficient (atomic) escalation resume key — set when the row was written
  // inside a workflow's Leg1 checkpoint via `condition(signalId, config)` /
  // `conditionLT(signalId, config)`. The value is the signal id used to resume
  // the waiting workflow in place. Null for service-created rows.
  signal_key: string | null;

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
