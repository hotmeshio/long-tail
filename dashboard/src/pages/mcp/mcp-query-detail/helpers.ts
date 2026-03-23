// ── Shared helpers for MCP Query Detail wizard panels ────────────────────────

export type Step = 1 | 2 | 3 | 4 | 5 | 6;

export const STEP_LABELS_BASE = ['Original', 'Timeline', 'Profile', 'Deploy', 'Test', 'Verify'] as const;

/**
 * Maps an execution record to a simplified status string.
 */
export function mapStatus(exec: { status?: string } | undefined): string {
  if (!exec) return 'pending';
  if (exec.status === 'completed') return 'completed';
  if (exec.status === 'failed') return 'failed';
  return 'in_progress';
}

/**
 * Extracts the first JSON object from an LLM summary that may contain
 * fenced code blocks or inline JSON.
 */
export function extractJsonFromSummary(summary: string): Record<string, unknown> | null {
  const match = summary.match(/```json\s*([\s\S]*?)```/) || summary.match(/\{[\s\S]*?\n\}/);
  if (!match) return null;
  try { return JSON.parse((match[1] ?? match[0]).trim()); } catch { return null; }
}
