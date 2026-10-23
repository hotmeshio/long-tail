import { describe, expect, it } from 'vitest';
import { DECISION, HANDOFF_ERROR, arrivedUnit, handoffDecisions, handoffProgress, itemKeys, signalKeys } from '../../../services/machines/contracts';

describe('handoffDecisions', () => {
  it('offers retry, manual and scrap for a failure in the move', () => {
    for (const code of [HANDOFF_ERROR.JAM, HANDOFF_ERROR.NO_REPLY, HANDOFF_ERROR.DISPATCH_REFUSED, HANDOFF_ERROR.HANDOFF_TIMEOUT]) {
      expect(handoffDecisions(code)).toEqual([DECISION.RETRY, DECISION.MANUAL, DECISION.SCRAP]);
    }
  });

  it('offers only manual and scrap once the sender finished the units as not ok', () => {
    expect(handoffDecisions(HANDOFF_ERROR.SENDER_REJECTED)).toEqual([DECISION.MANUAL, DECISION.SCRAP]);
  });

  it('offers only manual and scrap once a partial arrival split the units', () => {
    expect(handoffDecisions(HANDOFF_ERROR.PARTIAL_ARRIVAL)).toEqual([DECISION.MANUAL, DECISION.SCRAP]);
  });

  it('treats an unknown error as a failure in the move', () => {
    expect(handoffDecisions(undefined)).toContain(DECISION.RETRY);
  });
});

describe('arrivedUnit', () => {
  it('names the unit of an arrival item and nothing else', () => {
    expect(arrivedUnit(itemKeys.arrived('U1'))).toBe('U1');
    expect(arrivedUnit(itemKeys.released('U1'))).toBeNull();
  });
});

describe('handoffProgress', () => {
  const items = (...keys: string[]) => keys.map((itemKey) => ({ itemKey }));

  it('reads which units were released, which arrived and which are missing, in the handoff\'s order', () => {
    expect(handoffProgress(['U1', 'U2', 'U3'], items('released:U1', 'released:U2', 'arrived:U2'))).toEqual({
      released: ['U1', 'U2'], arrived: ['U2'], missing: ['U1', 'U3'],
    });
  });

  it('ignores items for units the handoff does not carry, and other items', () => {
    expect(handoffProgress(['U1'], items('arrived:U9', 'note:U1'))).toEqual({ released: [], arrived: [], missing: ['U1'] });
  });

  it('with no items, every unit is missing', () => {
    expect(handoffProgress(['U1', 'U2'], [])).toEqual({ released: [], arrived: [], missing: ['U1', 'U2'] });
  });
});

describe('signalKeys.handoffError', () => {
  it('keeps the first round key unchanged and suffixes later rounds', () => {
    expect(signalKeys.handoffError('R1', 2, 1)).toBe('handoff-error-R1-s2-a1');
    expect(signalKeys.handoffError('R1', 2, 1, 2)).toBe('handoff-error-R1-s2-a1-r2');
  });
});
