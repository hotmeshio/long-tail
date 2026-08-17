import type { VerdictResolverV1 } from './forms';

export interface VerdictResult {
  leftQuantity: number;
  rightQuantity: number;
  totalAffected: number;
  designation: string;
  notes?: string;
  processedAt: string;
}

export async function processVerdict(input: VerdictResolverV1): Promise<VerdictResult> {
  return {
    leftQuantity: input.left_quantity,
    rightQuantity: input.right_quantity,
    totalAffected: input.left_quantity + input.right_quantity,
    designation: input.designation,
    notes: input.notes,
    processedAt: new Date().toISOString(),
  };
}
