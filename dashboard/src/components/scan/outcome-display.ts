import { SCAN_OUTCOMES, type ScanExecuteResponse, type ScanOutcome } from '../../api/scan-codes';

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
  [SCAN_OUTCOMES.IDENTITY_PRIMED]: 'Identity primed',
  [SCAN_OUTCOMES.IDENTITY_UNKNOWN]: 'Badge not recognized',
  [SCAN_OUTCOMES.NOT_PRIMED]: 'Badge required',
  [SCAN_OUTCOMES.CHOICES]: 'Choices presented',
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
  [SCAN_OUTCOMES.IDENTITY_PRIMED]: 'text-status-success',
  [SCAN_OUTCOMES.IDENTITY_UNKNOWN]: 'text-status-warning',
  [SCAN_OUTCOMES.NOT_PRIMED]: 'text-status-warning',
  [SCAN_OUTCOMES.CHOICES]: 'text-status-success',
};

/**
 * The one-line headline for a response: the badge greeting when a badge
 * primed, otherwise the outcome label plus the rule's friendly name.
 */
export function outcomeHeadline(response: ScanExecuteResponse): string {
  if (response.outcome === SCAN_OUTCOMES.IDENTITY_PRIMED && response.actor) {
    return `Hi ${response.actor.displayName}`;
  }
  return `${OUTCOME_LABELS[response.outcome]}${response.rule ? ` — ${response.rule.name}` : ''}`;
}

/** The markdown a non-navigating response wants shown, when it carries one. */
export function outcomeMarkdown(response: ScanExecuteResponse): string | null {
  if (response.outcome === SCAN_OUTCOMES.NO_MATCH_FALLBACK) return response.fallback?.markdown ?? null;
  if (response.outcome === SCAN_OUTCOMES.IDENTITY_UNKNOWN) return response.fallback?.markdown ?? null;
  if (response.outcome === SCAN_OUTCOMES.NOT_PRIMED) return response.notPrimed?.markdown ?? null;
  return null;
}
