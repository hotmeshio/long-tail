import { describe, expect, it } from 'vitest';
import { DECISION, HANDOFF_ERROR, handoffDecisions, signalKeys } from '../../../services/machines/contracts';

describe('handoffDecisions', () => {
  it('offers retry, manual and scrap for a failure in the move', () => {
    for (const code of [HANDOFF_ERROR.JAM, HANDOFF_ERROR.NO_REPLY, HANDOFF_ERROR.DISPATCH_REFUSED, HANDOFF_ERROR.HANDOFF_TIMEOUT]) {
      expect(handoffDecisions(code)).toEqual([DECISION.RETRY, DECISION.MANUAL, DECISION.SCRAP]);
    }
  });

  it('offers only manual and scrap once the sender finished the units as not ok', () => {
    expect(handoffDecisions(HANDOFF_ERROR.SENDER_REJECTED)).toEqual([DECISION.MANUAL, DECISION.SCRAP]);
  });

  it('treats an unknown error as a failure in the move', () => {
    expect(handoffDecisions(undefined)).toContain(DECISION.RETRY);
  });
});

describe('signalKeys.handoffError', () => {
  it('keeps the first round key unchanged and suffixes later rounds', () => {
    expect(signalKeys.handoffError('R1', 2, 1)).toBe('handoff-error-R1-s2-a1');
    expect(signalKeys.handoffError('R1', 2, 1, 2)).toBe('handoff-error-R1-s2-a1-r2');
  });
});
