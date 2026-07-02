export const ORTHO_STAGES = ['design', 'review', 'print', 'grind', 'glue', 'finish', 'qa', 'ship'] as const;
export type OrthoStage = typeof ORTHO_STAGES[number];

/** Escalation `type` for pipeline stage gates — shared by the workflow, MCP tools, and scripts. */
export const ORTHO_STAGE_TYPE = 'ortho-stage';
/** Registered workflow name for the pipeline. */
export const ORTHO_PIPELINE_WORKFLOW = 'orthoPipeline';

export interface OrthoOrder {
  order_id: string;
  item_type: string;
  stages?: string[];
  metadata?: Record<string, unknown>;
}

export interface StageResult {
  stage: string;
  completed_at: string;
  resolution: Record<string, unknown>;
}
