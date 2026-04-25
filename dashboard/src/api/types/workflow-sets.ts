export type WorkflowSetStatus =
  | 'planning'
  | 'planned'
  | 'building'
  | 'deploying'
  | 'completed'
  | 'failed';

export interface PlanItem {
  name: string;
  description: string;
  namespace: string;
  role: 'leaf' | 'composition' | 'router';
  dependencies: string[];
  build_order: number;
  io_contract: {
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
  };
}

export interface WorkflowSetRecord {
  id: string;
  name: string;
  description: string | null;
  specification: string;
  plan: PlanItem[];
  namespaces: string[];
  status: WorkflowSetStatus;
  source_workflow_id: string | null;
  created_at: string;
  updated_at: string;
}
