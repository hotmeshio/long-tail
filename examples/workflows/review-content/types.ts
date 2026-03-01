import type { LTReturn, LTEscalation, LTMilestone } from '../../../types';

export interface ReviewContentInput {
  contentId: string;
  content: string;
  contentType?: string;
}

export interface ReviewAnalysis {
  approved: boolean;
  confidence: number;
  flags: string[];
  summary: string;
}

export interface ReviewContentReturnData {
  contentId: string;
  approved: boolean;
  analysis: ReviewAnalysis;
}

export interface ReviewContentReturn extends LTReturn {
  data: ReviewContentReturnData;
}

export interface ReviewContentEscalationData {
  contentId: string;
  content: string;
  analysis: ReviewAnalysis;
}

export interface ReviewContentEscalation extends LTEscalation {
  data: ReviewContentEscalationData;
}
