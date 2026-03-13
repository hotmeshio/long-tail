import type { LTEscalationRecord } from '../../types';

export interface CreateEscalationInput {
  type: string;
  subtype: string;
  modality: string;
  description?: string;
  priority?: number;
  task_id?: string;
  origin_id?: string;
  parent_id?: string;
  role: string;
  envelope: string;
  metadata?: Record<string, any>;
  escalation_payload?: string;
  workflow_id?: string;
  task_queue?: string;
  workflow_type?: string;
  trace_id?: string;
  span_id?: string;
}

export interface ClaimResult {
  escalation: LTEscalationRecord;
  isExtension: boolean;
}

export interface EscalationStats {
  pending: number;
  claimed: number;
  created: number;
  resolved: number;
  by_role: { role: string; pending: number; claimed: number }[];
  by_type: { type: string; pending: number; claimed: number; resolved: number }[];
}

export const VALID_PERIODS: Record<string, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

/** Columns allowed for user-chosen ORDER BY. */
export const SORTABLE_COLUMNS = new Set([
  'created_at', 'updated_at', 'priority', 'resolved_at', 'role', 'type',
]);
