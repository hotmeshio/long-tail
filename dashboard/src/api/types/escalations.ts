export type LTEscalationStatus = 'pending' | 'resolved' | 'cancelled' | 'expired';
export type LTEscalationPriority = 1 | 2 | 3 | 4;

export interface LTEscalationRecord {
  id: string;
  type: string;
  subtype: string;
  description: string | null;
  status: LTEscalationStatus;
  priority: LTEscalationPriority;
  task_id: string | null;
  origin_id: string | null;
  parent_id: string | null;
  workflow_id: string | null;
  task_queue: string | null;
  workflow_type: string | null;
  role: string;
  assigned_to: string | null;
  assigned_until: string | null;
  resolved_at: string | null;
  claimed_at: string | null;
  envelope: string;
  metadata: Record<string, unknown> | null;
  escalation_payload: string | null;
  resolver_payload: string | null;
  created_at: string;
  updated_at: string;
  trace_id: string | null;
  span_id: string | null;
  /**
   * The role's escalation form, resolved to this escalation's pinned version (or
   * the role's latest when unpinned) and JOINed in by the single-escalation GET.
   * Not a stored column — it rides in from the roles tables so the resolve UI
   * renders the versioned form without a second call. Absent on list rows.
   */
  form_schema?: Record<string, any> | null;
}
