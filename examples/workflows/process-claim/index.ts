import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import * as activities from './activities';
import type {
  ProcessClaimReturn,
  ProcessClaimEscalation,
  ProcessClaimReturnData,
  ProcessClaimEscalationData,
} from './types';

type ActivitiesType = typeof activities;

const { analyzeDocuments, validateClaim } =
  Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
  });

const CONFIDENCE_THRESHOLD = 0.85;

/**
 * Process Claim workflow.
 *
 * Analyzes insurance claim documents using AI. If document quality
 * is high (images readable), auto-validates and approves the claim.
 * If quality is low (blurry, upside-down images), escalates to a
 * human reviewer.
 *
 * On re-run after human resolution, returns the resolver data directly.
 * On re-run from MCP triage (corrected documents in envelope.data),
 * the corrected filenames pass analysis and the claim auto-approves.
 */
export async function processClaim(
  envelope: LTEnvelope,
): Promise<ProcessClaimReturn | ProcessClaimEscalation> {
  const { claimId, claimantId, claimType, amount, documents = [] } = envelope.data;

  // Re-entry with human-provided resolver data — return resolved
  if (envelope.resolver) {
    return {
      type: 'return',
      milestones: [
        { name: 'document_analysis', value: 'escalated' },
        { name: 'resolved_by_human', value: true },
      ],
      data: {
        claimId,
        claimantId,
        ...envelope.resolver,
      } as ProcessClaimReturnData,
    };
  }

  // Step 1: Analyze claim documents
  const analysis = await analyzeDocuments(documents);

  // Step 2: If confidence is high enough, validate and approve
  if (analysis.confidence >= CONFIDENCE_THRESHOLD) {
    const validation = await validateClaim(claimantId, analysis.confidence);

    return {
      type: 'return',
      milestones: [
        { name: 'document_analysis', value: 'success' },
        { name: 'confidence', value: analysis.confidence },
        { name: 'validation', value: validation.valid ? 'passed' : 'failed' },
      ],
      data: {
        claimId,
        claimantId,
        status: 'approved',
        analysis,
        validationResult: validation.reason,
      } satisfies ProcessClaimReturnData,
    };
  }

  // Step 3: Low confidence — escalate to reviewer
  return {
    type: 'escalation',
    data: {
      claimId,
      claimantId,
      claimType,
      amount,
      documents,
      analysis,
      reason:
        `Document analysis confidence too low (${analysis.confidence}). ` +
        `Flags: ${analysis.flags.join(', ')}`,
    } satisfies ProcessClaimEscalationData,
    message:
      `Claim ${claimId} needs review — document quality insufficient ` +
      `(confidence: ${analysis.confidence}, flags: ${analysis.flags.join(', ')})`,
    role: 'reviewer',
    modality: 'default',
  };
}
