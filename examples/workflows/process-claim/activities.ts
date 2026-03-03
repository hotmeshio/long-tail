import type { ClaimAnalysis } from './types';

/**
 * Analyze claim documents. Behavior is driven by filenames:
 * - Filenames containing '_rotated' → high confidence (corrected docs)
 * - Original filenames → low confidence (simulates blurry/corrupt images)
 *
 * In production, this would call an AI vision service to analyze
 * the document images and extract structured data.
 */
export async function analyzeDocuments(
  documents: string[],
): Promise<ClaimAnalysis> {
  await new Promise((resolve) => setTimeout(resolve, 100));

  const correctedCount = documents.filter(d => d.includes('_rotated')).length;
  const allCorrected = correctedCount === documents.length && documents.length > 0;

  if (allCorrected) {
    return {
      confidence: 0.92,
      flags: [],
      summary: 'All document images processed successfully. Data extraction complete.',
    };
  }

  // Some or no corrected documents — low confidence
  const flags: string[] = ['blurry_images', 'unreadable_text'];
  if (correctedCount > 0) {
    flags.push('partial_correction');
  }

  return {
    confidence: 0.35,
    flags,
    summary:
      'Document images appear damaged or improperly oriented. ' +
      'Unable to extract data reliably.',
  };
}

/**
 * Validate a claim against the claimant record.
 * Only succeeds when analysis confidence is above threshold.
 *
 * In production, this would query a policy database and cross-reference
 * the extracted claim data with the claimant's active coverage.
 */
export async function validateClaim(
  claimantId: string,
  confidence: number,
): Promise<{ valid: boolean; reason: string }> {
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (confidence >= 0.85) {
    return {
      valid: true,
      reason: `Claimant ${claimantId} verified. Claim data matches policy records.`,
    };
  }

  return {
    valid: false,
    reason:
      `Insufficient confidence (${confidence}) to validate claim. ` +
      `Document quality too low for automated processing.`,
  };
}
