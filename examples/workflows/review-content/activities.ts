import type { ReviewAnalysis } from './types';

/**
 * Simulates AI content analysis. In production, this would call
 * an LLM or classification model to analyze the content.
 *
 * The activity interceptor creates an 'llm' milestone in the
 * "before" phase when this activity is invoked (configured via
 * the milestones mapping passed to createLTActivityInterceptor).
 */
export async function analyzeContent(
  content: string,
  contentType?: string,
): Promise<ReviewAnalysis> {
  // Simulate analysis latency
  await new Promise((resolve) => setTimeout(resolve, 100));

  const flags: string[] = [];
  let confidence = 0.95;
  const text = content ?? '';

  // Simple heuristic simulation
  if (text.length < 10) {
    flags.push('too_short');
    confidence -= 0.3;
  }
  if (text.includes('REVIEW_ME')) {
    flags.push('manual_review_requested');
    confidence = 0.1;
  }
  if (text.includes('ERROR')) {
    flags.push('error_detected');
    confidence -= 0.4;
  }
  if (text.includes('WRONG_LANGUAGE')) {
    flags.push('wrong_language');
    confidence = 0.15;
  }

  const approved = confidence > 0.85 && flags.length === 0;

  return {
    approved,
    confidence: Math.max(0, Math.min(1, confidence)),
    flags,
    summary: flags.length
      ? `Content flagged: ${flags.join(', ')}`
      : 'Content approved by AI analysis',
  };
}
