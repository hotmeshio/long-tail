export type LTEscalationStatus = 'pending' | 'resolved' | 'cancelled';
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
}
