export type LTTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'needs_intervention'
  | 'cancelled';

export type LTTaskPriority = 1 | 2 | 3 | 4;

export interface LTMilestone {
  name: string;
  value: string | number | boolean | Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface LTTaskRecord {
  id: string;
  workflow_id: string;
  workflow_type: string;
  lt_type: string;
  task_queue: string | null;
  modality: string | null;
  status: LTTaskStatus;
  priority: LTTaskPriority;
  signal_id: string;
  parent_workflow_id: string;
  origin_id: string | null;
  parent_id: string | null;
  started_at: string;
  completed_at: string | null;
  envelope: string;
  metadata: Record<string, unknown> | null;
  error: string | null;
  milestones: LTMilestone[];
  data: string | null;
  created_at: string;
  updated_at: string;
}
