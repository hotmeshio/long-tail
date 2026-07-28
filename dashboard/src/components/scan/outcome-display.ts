import { SCAN_OUTCOMES, type ScanOutcome } from '../../api/scan-codes';

/** Human wording for each scan outcome — shared by the panel and the toast. */
export const OUTCOME_LABELS: Record<ScanOutcome, string> = {
  [SCAN_OUTCOMES.EXECUTED]: 'Executed',
  [SCAN_OUTCOMES.MATCHED_LIST]: 'Matched list',
  [SCAN_OUTCOMES.CONFIRM_REQUIRED]: 'Awaiting confirmation',
  [SCAN_OUTCOMES.NO_MATCH_FALLBACK]: 'No match',
  [SCAN_OUTCOMES.UNCONFIGURED]: 'Not configured',
  [SCAN_OUTCOMES.INVALID_CODE]: 'Invalid code',
  [SCAN_OUTCOMES.FORBIDDEN]: 'Not permitted',
  [SCAN_OUTCOMES.CONFLICT]: 'Conflict',
};

/** Status tone per outcome (text-safe tokens). */
export const OUTCOME_TONE: Record<ScanOutcome, string> = {
  [SCAN_OUTCOMES.EXECUTED]: 'text-status-success',
  [SCAN_OUTCOMES.MATCHED_LIST]: 'text-status-success',
  [SCAN_OUTCOMES.CONFIRM_REQUIRED]: 'text-status-warning',
  [SCAN_OUTCOMES.NO_MATCH_FALLBACK]: 'text-text-secondary',
  [SCAN_OUTCOMES.UNCONFIGURED]: 'text-status-warning',
  [SCAN_OUTCOMES.INVALID_CODE]: 'text-status-error',
  [SCAN_OUTCOMES.FORBIDDEN]: 'text-status-error',
  [SCAN_OUTCOMES.CONFLICT]: 'text-status-warning',
};
