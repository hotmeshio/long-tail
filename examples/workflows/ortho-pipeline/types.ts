export const ORTHO_STAGES = ['design', 'review', 'print', 'grid', 'glue', 'finish', 'qa', 'ship'] as const;
export type OrthoStage = typeof ORTHO_STAGES[number];

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
