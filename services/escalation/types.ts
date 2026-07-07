import type { LTEscalationRecord } from '../../types';

export interface CreateEscalationInput {
  type: string;
  subtype: string;
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
  '15m': '15 minutes',
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export interface StationMetricPeriod {
  p99: number | null;
  p50: number | null;
  avg: number | null;
  max: number | null;
}

export interface StationMetric {
  role: string;
  pending: number;
  claimed: number;
  resolved: number;
  /**
   * Pending, unclaimed items past the role's threshold — the Pace Board
   * rebalance signal. Age is measured from the role's priority_facet metadata
   * timestamp (created_at when unset) against priority_threshold_minutes
   * (sla_minutes when unset). 0 when neither threshold is configured.
   */
  priority_count: number;
  /** resolved_in_period / (target_per_hour × period_hours) × 100. Null when no target set. */
  throughput_pct: number | null;
  wait: StationMetricPeriod;
  work: StationMetricPeriod;
}

/** Columns allowed for user-chosen ORDER BY. */
export const SORTABLE_COLUMNS = new Set([
  'created_at', 'updated_at', 'priority', 'resolved_at', 'role', 'type',
]);
