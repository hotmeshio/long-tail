/**
 * Shared types and constants for pattern detection.
 */

export interface ExtractedStepLike {
  kind: 'tool' | 'llm';
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  source: string;
  mcpServerId?: string;
  promptMessages?: Array<{ role: string; content: string }>;
}

/** Keys that represent inter-step handles, not meaningful iteration data. */
export const WIRED_KEYS = new Set(['page_id', '_handle', 'session_id']);

export interface PatternAnnotation {
  type: 'iteration';
  toolName: string;
  runStartIndex: number;
  iterationCount: number;
  varyingKeys: string[];
  constantKeys: string[];
  arraySource: { stepIndex: number; fieldName: string } | null;
}
