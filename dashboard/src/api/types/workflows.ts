export interface LTWorkflowConfig {
  workflow_type: string;
  description: string | null;
  invocable: boolean;
  task_queue: string;
  default_role: string;
  roles: string[];
  invocation_roles: string[];
  consumes: string[];
  envelope_schema: Record<string, unknown> | null;
  resolver_schema: Record<string, unknown> | null;
  cron_schedule: string | null;
  execute_as: string | null;
}

export interface CronScheduleEntry {
  workflow_type: string;
  cron_schedule: string;
  description: string | null;
  task_queue: string;
  invocable: boolean;
  active: boolean;
  envelope_schema: Record<string, unknown> | null;
}

export interface McpToolManifest {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpServerRecord {
  id: string;
  name: string;
  description: string | null;
  transport_type: 'stdio' | 'sse' | 'streamable-http';
  transport_config: Record<string, unknown>;
  auto_connect: boolean;
  status: 'registered' | 'connected' | 'error' | 'disconnected';
  tool_manifest: McpToolManifest[] | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  credential_providers: string[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowExecutionEvent {
  event_id: number;
  event_type: string;
  category: 'workflow' | 'activity' | 'child_workflow' | 'timer' | 'signal';
  event_time: string;
  duration_ms: number | null;
  is_system: boolean;
  attributes: {
    kind: string;
    activity_type?: string;
    result?: unknown;
    timeline_key?: string;
    execution_index?: number;
    signal_name?: string;
    input?: unknown;
    child_workflow_id?: string;
    awaited?: boolean;
    wait_event_id?: number;
    scheduled_event_id?: number;
    initiated_event_id?: number;
    failure?: unknown;
    [key: string]: unknown;
  };
}

export interface WorkflowExecutionSummary {
  total_events: number;
  activities: {
    total: number;
    completed: number;
    failed: number;
    system: number;
    user: number;
  };
  child_workflows: { total: number; completed: number; failed: number };
  timers: number;
  signals: number;
}

/** Structured per-activity detail from YAML engine export (enrich_inputs). */
export interface ActivityDetail {
  name: string;
  type: string;
  dimension: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  retry_attempt?: number;
  cycle_iteration?: number;
  error?: string | null;
}

export interface WorkflowExecution {
  workflow_id: string;
  workflow_type: string;
  workflow_name?: string;
  task_queue: string;
  status: string;
  start_time: string | null;
  close_time: string | null;
  duration_ms: number | null;
  trace_id?: string | null;
  result?: unknown;
  events: WorkflowExecutionEvent[];
  summary: WorkflowExecutionSummary;
  /** Structured activity list with input/output (YAML engine exports). */
  activities?: ActivityDetail[];
}

export type WorkflowTier = 'durable' | 'configured' | 'certified';

export interface DiscoveredWorkflow {
  workflow_type: string;
  task_queue: string | null;
  tier: WorkflowTier;
  registered: boolean;
  active?: boolean;
  invocable: boolean;
  system: boolean;
  description: string | null;
  roles: string[];
  invocation_roles: string[];
  execute_as: string | null;
}

export interface ActiveWorker {
  name: string;
  task_queue: string;
  registered: boolean;
  system: boolean;
}

export interface LTJob {
  workflow_id: string;
  entity: string;
  status: 'running' | 'completed' | 'failed';
  is_live: boolean;
  created_at: string;
  updated_at: string;
  set_id?: string;
}
