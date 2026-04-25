/**
 * Workflow set types — groups of related workflows produced by plan mode.
 */

export type LTWorkflowSetStatus =
  | 'planning'
  | 'planned'
  | 'building'
  | 'deploying'
  | 'completed'
  | 'failed';

export interface PlanItemIOContract {
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

export interface PlanItem {
  name: string;
  description: string;
  namespace: string;
  role: 'leaf' | 'composition' | 'router';
  dependencies: string[];
  build_order: number;
  io_contract: PlanItemIOContract;
}

export interface LTWorkflowSetRecord {
  id: string;
  name: string;
  description: string | null;
  specification: string;
  plan: PlanItem[];
  namespaces: string[];
  status: LTWorkflowSetStatus;
  source_workflow_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkflowSetInput {
  name: string;
  description?: string;
  specification: string;
  plan?: PlanItem[];
  namespaces?: string[];
  source_workflow_id?: string;
}

export interface UpdateWorkflowSetInput {
  name?: string;
  description?: string;
  plan?: PlanItem[];
  namespaces?: string[];
  status?: LTWorkflowSetStatus;
}
