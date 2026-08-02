import { describe, it, expect } from 'vitest';
import { SCAN_OUTCOMES } from '../../../api/scan-codes';
import { OUTCOME_LABELS, OUTCOME_TONE, outcomeHeadline, outcomeMarkdown } from '../outcome-display';

describe('outcome-display', () => {
  it('labels every outcome, including the identity and choices outcomes', () => {
    for (const outcome of Object.values(SCAN_OUTCOMES)) {
      expect(OUTCOME_LABELS[outcome], `label for ${outcome}`).toBeTruthy();
      expect(OUTCOME_TONE[outcome], `tone for ${outcome}`).toBeTruthy();
    }
  });

  it('tones the new outcomes: primed/choices success, unknown/not-primed warning', () => {
    expect(OUTCOME_TONE[SCAN_OUTCOMES.IDENTITY_PRIMED]).toBe('text-status-success');
    expect(OUTCOME_TONE[SCAN_OUTCOMES.CHOICES]).toBe('text-status-success');
    expect(OUTCOME_TONE[SCAN_OUTCOMES.IDENTITY_UNKNOWN]).toBe('text-status-warning');
    expect(OUTCOME_TONE[SCAN_OUTCOMES.NOT_PRIMED]).toBe('text-status-warning');
  });

  it('greets the badge holder on identity_primed', () => {
    expect(outcomeHeadline({
      outcome: SCAN_OUTCOMES.IDENTITY_PRIMED,
      actor: { id: 'u-dana', displayName: 'Dana' },
    })).toBe('Hi Dana');
  });

  it('falls back to label + rule name for other outcomes', () => {
    expect(outcomeHeadline({
      outcome: SCAN_OUTCOMES.EXECUTED,
      rule: { schemeVersion: 10, category: '4', name: 'Collect' },
    })).toBe('Executed — Collect');
    expect(outcomeHeadline({ outcome: SCAN_OUTCOMES.INVALID_CODE })).toBe('Invalid code');
  });

  it('surfaces the notPrimed markdown for not_primed and the fallback for the fallback outcomes', () => {
    expect(outcomeMarkdown({
      outcome: SCAN_OUTCOMES.NOT_PRIMED,
      notPrimed: { markdown: 'Badge required.' },
    })).toBe('Badge required.');
    expect(outcomeMarkdown({
      outcome: SCAN_OUTCOMES.IDENTITY_UNKNOWN,
      fallback: { markdown: 'Unknown badge.' },
    })).toBe('Unknown badge.');
    expect(outcomeMarkdown({
      outcome: SCAN_OUTCOMES.NO_MATCH_FALLBACK,
      fallback: { markdown: 'Nothing here.' },
    })).toBe('Nothing here.');
    expect(outcomeMarkdown({ outcome: SCAN_OUTCOMES.EXECUTED })).toBeNull();
  });
});
