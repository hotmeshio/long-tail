export type LTTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'needs_intervention'
  | 'cancelled';

export type LTTaskPriority = 1 | 2 | 3 | 4;

export interface LTTaskRecord {
  id: string;

  // workflow identification
  workflow_id: string;
  workflow_type: string;
  lt_type: string;
  modality: string | null;

  // state
  status: LTTaskStatus;
  priority: LTTaskPriority;

  // execution context
  signal_id: string;
  parent_workflow_id: string;
  origin_id: string | null;
  parent_id: string | null;

  // timeline
  started_at: Date;
  completed_at: Date | null;

  // payload
  envelope: string;
  metadata: Record<string, any> | null;
  error: string | null;
  milestones: LTMilestone[];
  data: string | null;

  created_at: Date;
  updated_at: Date;
}

export interface LTMilestone {
  name: string;
  value: string | number | boolean | Record<string, any>;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}
