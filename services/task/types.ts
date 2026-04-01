import type { LTTaskStatus, LTMilestone } from '../../types';

export interface ResolvedHandle {
  taskQueue: string;
  workflowName: string;
}

export interface CreateTaskInput {
  workflow_id: string;
  workflow_type: string;
  lt_type: string;
  task_queue?: string;
  signal_id: string;
  parent_workflow_id: string;
  origin_id?: string;
  parent_id?: string;
  envelope: string;
  metadata?: Record<string, any>;
  priority?: number;
  trace_id?: string;
  span_id?: string;
  /** User or bot ID that initiated this task (for audit trail). */
  initiated_by?: string;
  /** Principal type: 'user' or 'bot'. */
  principal_type?: string;
}

export interface UpdateTaskInput {
  status?: LTTaskStatus;
  completed_at?: Date;
  error?: string;
  milestones?: LTMilestone[];
  data?: string;
}

export interface ProcessSummary {
  origin_id: string;
  task_count: number;
  completed: number;
  escalated: number;
  workflow_types: string[];
  started_at: string;
  last_activity: string;
}

export interface ProcessStats {
  total: number;
  active: number;
  completed: number;
  escalated: number;
  by_workflow_type: {
    workflow_type: string;
    total: number;
    active: number;
    completed: number;
    escalated: number;
  }[];
}

export const VALID_PERIODS: Record<string, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};
