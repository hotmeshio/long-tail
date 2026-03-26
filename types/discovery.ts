/** Shared types for workflow discovery (used by both mcpQuery and mcpTriage pipelines). */

/** Candidate workflow returned by ranked FTS + tag discovery. */
export interface WorkflowCandidate {
  name: string;
  description: string | null;
  original_prompt: string | null;
  category: string | null;
  tags: string[];
  input_schema: Record<string, unknown>;
  tool_names: string[];
  fts_rank: number;
}
