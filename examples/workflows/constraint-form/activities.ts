import type { ConstraintResolverV1 } from './forms';

export interface QualityReviewResult {
  approved: boolean;
  referenceCode: string;
  score: number;
  checksTotal: number;
  checksConfirmed: number;
  allChecksConfirmed: boolean;
  rejectionReason?: string;
  notes?: string;
  processedAt: string;
}

export async function processQualityReview(input: ConstraintResolverV1): Promise<QualityReviewResult> {
  const entries = Object.entries(input.checks ?? {});
  const confirmed = entries.filter(([, v]) => v === true);
  return {
    approved: input.approved,
    referenceCode: input.reference_code,
    score: input.score,
    checksTotal: entries.length,
    checksConfirmed: confirmed.length,
    allChecksConfirmed: confirmed.length === entries.length && entries.length > 0,
    rejectionReason: input.rejection_reason,
    notes: input.notes,
    processedAt: new Date().toISOString(),
  };
}
