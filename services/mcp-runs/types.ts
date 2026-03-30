export interface ExecutionEvent {
  event_id: number;
  event_type: string;
  category: string;
  event_time: string;
  duration_ms: number | null;
  is_system: boolean;
  attributes: Record<string, unknown>;
}

export interface ActivityDetail {
  name: string;
  type: string;
  dimension: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  cycle_iteration?: number;
  error?: string | null;
}

export interface JobContext {
  jobId: string;
  appId: string;
  job: any;
  startTime: string | undefined;
  closeTime: string | undefined;
  traceId: string | null;
  workflowTopic: string | null;
  workflowName: string | null;
  workflowResult: unknown;
  metadata: Record<string, unknown> | undefined;
  activities: any[];
}

export interface ExecutionExport {
  workflow_id: string;
  workflow_type: string | null;
  workflow_name: string | null;
  task_queue: string;
  status: string;
  start_time: string | null;
  close_time: string | null;
  duration_ms: number | null;
  trace_id: string | null;
  result: unknown;
  events: ExecutionEvent[];
  activities?: ActivityDetail[];
  summary: {
    total_events: number;
    activities: { total: number; completed: number; failed: number; system: number; user: number };
    child_workflows: { total: number; completed: number; failed: number };
    timers: number;
    signals: number;
  };
}
