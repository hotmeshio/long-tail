import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import * as activities from './activities';
import type {
  ReviewContentReturn,
  ReviewContentEscalation,
  ReviewContentReturnData,
  ReviewContentEscalationData,
} from './types';

type ActivitiesType = typeof activities;

const { analyzeContent } = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
});

const CONFIDENCE_THRESHOLD = 0.85;

/**
 * Review Content workflow.
 *
 * Analyzes content using AI. If confidence is high, auto-approves.
 * If confidence is low (or flags are raised), escalates to a human reviewer.
 * On re-run after human resolution, returns the resolver data directly.
 */
export async function reviewContent(
  envelope: LTEnvelope,
): Promise<ReviewContentReturn | ReviewContentEscalation> {
  const { contentId, content, contentType } = envelope.data;

  // If this is a re-run with human-provided resolver data, return it
  if (envelope.resolver) {
    return {
      type: 'return',
      milestones: [
        { name: 'ai_review', value: 'escalated' },
        { name: 'resolved_by_human', value: true },
      ],
      data: {
        contentId,
        ...envelope.resolver,
      } as ReviewContentReturnData,
    };
  }

  // Step 1: AI analysis (activity interceptor creates 'llm' milestone before this runs)
  const analysis = await analyzeContent(content, contentType);

  // Step 2: Confidence check
  if (analysis.confidence >= CONFIDENCE_THRESHOLD && analysis.approved) {
    return {
      type: 'return',
      milestones: [
        { name: 'llm', value: 'content_analysis' },
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
