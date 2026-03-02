import type { LTReturn, LTEscalation } from '../../../types';

export interface MemberInfo {
  memberId?: string;
  name?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  phone?: string;
  email?: string;
  emergencyContact?: {
    name: string;
    phone: string;
  };
  isPartialInfo?: boolean;
}

export interface VerifyDocumentReturnData {
  documentId: string;
  memberId: string;
  extractedInfo: MemberInfo;
  validationResult: 'match' | 'mismatch' | 'not_found';
  confidence: number;
}

export interface VerifyDocumentReturn extends LTReturn {
  data: VerifyDocumentReturnData;
}

export interface VerifyDocumentEscalationData {
  documentId: string;
  extractedInfo: MemberInfo;
  validationResult: 'mismatch' | 'not_found' | 'extraction_failed';
  databaseRecord?: Record<string, any>;
  reason: string;
}

export interface VerifyDocumentEscalation extends LTEscalation {
  data: VerifyDocumentEscalationData;
}
