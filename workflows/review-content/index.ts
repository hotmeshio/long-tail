import { MemFlow } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../types';
import * as activities from './activities';
import type {
  ReviewContentReturn,
  ReviewContentEscalation,
  ReviewContentReturnData,
  ReviewContentEscalationData,
  ReviewAnalysis,
} from './types';

type ActivitiesType = typeof activities;

const { analyzeContent } = MemFlow.workflow.proxyActivities<ActivitiesType>({
  activities,
});

const CONFIDENCE_THRESHOLD = 0.85;

/**
 * Review Content workflow.
 *
 * Analyzes content using AI. If confidence is high, auto-approves.
 * If confidence is low (or flags are raised), escalates to a human reviewer.
 * When the human resolves the escalation, the LT interceptor resumes
 * the workflow with the resolver data and returns the final result.
 */
export async function reviewContent(
  envelope: LTEnvelope,
): Promise<ReviewContentReturn | ReviewContentEscalation> {
  const { contentId, content, contentType } = envelope.data;

  // Step 1: AI analysis
  const analysis: ReviewAnalysis = await analyzeContent(content, contentType);

  // Step 2: Confidence check
  if (analysis.confidence >= CONFIDENCE_THRESHOLD && analysis.approved) {
    return {
      type: 'return',
      milestones: [
        { name: 'ai_review', value: 'approved' },
        { name: 'confidence', value: analysis.confidence },
      ],
      data: {
        contentId,
        approved: true,
        analysis,
      } satisfies ReviewContentReturnData,
    };
  }

  // Step 3: Escalate to human
  return {
    type: 'escalation',
    data: {
      contentId,
      content,
      analysis,
    } satisfies ReviewContentEscalationData,
    message: `Content review needed (confidence: ${analysis.confidence}, flags: ${analysis.flags.join(', ') || 'none'})`,
    role: 'reviewer',
    modality: 'default',
  };
}
