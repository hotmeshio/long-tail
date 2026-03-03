import type { LTReturn, LTEscalation } from '../../../types';

export interface ClaimAnalysis {
  confidence: number;
  flags: string[];
  summary: string;
}

export interface ProcessClaimReturnData {
  claimId: string;
  claimantId: string;
  status: 'approved' | 'flagged' | 'resolved';
  analysis?: ClaimAnalysis;
  validationResult?: string;
}

export interface ProcessClaimReturn extends LTReturn {
  data: ProcessClaimReturnData;
}

export interface ProcessClaimEscalationData {
  claimId: string;
  claimantId: string;
  claimType: string;
  amount: number;
  documents: string[];
  analysis: ClaimAnalysis;
  reason: string;
}

export interface ProcessClaimEscalation extends LTEscalation {
  data: ProcessClaimEscalationData;
}
